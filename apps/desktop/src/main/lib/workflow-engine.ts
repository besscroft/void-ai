/**
 * 工作流执行引擎
 *
 * 输入一份工作流定义 + 初始输入 + 触发上下文，按以下流程执行：
 *
 *  1. 加载定义 + DAG 校验
 *  2. 初始化 workflow_run（status=running, context_json={input, outputs:{}}）
 *  3. 循环：
 *     a) 计算 ready 节点（前置 succeeded、自身 pending）
 *     b) 派发：单节点立即异步执行；parallel 节点并发执行子节点
 *     c) 节点完成 → 写 step_run + transition + 更新 context.outputs
 *     d) 失败 → 按 retryPolicy 重试；超限按 onError 处置
 *     e) 全部终态或无 ready 节点 → 退出
 *  4. 终止：写 run status + runtime event
 *
 * 取消（cancel signal）：
 *  - 在循环每次迭代前检查 signal
 *  - 取消后：所有 pending 节点标记 cancelled；in-flight 节点由 AbortSignal 通知
 *  - already terminal 节点保持原状态
 *
 * 审批（approval 节点）：
 *  - 通过 waitForApproval() 暴露 promise，外部 resolve 后引擎继续
 *  - 如果 5 分钟内未决议（默认）则视为 timeout，按 onError=fail 处理
 */

import { randomUUID } from "node:crypto";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
} from "../../shared/types";
import {
  collectDownstream,
  initialReady,
  isTerminalStatus,
  nextReady,
  resolveParallelChildren,
  topologicalOrder,
  validateWorkflowDefinition,
  type NodeStatusMap,
} from "./workflow-dag";
import {
  type NodeResult,
  type StepExecutionContext,
  type WorkflowSharedState,
  stepExecutors,
} from "./workflow-executor";
import {
  createWorkflowStepRun,
  recordWorkflowTransition,
  updateWorkflowRunRecord,
  updateWorkflowStepRun,
} from "./workflow-runs";
import { DEFAULT_MAX_CONCURRENT_SUBAGENTS, DEFAULT_RETRY_POLICY } from "./workflow-types";
import { interpolateTemplate } from "./workflow-template";
import { attachWorkflowController, detachWorkflowController } from "./workflow-cancellation";

/** 工作流运行启动选项。 */
export interface ExecuteWorkflowOptions {
  workflow: WorkflowDefinition;
  input: Record<string, unknown>;
  triggeredBy: WorkflowRun["triggered_by"];
  triggeredByAgentId?: string | null;
  conversationId?: string | null;
  runtimeRunId?: string | null;
  /** 引擎注入的执行依赖；不传则用默认。 */
  deps?: Partial<EngineDependencies>;
  /** 自定义 AbortController（用于外部取消）。 */
  signal?: AbortSignal;
  /** 启动时若已有 runId，则使用此 id。 */
  runId?: string;
}

/** 引擎依赖：所有副作用的注入点。 */
export interface EngineDependencies {
  dispatchTool: StepExecutionContext["dispatchTool"];
  dispatchChildAgent: StepExecutionContext["dispatchChildAgent"];
  waitForApproval: StepExecutionContext["waitForApproval"];
  readMemories: StepExecutionContext["readMemories"];
  writeMemory: StepExecutionContext["writeMemory"];
  resolveModelRef: (node: WorkflowNode) => string | null;
  /**
   * 整个工作流运行内允许同时执行的"活跃子代理/节点"数量上限。
   * 对齐 OpenAI Responses Multi-agent 文档的 `max_concurrent_subagents`。
   * 缺省沿用 `DEFAULT_MAX_CONCURRENT_SUBAGENTS`（=3）。< 1 会被 clamp 到 1。
   * 同时被 inFlight 集合的 `Promise.race` 等待 + semaphore gate 共同保证。
   */
  maxConcurrentSubagents?: number;
  onNodeEvent?: (event: EngineEvent) => void | Promise<void>;
}

export type EngineEvent =
  | { type: "run_started"; runId: string; workflowId: string }
  | {
      type: "node_started";
      runId: string;
      nodeId: string;
      attempt: number;
      /** 节点归属的 agent 路径（OpenAI 风格的 "/root/..." 层级命名）。 */
      agentPath: string;
    }
  | {
      type: "node_completed";
      runId: string;
      nodeId: string;
      status: WorkflowNodeStatus;
      durationMs: number;
      output?: unknown;
      /** 节点归属的 agent 路径，与对应 `node_started` 一致。 */
      agentPath: string;
    }
  | {
      type: "run_completed";
      runId: string;
      status: WorkflowRunStatus;
      output?: unknown;
      error?: string;
    };

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_DEPS: EngineDependencies = {
  dispatchTool: async () => {
    throw new Error("Tool dispatch not configured for this workflow run.");
  },
  dispatchChildAgent: async () => {
    throw new Error("Child agent dispatch not configured for this workflow run.");
  },
  waitForApproval: async () => ({ approved: false, comment: "No approval handler configured" }),
  readMemories: async () => [],
  writeMemory: () => "",
  resolveModelRef: () => null,
  // 对齐 OpenAI `max_concurrent_subagents` 默认值；调用方可通过 deps.maxConcurrentSubagents 覆盖
  maxConcurrentSubagents: DEFAULT_MAX_CONCURRENT_SUBAGENTS,
};

export interface ExecuteWorkflowResult {
  runId: string;
  status: WorkflowRunStatus;
  output?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * 同步执行工作流（返回结果）。当工作流只包含 prompt / tool / handoff 等不需要
 * 等待外部审批的节点时，这是首选入口。
 *
 * 包含 approval 节点时仍可同步调用：内部会把 waitForApproval 转成 async 并
 * 等待决议或超时。
 */
export async function executeWorkflow(
  options: ExecuteWorkflowOptions,
): Promise<ExecuteWorkflowResult> {
  const { workflow, input } = options;
  const validation = validateWorkflowDefinition(workflow);
  if (!validation.ok) {
    throw new Error("Invalid workflow definition: " + validation.errors.join("; "));
  }
  const runId = options.runId ?? randomUUID();
  const startedAt = Date.now();
  const deps: EngineDependencies = { ...DEFAULT_DEPS, ...options.deps };
  // 注册到 cancellation registry；外部 cancel 通过 cancelWorkflowRun(runId) 触发
  const { signal: registeredSignal } = attachWorkflowController(runId);
  const signal = options.signal
    ? composeSignals(options.signal, registeredSignal)
    : registeredSignal;
  const shared: WorkflowSharedState = {
    input,
    outputs: {},
    rootContext: {
      workflowId: workflow.id,
      runId,
      conversationId: options.conversationId ?? null,
    },
  };
  // 创建 workflow_run
  const { createWorkflowRunRecord } = await import("./workflow-runs");
  createWorkflowRunRecord({
    id: runId,
    workflowId: workflow.id,
    runtimeRunId: options.runtimeRunId ?? null,
    status: "running",
    inputJson: JSON.stringify({ input, triggeredBy: options.triggeredBy }),
    contextJson: JSON.stringify(shared),
    startedAt,
    triggeredBy: options.triggeredBy,
    triggeredByAgentId: options.triggeredByAgentId ?? null,
    conversationId: options.conversationId ?? null,
  });
  recordWorkflowTransition(runId, null, workflow.entryNodeId, "run_started");
  await safeEmit(deps, {
    type: "run_started",
    runId,
    workflowId: workflow.id,
  });

  const statuses: NodeStatusMap = new Map(workflow.nodes.map((n) => [n.id, "pending"]));
  // 终态汇总
  const allResults = new Map<string, NodeResult>();
  let finalStatus: WorkflowRunStatus = "running";
  let finalError: string | undefined;
  let runOutput: unknown;
  const inFlight = new Set<Promise<void>>();
  // 全局并发上限（对齐 OpenAI `max_concurrent_subagents`），作用在 ready 派发环节
  const sem = createSubagentSemaphore(
    deps.maxConcurrentSubagents ?? DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  );

  try {
    while (true) {
      if (signal.aborted) {
        finalStatus = "cancelled";
        cancelPending(statuses, allResults);
        break;
      }
      // 终止条件：所有节点均处于终态
      if (allNodesTerminal(workflow, statuses)) {
        finalStatus = deriveFinalRunStatus(workflow, statuses);
        runOutput = collectFinalOutput(workflow, allResults);
        if (finalStatus === "failed") {
          const failedNodes = [...statuses.entries()]
            .filter(([, s]) => s === "failed")
            .map(([id]) => id);
          finalError = `Failed nodes: ${failedNodes.join(", ")}`;
        }
        break;
      }
      const ready = nextReady(workflow, statuses);
      if (ready.length === 0) {
        // 没有可派发的节点，但存在非终态节点（应被并行/分支/补偿处理）——
        // 若没有任何非终态 pending，则跳出由终止条件处理
        if (!hasPending(workflow, statuses)) break;
        // 等待正在执行的节点推进状态
        if (inFlight.size === 0) {
          // 死锁：存在 pending 但无 ready 且无 in-flight
          finalStatus = "failed";
          finalError = "Workflow reached a deadlock: pending nodes with unsatisfied dependencies.";
          markAllPending(workflow, statuses, "failed", finalError);
          break;
        }
        await Promise.race(inFlight);
        continue;
      }
      for (const nodeId of ready) {
        statuses.set(nodeId, "running");
        // runNode 入口会自行 acquire semaphore，递归入口（parallel/branch/fallback 的子节点）
        // 也都受同一 gate 约束，从而保证全树 in-flight 数不超过 max
        const promise = runNode(
          workflow,
          nodeId,
          statuses,
          allResults,
          shared,
          signal,
          deps,
          runId,
          sem,
        )
          // 单节点异常不应击穿外层 try/catch —— runNode 内部已经把异常转为 failed status
          .catch((error) => {
            console.warn(`[workflow-engine] runNode '${nodeId}' threw:`, error);
          })
          .finally(() => inFlight.delete(promise));
        inFlight.add(promise);
      }
      // 等任意一个 in-flight 完成，然后回到循环顶部
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }
  } catch (error) {
    finalStatus = "failed";
    finalError = error instanceof Error ? error.message : String(error);
  } finally {
    const finishedAt = Date.now();
    const finalContext = { ...shared, outputs: { ...shared.outputs } };
    updateWorkflowRunRecord(runId, {
      status: finalStatus,
      outputJson: runOutput !== undefined ? JSON.stringify(runOutput) : null,
      error: finalError ?? null,
      contextJson: JSON.stringify(finalContext),
      finishedAt,
    });
    detachWorkflowController(runId);
    await safeEmit(deps, {
      type: "run_completed",
      runId,
      status: finalStatus,
      output: runOutput,
      error: finalError,
    });
  }
  return {
    runId,
    status: finalStatus,
    output: runOutput,
    error: finalError,
    durationMs: Date.now() - startedAt,
  };
}

// ---------- 内部：单节点执行（带重试） ----------

async function runNode(
  def: WorkflowDefinition,
  nodeId: string,
  statuses: NodeStatusMap,
  results: Map<string, NodeResult>,
  shared: WorkflowSharedState,
  signal: AbortSignal,
  deps: EngineDependencies,
  runId: string,
  sem: ReturnType<typeof createSubagentSemaphore>,
): Promise<void> {
  // 入口 gate：保证全树 in-flight 数不超过 `max_concurrent_subagents`。
  // 整个 runNode 主体包在 try/finally 中，确保 cancel / throw 路径下也 release。
  await sem.acquire();
  try {
    const node = def.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // 平行/分支节点：由引擎用 control flow 处理
    if (node.kind === "parallel") {
      await runParallelNode(def, node, statuses, results, shared, signal, deps, runId, sem);
      return;
    }
    if (node.kind === "branch") {
      await runBranchNode(def, node, statuses, results, shared, signal, deps, runId, sem);
      return;
    }
    // 普通节点：进入单步重试循环
    const policy = node.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const maxAttempts = Math.max(1, policy.maxAttempts + 1); // 包含首次执行
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) {
        finalizeNode(node.id, "cancelled", undefined, "aborted", statuses, results, runId, shared);
        return;
      }
      const stepRun = createWorkflowStepRun({
        workflowRunId: runId,
        nodeId: node.id,
        status: "running",
        attempt,
        inputJson: JSON.stringify({
          input: shared.input,
          previousOutputs: pickUpstream(def, node, shared.outputs),
        }),
        startedAt: Date.now(),
        assignedAgentId: node.config.agentId ?? null,
        // agentPath 写入 metadata_json，避免新增 DB 列；下游 / UI 可解析该字段做来源分组
        metadataJson: safeJsonStringify({ agentPath: agentPathOf(node) }),
      });
      recordWorkflowTransition(
        runId,
        lastNodeIdForTransition(def, node.id, statuses),
        node.id,
        `attempt_${attempt}`,
      );
      await safeEmit(deps, {
        type: "node_started",
        runId,
        nodeId: node.id,
        attempt,
        agentPath: agentPathOf(node),
      });
      const start = Date.now();
      let result: NodeResult;
      try {
        const exec = stepExecutors[node.kind];
        if (!exec) {
          result = { status: "failed", error: `No executor for kind '${node.kind}'` };
        } else {
          const ctx: StepExecutionContext = {
            runId,
            workflowId: def.id,
            node,
            shared,
            dispatchTool: deps.dispatchTool,
            dispatchChildAgent: deps.dispatchChildAgent,
            waitForApproval: (id, prompt) =>
              withApprovalTimeout(deps.waitForApproval(id, prompt), signal),
            readMemories: deps.readMemories,
            writeMemory: deps.writeMemory,
            signal,
          };
          result = await exec(ctx);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { status: "failed", error: message };
      }
      const durationMs = Date.now() - start;
      if (result.status === "succeeded") {
        shared.outputs[node.id] = result.output ?? null;
        updateWorkflowStepRun(stepRun.id, {
          status: "succeeded",
          outputJson: safeJsonStringify(result.output),
          finishedAt: Date.now(),
          durationMs,
          metadataJson: safeJsonStringify(result.metadata ?? {}),
        });
        finalizeNode(
          node.id,
          "succeeded",
          result.output,
          undefined,
          statuses,
          results,
          runId,
          shared,
        );
        await safeEmit(deps, {
          type: "node_completed",
          runId,
          nodeId: node.id,
          status: "succeeded",
          durationMs,
          output: result.output,
          agentPath: agentPathOf(node),
        });
        return;
      }
      // 失败/取消
      lastError = result.error ?? "unknown error";
      updateWorkflowStepRun(stepRun.id, {
        status: result.status,
        error: lastError,
        finishedAt: Date.now(),
        durationMs,
        metadataJson: safeJsonStringify(result.metadata ?? {}),
      });
      if (result.status === "cancelled" || signal.aborted) {
        finalizeNode(node.id, "cancelled", undefined, lastError, statuses, results, runId, shared);
        return;
      }
      // 是否继续重试
      if (attempt < maxAttempts) {
        const backoff = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1);
        await sleepWithAbort(backoff, signal);
        continue;
      }
      // 重试耗尽，按 onError 处置
      await applyErrorPolicy(
        def,
        node,
        lastError,
        statuses,
        results,
        shared,
        signal,
        deps,
        runId,
        sem,
      );
    }
  } finally {
    sem.release();
  }
}

function finalizeNode(
  nodeId: string,
  status: WorkflowNodeStatus,
  output: unknown,
  error: string | undefined,
  statuses: NodeStatusMap,
  results: Map<string, NodeResult>,
  runId: string,
  shared: WorkflowSharedState,
): void {
  statuses.set(nodeId, status);
  if (output !== undefined) shared.outputs[nodeId] = output;
  results.set(nodeId, { status, output, error });
  recordWorkflowTransition(runId, null, nodeId, `node_${status}`);
}

async function applyErrorPolicy(
  def: WorkflowDefinition,
  node: WorkflowNode,
  errorMessage: string,
  statuses: NodeStatusMap,
  results: Map<string, NodeResult>,
  shared: WorkflowSharedState,
  signal: AbortSignal,
  deps: EngineDependencies,
  runId: string,
  sem: ReturnType<typeof createSubagentSemaphore>,
): Promise<void> {
  const policy = node.onError ?? "fail";
  if (policy === "continue") {
    // 标记为 succeeded 但不带 output
    finalizeNode(node.id, "succeeded", null, errorMessage, statuses, results, runId, shared);
    return;
  }
  if (policy === "fallback" && node.fallbackNodeId) {
    // 派发到 fallback 节点（一次性，递归调用 runNode）
    recordWorkflowTransition(runId, node.id, node.fallbackNodeId, "fallback");
    statuses.set(node.fallbackNodeId, "running");
    await runNode(def, node.fallbackNodeId, statuses, results, shared, signal, deps, runId, sem);
    return;
  }
  if (policy === "compensate") {
    // 沿已 succeeded 的上游反向调用注册的补偿（这里默认 = 标记失败 + 跳过下游）
    const upstream = collectUpstreamSuccessful(def, node, statuses);
    for (const upId of upstream) {
      // 标记 upstream 为 compensated；下游标 skipped
      finalizeNode(upId, "skipped", undefined, "compensated", statuses, results, runId, shared);
    }
    const downstream = collectDownstream(def, [node.id]);
    for (const downId of downstream) {
      if (statuses.get(downId) === "pending") {
        finalizeNode(
          downId,
          "skipped",
          undefined,
          "downstream_skipped",
          statuses,
          results,
          runId,
          shared,
        );
      }
    }
    finalizeNode(node.id, "failed", undefined, errorMessage, statuses, results, runId, shared);
    return;
  }
  // 默认：fail
  const downstream = collectDownstream(def, [node.id]);
  for (const downId of downstream) {
    if (statuses.get(downId) === "pending") {
      finalizeNode(
        downId,
        "skipped",
        undefined,
        "downstream_of_failed",
        statuses,
        results,
        runId,
        shared,
      );
    }
  }
  finalizeNode(node.id, "failed", undefined, errorMessage, statuses, results, runId, shared);
}

// ---------- parallel 节点 ----------
async function runParallelNode(
  def: WorkflowDefinition,
  node: WorkflowNode,
  statuses: NodeStatusMap,
  results: Map<string, NodeResult>,
  shared: WorkflowSharedState,
  signal: AbortSignal,
  deps: EngineDependencies,
  runId: string,
  sem: ReturnType<typeof createSubagentSemaphore>,
): Promise<void> {
  const children = resolveParallelChildren(def, node.id);
  if (children.length === 0) {
    finalizeNode(
      node.id,
      "succeeded",
      { parallel: [] },
      undefined,
      statuses,
      results,
      runId,
      shared,
    );
    return;
  }
  // 把每个子节点标 running
  for (const childId of children) {
    if (statuses.get(childId) === "pending") statuses.set(childId, "running");
  }
  // 并发启动所有子节点；每个子节点自身会 acquire 自己的 slot，
  // 因此整体 in-flight 数仍受 `max_concurrent_subagents` 约束
  const tasks = children.map((childId) =>
    runNode(def, childId, statuses, results, shared, signal, deps, runId, sem),
  );
  await Promise.all(tasks);
  // parallel 节点自身只在所有子节点完成后置 succeeded；
  // 若任一子节点 failed 且 onError=fail，则整体失败
  const childStatuses = children.map((id) => statuses.get(id) ?? "pending");
  const anyFailed = childStatuses.some((s) => s === "failed" || s === "cancelled");
  if (anyFailed) {
    finalizeNode(
      node.id,
      "failed",
      { parallel: childStatuses },
      "parallel child failed",
      statuses,
      results,
      runId,
      shared,
    );
  } else {
    finalizeNode(
      node.id,
      "succeeded",
      { parallel: childStatuses },
      undefined,
      statuses,
      results,
      runId,
      shared,
    );
  }
}

// ---------- branch 节点 ----------
async function runBranchNode(
  def: WorkflowDefinition,
  node: WorkflowNode,
  statuses: NodeStatusMap,
  results: Map<string, NodeResult>,
  shared: WorkflowSharedState,
  signal: AbortSignal,
  deps: EngineDependencies,
  runId: string,
  sem: ReturnType<typeof createSubagentSemaphore>,
): Promise<void> {
  let chosenId: string | null = null;
  if (node.config.branches && node.config.branches.length > 0) {
    for (const branch of node.config.branches) {
      const when = branch.when;
      if (!when) {
        chosenId = branch.nodeId;
        break;
      }
      const result = interpolateTemplate(`{{ ${when} }}`, {
        input: shared.input,
        outputs: shared.outputs,
      });
      if (truthy(result)) {
        chosenId = branch.nodeId;
        break;
      }
    }
  } else if (node.config.conditionExpression) {
    const result = interpolateTemplate(`{{ ${node.config.conditionExpression} }}`, {
      input: shared.input,
      outputs: shared.outputs,
    });
    if (truthy(result)) chosenId = findAnyDownstream(def, node.id);
  }
  if (!chosenId) chosenId = findAnyDownstream(def, node.id);
  if (!chosenId) {
    finalizeNode(
      node.id,
      "succeeded",
      { branch: "no_target" },
      undefined,
      statuses,
      results,
      runId,
      shared,
    );
    return;
  }
  statuses.set(chosenId, "running");
  await runNode(def, chosenId, statuses, results, shared, signal, deps, runId, sem);
  finalizeNode(
    node.id,
    "succeeded",
    { branch: chosenId },
    undefined,
    statuses,
    results,
    runId,
    shared,
  );
}

// ---------- 工具函数 ----------

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const onA = (): void => c.abort(a.reason);
  const onB = (): void => c.abort(b.reason);
  a.addEventListener("abort", onA, { once: true });
  b.addEventListener("abort", onB, { once: true });
  return c.signal;
}

async function withApprovalTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("approval timeout")), APPROVAL_TIMEOUT_MS);
  });
  const abortPromise = new Promise<T>((_, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ __unserializable: true });
  }
}

function allNodesTerminal(def: WorkflowDefinition, statuses: NodeStatusMap): boolean {
  for (const n of def.nodes) {
    const s = statuses.get(n.id);
    if (!s || !isTerminalStatus(s)) return false;
  }
  return true;
}

function hasPending(def: WorkflowDefinition, statuses: NodeStatusMap): boolean {
  for (const n of def.nodes) {
    if (statuses.get(n.id) === "pending") return true;
  }
  return false;
}

function cancelPending(statuses: NodeStatusMap, results: Map<string, NodeResult>): void {
  for (const [id, s] of statuses) {
    if (s === "pending" || s === "running") {
      statuses.set(id, "cancelled");
      results.set(id, { status: "cancelled", error: "cancelled" });
    }
  }
}

function markAllPending(
  def: WorkflowDefinition,
  statuses: NodeStatusMap,
  to: WorkflowNodeStatus,
  reason: string,
): void {
  for (const n of def.nodes) {
    if (statuses.get(n.id) === "pending") {
      statuses.set(n.id, to);
    }
  }
  void reason;
}

function deriveFinalRunStatus(def: WorkflowDefinition, statuses: NodeStatusMap): WorkflowRunStatus {
  let anyFailed = false;
  let anyCancelled = false;
  for (const n of def.nodes) {
    const s = statuses.get(n.id);
    if (s === "failed") anyFailed = true;
    if (s === "cancelled") anyCancelled = true;
  }
  if (anyFailed) return "failed";
  if (anyCancelled) return "cancelled";
  return "succeeded";
}

function collectFinalOutput(
  def: WorkflowDefinition,
  results: Map<string, NodeResult>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of def.nodes) {
    const r = results.get(n.id);
    if (r && r.status === "succeeded" && r.output !== undefined) out[n.id] = r.output;
  }
  void def;
  return out;
}

function pickUpstream(
  def: WorkflowDefinition,
  node: WorkflowNode,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dep of node.dependsOn) out[dep] = outputs[dep];
  void def;
  return out;
}

function lastNodeIdForTransition(
  def: WorkflowDefinition,
  _currentId: string,
  statuses: NodeStatusMap,
): string | null {
  void def;
  let last: string | null = null;
  for (const [id, s] of statuses) {
    if (s === "succeeded" || s === "failed") last = id;
  }
  return last;
}

function collectUpstreamSuccessful(
  def: WorkflowDefinition,
  node: WorkflowNode,
  statuses: NodeStatusMap,
): string[] {
  const visited = new Set<string>();
  const stack = [...node.dependsOn];
  while (stack.length > 0) {
    const id = stack.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (statuses.get(id) === "succeeded") {
      const n = def.nodes.find((nn) => nn.id === id);
      if (n) stack.push(...n.dependsOn);
    }
  }
  return [...visited];
}

function findAnyDownstream(def: WorkflowDefinition, fromId: string): string | null {
  for (const n of def.nodes) {
    if (n.dependsOn.includes(fromId)) return n.id;
  }
  return null;
}

function truthy(v: string): boolean {
  if (v === "{{ " || v === "{{}}") return false;
  const trimmed = v.trim();
  if (
    trimmed === "" ||
    trimmed === "false" ||
    trimmed === "0" ||
    trimmed === "null" ||
    trimmed === "undefined"
  )
    return false;
  return true;
}

async function safeEmit(deps: EngineDependencies, event: EngineEvent): Promise<void> {
  if (deps.onNodeEvent) {
    try {
      await deps.onNodeEvent(event);
    } catch (error) {
      // 不让监听器异常影响执行
      console.warn("[workflow-engine] onNodeEvent threw:", error);
    }
  }
}

/** 取节点的 agent 路径；缺省回退到 root。 */
function agentPathOf(node: WorkflowNode): string {
  return node.config.agentPath ?? "/root";
}

/**
 * 计数式 semaphore：用于限制 in-flight 节点数，对齐
 * OpenAI Responses Multi-agent 的 `max_concurrent_subagents`。
 *
 * - `acquire()` 立即返回当 inFlight < max，否则挂起到 `waiters` 队列
 * - `release()` 唤醒队首等待者，并把 inFlight 转交给它（避免空档）
 * - 必须 `try { await acquire() } finally { release() }` 调用以防泄漏
 */
function createSubagentSemaphore(max: number): {
  readonly max: number;
  acquire(): Promise<void>;
  release(): void;
  inFlight(): number;
} {
  const cap = Math.max(1, max | 0);
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    max: cap,
    acquire(): Promise<void> {
      if (inFlight < cap) {
        inFlight++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    release(): void {
      inFlight = Math.max(0, inFlight - 1);
      const next = waiters.shift();
      if (next) {
        // 把当前 slot 直接转交给等待者，避免 release→acquire 之间的空档
        inFlight++;
        next();
      }
    },
    inFlight(): number {
      return inFlight;
    },
  };
}

// 重新导出拓扑序 / 初始 ready 给上层（如：UI 渲染管线预览）
export { topologicalOrder, initialReady };

// 重新导出 WorkflowStepRun 类型，便于 server 层
export type { WorkflowStepRun };
