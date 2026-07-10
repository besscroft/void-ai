/**
 * 把工作流引擎的抽象依赖（dispatchTool / dispatchChildAgent / readMemories ...）
 * 桥接到项目里已有的真实能力。
 *
 * 这层是「副作用适配器」：测试可以注入假 deps，本模块负责生产路径上的接线。
 */

import { eq } from "drizzle-orm";
import { getDb, schema, insertRuntimeEvent } from "./db";
import type { MemoryKind, MemoryRecord } from "../../shared/types";

export interface DefaultEngineDepsOptions {
  conversationId?: string | null;
  runtimeRunId?: string | null;
  triggeredByAgentId?: string | null;
  workflowRunId: string;
}

/**
 * 返回一组默认的 EngineDependencies。生成路径上的全部真实接线都在这里。
 *
 * 工具派发策略（按 toolRef 前缀）：
 *   - "skill:<id>"    → 调起对应 skill（skill-runtime）
 *   - "mcp:<srv>:<t>" → MCP 工具（暂未实现 v1）
 *   - 其它            → 内建 chat 工具（web_search / current_time / memory_*）
 */
export function buildDefaultEngineDeps(opts: DefaultEngineDepsOptions) {
  return {
    dispatchTool: async (toolRef: string, input: unknown): Promise<unknown> => {
      if (toolRef.startsWith("skill:")) {
        return dispatchSkillTool(toolRef.slice("skill:".length), input);
      }
      if (toolRef.startsWith("mcp:")) {
        throw new Error(
          `MCP tool dispatch (${toolRef}) is not implemented in workflow engine yet.`,
        );
      }
      // 内建工具：交给 chat-tools 的入口（用 createChatToolDescriptors 解析）
      return dispatchChatTool(toolRef, input);
    },
    dispatchChildAgent: (
      targetAgentId: string,
      payload: { task: string; expectedOutput?: string },
      mode: "handoff" | "consult",
    ) =>
      dispatchChildAgentStub({
        targetAgentId,
        task: payload.task,
        expectedOutput: payload.expectedOutput,
        mode,
        conversationId: opts.conversationId ?? null,
        runtimeRunId: opts.runtimeRunId ?? null,
        workflowRunId: opts.workflowRunId,
      }),
    waitForApproval: async (nodeId: string, prompt: string) => {
      // 真实场景下：把 approval 写入待决队列，等 IPC/HTTP 调用 resolveWorkflowApproval
      return new Promise<{ approved: boolean; comment?: string }>((resolve) => {
        registerPendingApproval(opts.workflowRunId, nodeId, prompt, resolve);
      });
    },
    readMemories: (query: string, kind?: string): MemoryRecord[] => {
      return searchMemoriesForWorkflow(query, kind);
    },
    writeMemory: (payload: { title: string; content: string; kind: MemoryKind }): string => {
      return writeMemoryForWorkflow(payload, {
        conversationId: opts.conversationId ?? null,
        runtimeRunId: opts.runtimeRunId ?? null,
      });
    },
    resolveModelRef: (node: { config: { agentId?: string } }): string | null => {
      return resolveModelRefForAgent(node.config.agentId);
    },
  };
}

// ---------- approval 队列 ----------

type PendingApproval = {
  runId: string;
  nodeId: string;
  prompt: string;
  resolve: (decision: { approved: boolean; comment?: string }) => void;
};
const pendingApprovals = new Map<string, PendingApproval>();

function approvalKey(runId: string, nodeId: string): string {
  return `${runId}::${nodeId}`;
}

function registerPendingApproval(
  runId: string,
  nodeId: string,
  prompt: string,
  resolve: PendingApproval["resolve"],
): void {
  const key = approvalKey(runId, nodeId);
  pendingApprovals.set(key, { runId, nodeId, prompt, resolve });
}

export function resolvePendingApproval(
  runId: string,
  nodeId: string,
  approved: boolean,
  comment?: string,
): boolean {
  const key = approvalKey(runId, nodeId);
  const pending = pendingApprovals.get(key);
  if (!pending) return false;
  pending.resolve({ approved, comment });
  pendingApprovals.delete(key);
  return true;
}

export function listPendingApprovals(runId: string): { nodeId: string; prompt: string }[] {
  const out: { nodeId: string; prompt: string }[] = [];
  for (const p of pendingApprovals.values()) {
    if (p.runId === runId) out.push({ nodeId: p.nodeId, prompt: p.prompt });
  }
  return out;
}

// ---------- 内部：记忆读写 ----------

function searchMemoriesForWorkflow(query: string, kind?: string): MemoryRecord[] {
  const db = getDb();
  // 简化：select all + 标题/内容 contains
  const rows = db.select().from(schema.memories).orderBy(eq(schema.memories.pinned, 0)).all();
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => {
      if (kind && r.kind !== kind) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q);
    })
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      kind: r.kind as MemoryKind,
      title: r.title,
      content: r.content,
      agent_id: r.agent_id ?? null,
      conversation_id: r.conversation_id ?? null,
      source_run_id: r.source_run_id ?? null,
      salience: r.salience,
      pinned: r.pinned,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
}

function writeMemoryForWorkflow(
  payload: { title: string; content: string; kind: MemoryKind },
  ctx: { conversationId: string | null; runtimeRunId: string | null },
): string {
  const db = getDb();
  const now = Date.now();
  const id = `mem-${now}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.memories)
    .values({
      id,
      scope: "agent",
      kind: payload.kind,
      title: payload.title,
      content: payload.content,
      agent_id: null,
      conversation_id: ctx.conversationId,
      source_run_id: ctx.runtimeRunId,
      salience: 50,
      pinned: 0,
      created_at: now,
      updated_at: now,
    })
    .run();
  return id;
}

// ---------- 内部：模型/工具派发 ----------

function resolveModelRefForAgent(_agentId?: string | null): string | null {
  // v1: 不解析 agentId -> model_ref，直接由节点显式提供；
  // 留作未来扩展。返回 null 会让 prompt 节点显式抛错。
  void _agentId;
  return null;
}

async function dispatchSkillTool(skillId: string, input: unknown): Promise<unknown> {
  // 委托给 skill-runtime 的 runToolSkill
  const { runToolSkill } = await import("./skill-runtime");
  return runToolSkill({
    skillId,
    input: typeof input === "object" && input !== null ? input : { value: input },
  });
}

async function dispatchChatTool(toolId: string, input: unknown): Promise<unknown> {
  // 简单桥接：通过 chat-tools 的 createChatToolDescriptors 解析元数据
  // 真实调用需要构造一个 ToolSet 后再 execute；v1 仅占位返回示意性结果
  const tools = await import("./chat-tools");
  const defs = tools.createChatToolDescriptors({
    providerId: "stub",
    providerKind: "openai-compatible",
    modelId: toolId,
    capabilities: {
      textGeneration: true,
      vision: false,
      imageOutput: false,
      speechOutput: false,
      transcription: false,
      videoOutput: false,
      toolCalling: true,
      reasoning: false,
      embedding: false,
    },
    nativeTools: [],
  });
  const def = defs.find((d) => d.id === toolId);
  if (!def) {
    throw new Error(`Chat tool '${toolId}' not found.`);
  }
  void input;
  void def;
  return { tool: toolId, dispatched: true, stub: true };
}

// ---------- 内部：handoff / consult 占位派发 ----------
//
// v1 实现：把 handoff/consult 节点当作"调度意图"记录到 step_run.metadata_json，
// 实际把控制权转移给子代理的逻辑由 v2 接入。这里返回结构化结果，让工作流引擎
// 仍可正常推进并被 UI 观察。
async function dispatchChildAgentStub(opts: {
  targetAgentId: string;
  task: string;
  expectedOutput?: string;
  mode: "handoff" | "consult";
  conversationId: string | null;
  runtimeRunId: string | null;
  workflowRunId: string;
}): Promise<{ output: string; durationMs: number }> {
  const started = Date.now();
  // 校验目标代理存在
  const agent = getDb()
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, opts.targetAgentId))
    .get();
  if (!agent) {
    throw new Error(`Target agent '${opts.targetAgentId}' not found.`);
  }
  // 记录到 runtime_events，便于 UI/日志追踪
  insertRuntimeEvent({
    kind: "handoff",
    title: `${opts.mode === "handoff" ? "Handoff" : "Consult"} to ${agent.name}`,
    status: "succeeded",
    detail: {
      workflowRunId: opts.workflowRunId,
      agentId: opts.targetAgentId,
      task: opts.task,
      expectedOutput: opts.expectedOutput ?? null,
      stub: true,
      mode: opts.mode,
    },
  });
  const output =
    `[${opts.mode === "handoff" ? "Handoff" : "Consult"} stub] ` +
    `target=${agent.name}, task=${opts.task}`;
  return { output, durationMs: Date.now() - started };
}
