/**
 * 工作流模块共享类型与规范化工具。
 *
 * 此模块只放与执行/数据访问都相关的常量与工具，
 * 不依赖 ai-sdk / agent-runtime 等运行时具体实现。
 */

import type {
  ToolSkillStep,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowOnErrorPolicy,
  WorkflowRetryPolicy,
  WorkflowStep,
} from "../../shared/types";

/** 单节点默认重试策略：最多 2 次，首次 200ms 退避，指数倍率 2。 */
export const DEFAULT_RETRY_POLICY: WorkflowRetryPolicy = {
  maxAttempts: 2,
  backoffMs: 200,
  backoffMultiplier: 2,
};

/** 单节点默认错误处置：失败即终止整个工作流。 */
export const DEFAULT_ON_ERROR: WorkflowOnErrorPolicy = "fail";

/**
 * 整个工作流运行内允许同时执行的"活跃子代理/节点"数量上限。
 *
 * 对齐 OpenAI Responses Multi-agent 文档的 `max_concurrent_subagents`（默认 3）。
 * 该上限作用于引擎派发循环：
 *   - ready 节点在 inFlight 数 < max 时立即派发
 *   - 否则 await 任意一个完成后再继续
 *   - parallel 节点内部 children 也复用 runNode，因此受同一 gate 约束
 *
 * 取值 < 1 会被引擎强制 clamp 到 1。
 */
export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 3;

/** 把 ToolSkillStep（旧版）转换为 WorkflowNode（新版）。 */
export function buildNodeFromLegacyStep(raw: unknown, index: number): WorkflowNode {
  const step = (raw ?? {}) as Partial<ToolSkillStep>;
  const id = (step.id && String(step.id)) || `step-${index + 1}`;
  const type = (step.type && String(step.type)) || "prompt";
  const baseConfig: WorkflowNode["config"] = {};
  // 旧版的 detail 字段直接落到 promptTemplate / approvalPrompt 等
  if (type === "approval") baseConfig.approvalPrompt = step.detail;
  else if (type === "tool") baseConfig.toolInput = { description: step.detail };
  else if (type === "memory") baseConfig.memoryQuery = step.detail;
  else if (type === "handoff") baseConfig.handoffTask = step.detail;
  else if (type === "prompt") baseConfig.promptTemplate = step.detail;
  return {
    id,
    kind: (type as WorkflowNode["kind"]) ?? "prompt",
    title: step.title || id,
    description: step.detail,
    dependsOn: index === 0 ? [] : [],
    config: baseConfig,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    onError: DEFAULT_ON_ERROR,
  };
}

/**
 * 对旧版线性 step 列表建立线性 DAG 依赖：
 * - 第一节点依赖为空
 * - 第 n 节点 dependsOn = [第 n-1 节点 id]
 */
export function linearizeSteps(steps: WorkflowStep[]): WorkflowNode[] {
  const nodes: WorkflowNode[] = steps.map((step, idx) => {
    const node: WorkflowNode = {
      id: step.id,
      kind: step.type as WorkflowNode["kind"],
      title: step.title,
      description: step.detail,
      dependsOn: idx === 0 ? [] : [steps[idx - 1]!.id],
      config: {},
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
      onError: DEFAULT_ON_ERROR,
    };
    return node;
  });
  return nodes;
}

/** 深拷贝工作流定义（用于 update 时基于旧版生成新版，避免直接修改原对象）。 */
export function cloneDefinition(def: WorkflowDefinition): WorkflowDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) => ({
      ...n,
      dependsOn: [...n.dependsOn],
      config: {
        ...n.config,
        parallelNodes: n.config.parallelNodes ? [...n.config.parallelNodes] : undefined,
      },
      retryPolicy: { ...n.retryPolicy },
    })),
  };
}

/**
 * 对定义做最后的"安全网"补全：
 * - 给缺失 retryPolicy / onError 的节点填默认值
 * - 纠正 entryNodeId 指向第一个节点
 * - 强制 version 至少为 1
 */
export function normalizeDefinition(def: WorkflowDefinition): WorkflowDefinition {
  const nodes: WorkflowNode[] = def.nodes.map((n) => ({
    ...n,
    dependsOn: n.dependsOn ?? [],
    config: n.config ?? {},
    retryPolicy: n.retryPolicy ?? { ...DEFAULT_RETRY_POLICY },
    onError: n.onError ?? DEFAULT_ON_ERROR,
  }));
  const entryNodeId = nodes.some((n) => n.id === def.entryNodeId)
    ? def.entryNodeId
    : (nodes[0]?.id ?? "");
  return {
    ...def,
    nodes,
    entryNodeId,
    version: def.version && def.version > 0 ? def.version : 1,
  };
}

/**
 * 构造一个极简的"单节点工作流"，用于 IPC/HTTP 端点的便利测试或临时生成。
 */
export function makeAdHocWorkflow(input: {
  id?: string;
  name: string;
  description?: string;
  node: WorkflowNode;
}): WorkflowDefinition {
  const node = input.node;
  return normalizeDefinition({
    id: input.id ?? `wf-${Date.now()}`,
    name: input.name,
    description: input.description ?? "",
    status: "draft",
    trigger: "void-tool",
    version: 1,
    entryNodeId: node.id,
    nodes: [node],
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}
