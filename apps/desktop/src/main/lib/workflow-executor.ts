/**
 * 工作流节点执行器（8 种 kind）。
 *
 * 每个执行器是纯函数 (node, exec) => Promise<NodeResult>。
 * 真实副作用（LLM 调用、子代理、工具派发、审批）由引擎注入的执行上下文 `exec` 提供。
 *
 * 这样设计的好处：
 * - 测试可注入假 exec 而不需要 mock ai-sdk / agent-runtime
 * - 引擎可以观察每个执行器的精确生命周期
 * - 节点类型可以独立扩展（如未来增加"网页抓取"节点）
 */

import { generateText } from "ai";
import type {
  MemoryKind,
  MemoryRecord,
  WorkflowNode,
  WorkflowNodeStatus,
} from "../../shared/types";
import { resolveModel } from "./providers";
import { interpolateTemplate } from "./workflow-template";

/**
 * 节点执行返回结果。引擎会根据这个结果落库 + 写入 transition。
 * - status: 终态直接返回（succeeded/failed/skipped/cancelled）；否则引擎继续监听
 * - output: 任意 JSON 可序列化值，会写入 context.outputs[nodeId]
 * - error: 失败原因（仅在 status=failed 时有效）
 */
export interface NodeResult {
  status: WorkflowNodeStatus;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 节点执行上下文（引擎注入）。 */
export interface StepExecutionContext {
  runId: string;
  workflowId: string;
  node: WorkflowNode;
  /** 共享状态：上游节点的输出 + 工作流输入。 */
  shared: WorkflowSharedState;
  /** 工具派发：toolRef 形式 ("skill:<id>" / "<chatToolId>" / "mcp:<srv>:<tool>")。 */
  dispatchTool: (toolRef: string, input: unknown) => Promise<unknown>;
  /** 子代理派发：mode="handoff" 转移所有权；"consult" 父级保留所有权。 */
  dispatchChildAgent: (
    targetAgentId: string,
    payload: { task: string; expectedOutput?: string },
    mode: "handoff" | "consult",
  ) => Promise<{ output: string; durationMs: number }>;
  /** 审批等待：返回的 Promise 在外部调用 resolveApproval 时 resolve。 */
  waitForApproval: (
    nodeId: string,
    prompt: string,
  ) => Promise<{ approved: boolean; comment?: string }>;
  /** 记忆读写。 */
  readMemories: (query: string, kind?: string) => Promise<MemoryRecord[]>;
  /** 记忆写入：返回写入的记忆 id。 */
  writeMemory: (payload: { title: string; content: string; kind: MemoryKind }) => string;
  /** 中断信号（cancel / timeout）。 */
  signal: AbortSignal;
  /** 引擎附加的元数据，会被并入 step_run.metadata_json。 */
  runMetadata?: Record<string, unknown>;
}

/** 跨节点共享状态。 */
export interface WorkflowSharedState {
  input: Record<string, unknown>;
  outputs: Record<string, unknown>; // nodeId -> output
  rootContext: Record<string, unknown>;
}

export type StepExecutor = (ctx: StepExecutionContext) => Promise<NodeResult>;

// ---------- 通用辅助：检测中断 ----------
function ensureSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason.message : "aborted";
    throw new Error(reason);
  }
}

// ---------- prompt 执行器：单轮 LLM 调用 ----------
export const executePrompt: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const { node, shared } = ctx;
  const template = node.config.promptTemplate ?? node.description ?? node.title;
  const prompt = interpolateTemplate(template, {
    input: shared.input,
    outputs: shared.outputs,
    node: { id: node.id, title: node.title },
  });
  const system = node.config.systemPrompt
    ? interpolateTemplate(node.config.systemPrompt, {
        input: shared.input,
        outputs: shared.outputs,
      })
    : undefined;
  // 默认 model_ref：上游对话会用同一个 model；这里复用 void 默认的 provider 配置
  // 工作流阶段暂不解析 agentId（由调用方传入 model_ref）；如未配置则走默认
  const modelRef = readModelRef(node) ?? defaultModelRef();
  if (!modelRef) {
    throw new Error(`Prompt node '${node.id}' has no model_ref and no default model is available.`);
  }
  const resolved = resolveModel(modelRef);
  const result = await generateText({
    model: resolved.model,
    system,
    prompt,
    abortSignal: ctx.signal,
  });
  return {
    status: "succeeded",
    output: {
      text: result.text,
      modelRef,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
    },
  };
};

// ---------- tool 执行器：派发到具体工具 ----------
export const executeTool: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const ref = ctx.node.config.toolRef;
  if (!ref) {
    throw new Error(`Tool node '${ctx.node.id}' is missing config.toolRef`);
  }
  const input = interpolateTemplateObject(ctx.node.config.toolInput ?? {}, {
    input: ctx.shared.input,
    outputs: ctx.shared.outputs,
  });
  const result = await ctx.dispatchTool(ref, input);
  return {
    status: "succeeded",
    output: { toolRef: ref, input, result },
  };
};

// ---------- approval 执行器：等待外部决议 ----------
export const executeApproval: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const prompt = ctx.node.config.approvalPrompt ?? ctx.node.title;
  const decision = await ctx.waitForApproval(ctx.node.id, prompt);
  if (!decision.approved) {
    return {
      status: "failed",
      error: decision.comment ? `Approval denied: ${decision.comment}` : "Approval denied",
    };
  }
  return {
    status: "succeeded",
    output: { approved: true, comment: decision.comment ?? null },
    metadata: { approved: true },
  };
};

// ---------- memory 执行器：读写记忆 ----------
export const executeMemory: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const { node, shared } = ctx;
  if (node.config.memoryWrite) {
    const id = ctx.writeMemory({
      title: node.config.memoryWrite.title,
      content: interpolateTemplate(node.config.memoryWrite.content, {
        input: shared.input,
        outputs: shared.outputs,
      }),
      kind: node.config.memoryWrite.kind,
    });
    return { status: "succeeded", output: { written: true, id } };
  }
  const query = node.config.memoryQuery ?? node.title;
  const records = await ctx.readMemories(query, node.config.memoryKind);
  return {
    status: "succeeded",
    output: {
      query,
      count: records.length,
      items: records.slice(0, 10).map((r) => ({ id: r.id, title: r.title, kind: r.kind })),
    },
  };
};

// ---------- handoff 执行器：把控制权转给子代理（OpenAI Handoffs 范式） ----------
export const executeHandoff: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const target = ctx.node.config.targetAgentId;
  if (!target) {
    throw new Error(`Handoff node '${ctx.node.id}' requires config.targetAgentId`);
  }
  const task = interpolateTemplate(ctx.node.config.handoffTask ?? ctx.node.title, {
    input: ctx.shared.input,
    outputs: ctx.shared.outputs,
  });
  const result = await ctx.dispatchChildAgent(
    target,
    { task, expectedOutput: ctx.node.config.handoffExpectedOutput },
    "handoff",
  );
  return {
    status: "succeeded",
    output: {
      targetAgentId: target,
      task,
      output: result.output,
      durationMs: result.durationMs,
    },
  };
};

// ---------- consult 执行器：以受限能力调用子代理（OpenAI Agents-as-tools 范式） ----------
export const executeConsult: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const target = ctx.node.config.targetAgentId;
  if (!target) {
    throw new Error(`Consult node '${ctx.node.id}' requires config.targetAgentId`);
  }
  const task = interpolateTemplate(ctx.node.config.handoffTask ?? ctx.node.title, {
    input: ctx.shared.input,
    outputs: ctx.shared.outputs,
  });
  const result = await ctx.dispatchChildAgent(
    target,
    { task, expectedOutput: ctx.node.config.handoffExpectedOutput },
    "consult",
  );
  return {
    status: "succeeded",
    output: {
      targetAgentId: target,
      task,
      output: result.output,
      durationMs: result.durationMs,
    },
  };
};

// ---------- delay 执行器：纯等待 ----------
export const executeDelay: StepExecutor = async (ctx) => {
  ensureSignal(ctx.signal);
  const ms = Math.max(0, ctx.node.config.delayMs ?? 0);
  await new Promise<void>((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = (): void => ctx.signal.removeEventListener("abort", onAbort);
    ctx.signal.addEventListener("abort", onAbort, { once: true });
  });
  return { status: "succeeded", output: { delayMs: ms } };
};

// ---------- parallel / branch 是控制流，不直接执行；引擎用专门的循环处理 ----------
// 这里给空函数占位，避免引擎 dispatch 时漏掉
export const executeParallel: StepExecutor = async (ctx) => {
  // 引擎不会调用此函数；若被误调则返回 succeeded 以便链路不会卡住
  return {
    status: "succeeded",
    output: { controlFlow: "parallel" },
    metadata: { passthrough: true, nodeId: ctx.node.id },
  };
};

export const executeBranch: StepExecutor = async (ctx) => {
  // 同上：分支由引擎评估 conditionExpression / branches；
  // 若被误调则返回当前节点上下文
  return {
    status: "succeeded",
    output: { controlFlow: "branch" },
    metadata: { passthrough: true, nodeId: ctx.node.id },
  };
};

// ---------- 执行器注册表 ----------
export const stepExecutors: Record<WorkflowNode["kind"], StepExecutor> = {
  prompt: executePrompt,
  tool: executeTool,
  approval: executeApproval,
  memory: executeMemory,
  handoff: executeHandoff,
  consult: executeConsult,
  delay: executeDelay,
  parallel: executeParallel,
  branch: executeBranch,
};

// ---------- 内部辅助 ----------

/** 读取节点的 model_ref；优先 config.agentId 对应 profile，其次显式 model_ref（占位）。 */
function readModelRef(node: WorkflowNode): string | null {
  // 当前简化策略：节点上没有 model_ref 字段，agentId 也不直接持有 model_ref
  // （model_ref 在 AgentProfile 上）。引擎层会负责把 agentId -> modelRef 注入 ctx。
  // 这里保留钩子供未来扩展。
  const ref = (node.config as { modelRef?: string }).modelRef;
  return typeof ref === "string" && ref ? ref : null;
}

function defaultModelRef(): string | null {
  // 简化：调用方应通过 model_ref 显式指定；这里返回 null 触发 prompt 节点的校验
  return null;
}

function interpolateTemplateObject(
  obj: Record<string, unknown>,
  ctx: { input: Record<string, unknown>; outputs: Record<string, unknown> },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = interpolateTemplate(v, ctx);
    else out[k] = v;
  }
  return out;
}
