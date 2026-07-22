/**
 * 把工作流引擎的抽象依赖（dispatchTool / dispatchChildAgent / readMemories ...）
 * 桥接到项目里已有的真实能力。
 *
 * 这层是「副作用适配器」：测试可以注入假 deps，本模块负责生产路径上的接线。
 */

import { isStepCount, ToolLoopAgent } from "ai";
import {
  buildAgentSystemPrompt,
  getAgent,
  getSetting,
  insertRuntimeEvent,
  saveAgentInstance,
  saveCollaborationMessage,
} from "./db";
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  SettingKey,
  normalizeAgentRuntimeConfig,
  normalizeMaxConcurrentSubagents,
  normalizeAgentToolPolicy,
  type MemoryKind,
  type MemoryRecord,
} from "../../shared/types";
import { AgentCoordinator } from "./agent-coordinator";
import { buildChatToolRuntime } from "./chat-tools";
import { resolveModel } from "./providers";
import { memoryOrchestrator } from "./memory-orchestrator";

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
      dispatchWorkflowChildAgent({
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
    readMemories: async (query: string, kind?: string): Promise<MemoryRecord[]> => {
      return memoryOrchestrator.retrieve({
        query,
        kind: kind as MemoryKind | undefined,
        agentId: opts.triggeredByAgentId,
      });
    },
    writeMemory: (payload: { title: string; content: string; kind: MemoryKind }): string => {
      return memoryOrchestrator.saveExplicit({
        title: payload.title,
        content: payload.content,
        kind: payload.kind,
        agentId: opts.triggeredByAgentId,
        sourceConversationId: opts.conversationId ?? null,
        sourceRunId: opts.runtimeRunId ?? null,
      }).id;
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

// 简化：select all + 标题/内容 contains
// ---------- 内部：模型/工具派发 ----------

function resolveModelRefForAgent(_agentId?: string | null): string | null {
  // v1: 不解析 agentId -> model_ref，直接由节点显式提供；
  // 留作未来扩展。返回 null 会让 prompt 节点显式抛错。
  return (_agentId ? getAgent(_agentId)?.model_ref : null) ?? getSetting(SettingKey.SelectedModel);
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

const workflowCoordinators = new Map<string, AgentCoordinator>();

async function dispatchWorkflowChildAgent(opts: {
  targetAgentId: string;
  task: string;
  expectedOutput?: string;
  mode: "handoff" | "consult";
  conversationId: string | null;
  runtimeRunId: string | null;
  workflowRunId: string;
}): Promise<{ output: string; durationMs: number }> {
  const started = Date.now();
  const agent = getAgent(opts.targetAgentId);
  if (!agent) throw new Error(`Target agent '${opts.targetAgentId}' not found.`);

  const coordinatorKey = opts.runtimeRunId ?? `workflow:${opts.workflowRunId}`;
  let coordinator = workflowCoordinators.get(coordinatorKey);
  if (!coordinator) {
    coordinator = new AgentCoordinator({
      runId: coordinatorKey,
      maxConcurrentSubagents: normalizeMaxConcurrentSubagents(
        getSetting(SettingKey.MaxConcurrentSubagents),
        normalizeAgentRuntimeConfig(agent.runtime_config_json).maxConcurrentSubagents,
      ),
      onEvent: (event) =>
        insertRuntimeEvent({
          runId: opts.runtimeRunId,
          conversationId: opts.conversationId,
          agentId: event.agentPath === "/root" ? null : agent.id,
          eventType: event.type,
          agentPath: event.agentPath,
          parentAgentPath: event.parentAgentPath,
          sequence: event.sequence,
          kind: event.type === "ownership.changed" ? "handoff" : "diagnostic",
          status: event.phase === "error" ? "failed" : "running",
          title: event.type,
          detail: event.payload,
        }),
    });
    workflowCoordinators.set(coordinatorKey, coordinator);
  }

  const modelRef = resolveModelRefForAgent(agent.id);
  if (!modelRef) throw new Error(`No model configured for agent '${agent.name}'.`);
  const runtimeConfig = normalizeAgentRuntimeConfig(agent.runtime_config_json);
  const instance = coordinator.spawnAgent({
    agentId: agent.id,
    parentPath: "/root",
    taskName: agent.name,
    message: opts.task,
    execute: async ({ instance: runningInstance, abortSignal }) => {
      if (opts.runtimeRunId) saveAgentInstance({ ...runningInstance, run_id: opts.runtimeRunId });
      const resolved = resolveModel(modelRef);
      const toolPolicy = normalizeAgentToolPolicy(
        agent.tool_policy_json,
        DEFAULT_AGENT_TOOL_POLICY,
      );
      const allowed = toolPolicy.allowedToolIds.filter(
        (id) => !toolPolicy.requireApprovalToolIds.includes(id),
      );
      const toolRuntime = buildChatToolRuntime({
        selection: { mode: allowed.length ? "manual" : "off", selectedToolIds: allowed },
        model: {
          providerId: resolved.providerId,
          providerKind: resolved.providerKind,
          modelId: resolved.modelId,
          capabilities: resolved.capabilities,
          nativeTools: resolved.nativeTools,
        },
        conversationId: opts.conversationId ?? undefined,
        agentId: agent.id,
      });
      const child = new ToolLoopAgent({
        id: runningInstance.agent_path,
        model: resolved.model,
        instructions: [
          await buildAgentSystemPrompt(agent.id, opts.conversationId ?? undefined),
          "You are executing a bounded workflow task. Return a complete result to the workflow.",
          opts.expectedOutput ? `Expected output: ${opts.expectedOutput}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools: toolRuntime.tools ?? {},
        activeTools: toolRuntime.activeTools,
        toolChoice: toolRuntime.toolChoice,
        stopWhen: isStepCount(runtimeConfig.maxTurns ?? DEFAULT_AGENT_RUNTIME_CONFIG.maxTurns),
        temperature: runtimeConfig.temperature ?? resolved.temperature,
        topP: runtimeConfig.topP ?? resolved.topP,
        maxOutputTokens: runtimeConfig.maxOutputTokens ?? resolved.maxOutputTokens,
        providerOptions: resolved.providerOptions,
      });
      const result = await child.generate({
        prompt: opts.task,
        abortSignal,
        timeout: { totalMs: runtimeConfig.totalTimeoutMs },
      });
      return result.text;
    },
  });

  if (opts.mode === "handoff") coordinator.transferOwnership(instance.agent_path);
  if (opts.runtimeRunId) saveAgentInstance({ ...instance, run_id: opts.runtimeRunId });
  insertRuntimeEvent({
    runId: opts.runtimeRunId,
    conversationId: opts.conversationId,
    agentId: agent.id,
    agentPath: instance.agent_path,
    eventType: "collaboration.call",
    kind: "handoff",
    title: `${opts.mode === "handoff" ? "Handoff" : "Consult"} to ${agent.name}`,
    status: "running",
    detail: {
      workflowRunId: opts.workflowRunId,
      task: opts.task,
      expectedOutput: opts.expectedOutput ?? null,
      mode: opts.mode,
    },
  });

  const output = await coordinator.waitAgent(instance.agent_path);
  if (opts.runtimeRunId) {
    for (const record of coordinator.listAgents()) {
      saveAgentInstance({ ...record, run_id: opts.runtimeRunId });
    }
    for (const message of coordinator.listMessages()) {
      saveCollaborationMessage({ ...message, run_id: opts.runtimeRunId });
    }
  }
  return { output, durationMs: Date.now() - started };
}
