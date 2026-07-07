import { randomUUID } from "node:crypto";
import {
  Agent,
  OpenAIProvider,
  Runner,
  handoff,
  tool,
  webSearchTool,
  type HandoffInputData,
  type ModelSettings,
  type Tool,
} from "@openai/agents";
import { createAiSdkUiMessageStreamResponse } from "@openai/agents-extensions/ai-sdk-ui";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  normalizeChatToolSelection,
  type AgentHandoffConfig,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentToolPolicy,
  type ChatReasoningLevel,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type ModelCapabilities,
} from "../../shared/types";
import type { ResolvedChatModel } from "./chat-agent";
import {
  createAgentRun,
  getAgent,
  getApiKey,
  getModelApiKey,
  insertHarnessEvent,
  listAgents,
  updateAgentRun,
  upsertAgentRuntimeState,
} from "./db";
import { executeChatHostTool, type ChatToolModelContext } from "./chat-tools";

interface RunOpenAIAgentsChatOptions {
  messages: UIMessage[];
  modelRef: string;
  resolved: ResolvedChatModel;
  conversationId?: string;
  preferredAgentId?: string | null;
  reasoning?: ChatReasoningLevel;
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => string;
}

interface RuntimeBuildContext {
  runId: string;
  modelRef: string;
  rootModelId: string;
  modelProvider: OpenAIProvider;
  modelContext: ChatToolModelContext;
  conversationId?: string;
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => string;
}

const handoffPayloadSchema = z.object({
  reason: z.string().min(1).max(600),
  taskSummary: z.string().min(1).max(2_000),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  expectedOutput: z.string().min(1).max(1_000),
});

const emptySchema = z.object({}).strict();
const memorySearchSchema = z
  .object({ query: z.string().min(1).max(500), limit: z.number().min(1).max(12).optional() })
  .strict();
const workspaceSnapshotSchema = z.object({ limit: z.number().min(1).max(10).optional() }).strict();
const conversationSearchSchema = z
  .object({ query: z.string().min(1).max(500), limit: z.number().min(1).max(12).optional() })
  .strict();
const memorySaveSchema = z
  .object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(4_000),
    scope: z.enum(["global", "agent", "conversation"]).optional(),
    kind: z.enum(["fact", "preference", "episode", "profile", "skill"]).optional(),
    salience: z.number().min(1).max(100).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();
const consultSchema = z
  .object({
    task: z.string().min(1).max(2_000),
    expectedOutput: z.string().max(1_000).optional(),
  })
  .strict();

export async function runOpenAIAgentsChat({
  messages,
  modelRef,
  resolved,
  conversationId,
  preferredAgentId,
  reasoning,
  toolSelection,
  buildAgentSystemPrompt,
}: RunOpenAIAgentsChatOptions): Promise<Response> {
  if (resolved.providerKind !== "openai") {
    throw new Error("OpenAI Agents runtime only supports OpenAI provider models.");
  }
  if (!resolved.providerId || !resolved.modelId) {
    throw new Error("OpenAI model metadata is incomplete.");
  }

  const apiKey =
    getModelApiKey(resolved.providerId, resolved.modelId) ?? getApiKey(resolved.providerId);
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const runId = randomUUID();
  const inputSummary = summarizeText(extractTranscript(messages, 6), 1_000);
  createAgentRun({
    id: runId,
    conversation_id: conversationId ?? null,
    root_agent_id: DEFAULT_AGENT_ID,
    final_agent_id: DEFAULT_AGENT_ID,
    status: "running",
    model_ref: modelRef,
    trace_id: runId,
    input_summary: inputSummary,
    output_summary: null,
    error: null,
    usage_json: null,
    finished_at: null,
  });
  upsertAgentRuntimeState({
    agent_id: DEFAULT_AGENT_ID,
    status: "running",
    current_run_id: runId,
    last_error: null,
  });
  insertHarnessEvent({
    kind: "agent",
    title: "Void orchestration started",
    status: "running",
    detail: { runId, conversationId, modelRef, preferredAgentId },
  });

  const modelProvider = new OpenAIProvider({ apiKey, useResponses: true });
  const modelContext = toModelContext(modelRef, resolved);
  const buildContext: RuntimeBuildContext = {
    runId,
    modelRef,
    rootModelId: resolved.modelId,
    modelProvider,
    modelContext,
    conversationId,
    toolSelection,
    buildAgentSystemPrompt,
  };
  const agents = buildAgentGraph(buildContext, preferredAgentId);
  const runtimeConfig = readRuntimeConfig(agents.voidProfile.runtime_config_json);
  const modelSettings = toModelSettings(resolved, reasoning, runtimeConfig);
  const runner = new Runner({
    modelProvider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    workflowName: "Void agent orchestration",
    groupId: conversationId,
    traceId: runId,
    modelSettings,
    toolExecution: { maxFunctionToolConcurrency: 2, preApprovalInputGuardrails: true },
    toolNotFoundBehavior: "return_error_to_model",
  });

  const stream = await runner.run(agents.voidAgent, buildAgentsInput(messages, preferredAgentId), {
    stream: true,
    maxTurns: runtimeConfig.maxTurns,
    context: { runId, conversationId, preferredAgentId },
  });

  void stream.completed
    .then(() => {
      const finalAgentId =
        agents.agentIdByName.get(stream.lastAgent?.name ?? "") ?? DEFAULT_AGENT_ID;
      const outputSummary = summarizeText(String(stream.finalOutput ?? ""), 1_000);
      updateAgentRun(runId, {
        status: stream.interruptions.length > 0 ? "cancelled" : "succeeded",
        final_agent_id: finalAgentId,
        finished_at: Date.now(),
        output_summary: outputSummary,
        usage_json: JSON.stringify(summarizeUsage(stream.rawResponses)),
      });
      for (const agent of agents.profiles) {
        upsertAgentRuntimeState({
          agent_id: agent.id,
          status: "idle",
          current_run_id: null,
          last_error: null,
        });
      }
      insertHarnessEvent({
        kind: "agent",
        title: "Void orchestration finished",
        status: stream.interruptions.length > 0 ? "cancelled" : "succeeded",
        detail: { runId, finalAgentId, outputSummary },
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      updateAgentRun(runId, {
        status: "failed",
        finished_at: Date.now(),
        error: message,
      });
      upsertAgentRuntimeState({
        agent_id: DEFAULT_AGENT_ID,
        status: "failed",
        current_run_id: runId,
        last_error: message,
      });
      insertHarnessEvent({
        kind: "agent",
        title: "Void orchestration failed",
        status: "failed",
        detail: { runId, error: message },
      });
    });

  return createAiSdkUiMessageStreamResponse(stream);
}

function buildAgentGraph(
  context: RuntimeBuildContext,
  preferredAgentId?: string | null,
): {
  voidProfile: AgentProfile;
  voidAgent: Agent;
  profiles: AgentProfile[];
  agentIdByName: Map<string, string>;
} {
  const voidProfile = getAgent(DEFAULT_AGENT_ID);
  if (!voidProfile) throw new Error("Void agent profile is missing.");
  const childProfiles = listAgents().filter(
    (agent) => agent.kind === "child" && agent.status === "active" && !agent.locked,
  );
  const agentIdByName = new Map<string, string>([[safeAgentName(voidProfile), DEFAULT_AGENT_ID]]);
  const childAgents = new Map<string, Agent>();

  for (const profile of childProfiles) {
    const child = new Agent({
      name: safeAgentName(profile),
      instructions: childInstructions(profile, context),
      handoffDescription: profile.description,
      model: resolveAgentModel(profile, context.rootModelId),
      modelSettings: { ...toModelSettingsFromRuntime(profile.runtime_config_json), store: false },
      tools: createAgentTools(profile, context),
      toolUseBehavior: "run_llm_again",
    });
    childAgents.set(profile.id, child);
    agentIdByName.set(child.name, profile.id);
  }

  const handoffs = childProfiles
    .filter((profile) => {
      const mode = readHandoffConfig(profile.handoff_config_json).mode;
      return mode === "handoff" || mode === "both";
    })
    .map((profile) =>
      handoff(childAgents.get(profile.id)!, {
        toolNameOverride: "handoff_to_" + toolSlug(profile),
        toolDescriptionOverride: handoffDescription(profile),
        inputType: handoffPayloadSchema,
        inputFilter: compactHandoffInput,
        onHandoff: (_runContext, payload) => {
          insertHarnessEvent({
            kind: "handoff",
            title: "Void handed off to " + profile.name,
            status: "running",
            detail: { runId: context.runId, agentId: profile.id, payload },
          });
          upsertAgentRuntimeState({
            agent_id: DEFAULT_AGENT_ID,
            status: "handoff",
            current_run_id: context.runId,
            last_handoff_at: Date.now(),
            last_error: null,
          });
          upsertAgentRuntimeState({
            agent_id: profile.id,
            status: "running",
            current_run_id: context.runId,
            last_handoff_at: Date.now(),
            last_error: null,
          });
        },
      }),
    );

  const consultTools = childProfiles
    .filter((profile) => {
      const mode = readHandoffConfig(profile.handoff_config_json).mode;
      return mode === "consult" || mode === "both";
    })
    .map((profile) =>
      childAgents.get(profile.id)!.asTool({
        toolName: "consult_" + toolSlug(profile),
        toolDescription:
          "Consult " + profile.name + " when Void should keep ownership but needs specialist help.",
        parameters: consultSchema,
        inputBuilder: ({ params }) =>
          [
            "Specialist consultation request.",
            "Task: " + params.task,
            params.expectedOutput ? "Expected output: " + params.expectedOutput : "",
          ]
            .filter(Boolean)
            .join("\n"),
        runConfig: {
          modelProvider: context.modelProvider,
          tracingDisabled: true,
          traceIncludeSensitiveData: false,
          workflowName: "Void consults " + profile.name,
          groupId: context.conversationId,
        },
        runOptions: { maxTurns: readRuntimeConfig(profile.runtime_config_json).maxTurns },
        onStream: () => {
          upsertAgentRuntimeState({
            agent_id: profile.id,
            status: "running",
            current_run_id: context.runId,
            last_error: null,
          });
        },
      }),
    );

  const preferred = preferredAgentId
    ? childProfiles.find((profile) => profile.id === preferredAgentId)
    : undefined;
  const voidAgent = new Agent({
    name: safeAgentName(voidProfile),
    instructions: voidInstructions(voidProfile, childProfiles, context, preferred),
    handoffDescription: voidProfile.description,
    model: resolveAgentModel(voidProfile, context.rootModelId),
    modelSettings: { store: false },
    tools: [...createAgentTools(voidProfile, context), ...consultTools],
    handoffs,
    toolUseBehavior: "run_llm_again",
  });

  return {
    voidProfile,
    voidAgent,
    profiles: [voidProfile, ...childProfiles],
    agentIdByName,
  };
}

function createAgentTools(profile: AgentProfile, context: RuntimeBuildContext): Tool[] {
  const policy = readToolPolicy(profile.tool_policy_json);
  const selectedIds = selectedToolIds(
    context.toolSelection,
    policy,
    profile.id === DEFAULT_AGENT_ID,
  );
  return selectedIds.flatMap((toolId) => createSingleAgentTool(toolId, profile, context));
}

function createSingleAgentTool(
  toolId: ChatToolId,
  profile: AgentProfile,
  context: RuntimeBuildContext,
): Tool[] {
  if (toolId === "web_search") {
    return [
      webSearchTool({
        name: "web_search",
        externalWebAccess: true,
        searchContextSize: "medium",
      }),
    ];
  }

  const execute = (input: unknown) =>
    executeChatHostTool({
      toolId,
      input,
      model: context.modelContext,
      conversationId: context.conversationId,
      agentId: profile.id,
      audit: { runId: context.runId, agentId: profile.id },
    });
  const approvalTools = new Set<ChatToolId>(["conversation_search", "memory_save"]);
  const approval = approvalTools.has(toolId)
    ? async (): Promise<boolean> => {
        insertHarnessEvent({
          kind: "approval",
          title: "Approval requested: " + toolId,
          status: "queued",
          detail: { runId: context.runId, agentId: profile.id, toolId },
        });
        return true;
      }
    : undefined;

  switch (toolId) {
    case "current_time":
      return [
        tool({
          name: toolId,
          description: "Read current local date and time.",
          parameters: emptySchema,
          execute,
        }),
      ];
    case "memory_search":
      return [
        tool({
          name: toolId,
          description: "Search saved local memories relevant to the task.",
          parameters: memorySearchSchema,
          execute,
        }),
      ];
    case "workspace_snapshot":
      return [
        tool({
          name: toolId,
          description: "Read a compact local workspace summary.",
          parameters: workspaceSnapshotSchema,
          execute,
        }),
      ];
    case "model_capabilities":
      return [
        tool({
          name: toolId,
          description: "Inspect the selected model and enabled chat tools.",
          parameters: emptySchema,
          execute,
        }),
      ];
    case "conversation_search":
      return [
        tool({
          name: toolId,
          description: "Search messages in this conversation after user approval.",
          parameters: conversationSearchSchema,
          execute,
          needsApproval: approval,
        }),
      ];
    case "memory_save":
      return [
        tool({
          name: toolId,
          description: "Save a new local memory after user approval.",
          parameters: memorySaveSchema,
          execute,
          needsApproval: approval,
        }),
      ];
  }
}

function selectedToolIds(
  rawSelection: ChatToolSelectionRequest | undefined,
  policy: AgentToolPolicy,
  isVoid: boolean,
): ChatToolId[] {
  const selection = normalizeChatToolSelection(rawSelection);
  if (selection.mode === "off") return [];
  const defaultAuto: ChatToolId[] = [
    "web_search",
    "current_time",
    "memory_search",
    "workspace_snapshot",
    "model_capabilities",
  ];
  const selected = selection.mode === "manual" ? selection.selectedToolIds : defaultAuto;
  const allowed =
    policy.mode === "custom" && policy.allowedToolIds.length > 0
      ? selected.filter((id) => policy.allowedToolIds.includes(id))
      : selected;
  return [...new Set(isVoid ? allowed : allowed.filter((id) => id !== "memory_save"))].filter(
    (id): id is ChatToolId => CHAT_TOOL_IDS.includes(id),
  );
}

function voidInstructions(
  voidProfile: AgentProfile,
  children: AgentProfile[],
  context: RuntimeBuildContext,
  preferred?: AgentProfile,
): string {
  const childLines = children.map((agent) => {
    const handoffConfig = readHandoffConfig(agent.handoff_config_json);
    return [
      "- " + agent.name + " (" + handoffConfig.mode + "): " + agent.role,
      agent.description,
      handoffConfig.accepts.length ? "Best for: " + handoffConfig.accepts.join(", ") : "",
      "Expected output: " + handoffConfig.expectedOutput,
    ]
      .filter(Boolean)
      .join(" ");
  });
  return [
    context.buildAgentSystemPrompt(voidProfile.id, context.conversationId),
    "You are Void, the root orchestrator. Every OpenAI chat request enters through you.",
    "Decide whether to answer directly, consult a child agent as a tool, or hand off ownership to a child agent.",
    "Handoff payload must contain reason, taskSummary, priority, and expectedOutput.",
    "When using consult mode, synthesize the specialist output into a final answer instead of exposing raw coordination notes.",
    preferred
      ? "The user selected " +
        preferred.name +
        " as a routing preference. Treat it as a hint, not an override."
      : "",
    childLines.length ? "Available child agents:\n" + childLines.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function childInstructions(profile: AgentProfile, context: RuntimeBuildContext): string {
  const handoffConfig = readHandoffConfig(profile.handoff_config_json);
  return [
    context.buildAgentSystemPrompt(profile.id, context.conversationId),
    "You are a child agent under Void. Stay inside your specialty and return concise, actionable output.",
    "Do not claim ownership of the whole product unless a handoff explicitly transferred the task to you.",
    "Expected output: " + handoffConfig.expectedOutput,
  ].join("\n\n");
}

function buildAgentsInput(messages: UIMessage[], preferredAgentId?: string | null): string {
  const transcript = extractTranscript(messages, 12);
  return [
    preferredAgentId ? "Preferred child agent hint: " + preferredAgentId : "",
    "Recent conversation, with tool noise removed:",
    transcript,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractTranscript(messages: UIMessage[], limit: number): string {
  return messages
    .slice(-limit)
    .map((message) => {
      const text = (message.parts ?? [])
        .filter(
          (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) return "";
      return (
        (message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System") +
        ": " +
        text
      );
    })
    .filter(Boolean)
    .join("\n\n");
}

function compactHandoffInput(input: HandoffInputData): HandoffInputData {
  if (typeof input.inputHistory !== "string") return input;
  return {
    ...input,
    inputHistory: summarizeText(input.inputHistory, 4_000),
  };
}

function toModelContext(modelRef: string, resolved: ResolvedChatModel): ChatToolModelContext {
  const fallbackModelId = modelRef.split("/").slice(1).join("/") || modelRef;
  return {
    providerId: resolved.providerId ?? modelRef.split("/")[0] ?? "openai",
    providerKind: "openai",
    modelId: resolved.modelId ?? fallbackModelId,
    capabilities: resolved.capabilities ?? defaultCapabilities(),
    nativeTools: [{ id: "web_search", toolName: "web_search", tool: {}, providerExecuted: true }],
  };
}

function toModelSettings(
  resolved: ResolvedChatModel,
  reasoning: ChatReasoningLevel | undefined,
  runtimeConfig: AgentRuntimeConfig,
): ModelSettings {
  return {
    temperature: runtimeConfig.temperature ?? resolved.temperature,
    topP: resolved.topP,
    maxTokens: resolved.maxOutputTokens,
    reasoning:
      reasoning && reasoning !== "provider-default" && reasoning !== "none"
        ? { effort: reasoning }
        : undefined,
    store: false,
  };
}

function toModelSettingsFromRuntime(raw: string): ModelSettings {
  const runtime = readRuntimeConfig(raw);
  return { temperature: runtime.temperature, store: false };
}

function resolveAgentModel(profile: AgentProfile, fallbackModelId: string): string {
  if (!profile.model_ref) return fallbackModelId;
  const [providerId, ...modelParts] = profile.model_ref.split("/");
  if (providerId !== "openai") return fallbackModelId;
  return modelParts.join("/") || fallbackModelId;
}

function readToolPolicy(raw: string): AgentToolPolicy {
  return readJsonObject(raw, DEFAULT_AGENT_TOOL_POLICY, (value) => ({
    mode: value.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: Array.isArray(value.allowedToolIds)
      ? value.allowedToolIds.filter(isChatToolId)
      : [],
    requireApprovalToolIds: Array.isArray(value.requireApprovalToolIds)
      ? value.requireApprovalToolIds.filter(isChatToolId)
      : DEFAULT_AGENT_TOOL_POLICY.requireApprovalToolIds,
  }));
}

function readHandoffConfig(raw: string): AgentHandoffConfig {
  return readJsonObject(raw, DEFAULT_AGENT_HANDOFF_CONFIG, (value) => ({
    mode:
      value.mode === "handoff" || value.mode === "both" || value.mode === "consult"
        ? value.mode
        : DEFAULT_AGENT_HANDOFF_CONFIG.mode,
    priority:
      value.priority === "low" || value.priority === "high" || value.priority === "normal"
        ? value.priority
        : "normal",
    accepts: Array.isArray(value.accepts)
      ? value.accepts.map(String).filter(Boolean).slice(0, 8)
      : [],
    expectedOutput:
      typeof value.expectedOutput === "string" && value.expectedOutput.trim()
        ? value.expectedOutput.trim()
        : DEFAULT_AGENT_HANDOFF_CONFIG.expectedOutput,
  }));
}

function readRuntimeConfig(raw: string): AgentRuntimeConfig {
  return readJsonObject(raw, DEFAULT_AGENT_RUNTIME_CONFIG, (value) => ({
    maxTurns: clampNumber(value.maxTurns, DEFAULT_AGENT_RUNTIME_CONFIG.maxTurns, 1, 20),
    temperature:
      typeof value.temperature === "number" ? clampNumber(value.temperature, 0.7, 0, 2) : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
  }));
}

function readJsonObject<T>(
  raw: string,
  fallback: T,
  normalize: (value: Record<string, unknown>) => T,
): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalize(parsed as Record<string, unknown>);
    }
  } catch {
    // Use fallback below.
  }
  return fallback;
}

function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

function handoffDescription(profile: AgentProfile): string {
  const config = readHandoffConfig(profile.handoff_config_json);
  return [
    "Transfer ownership to " + profile.name + " for " + profile.role + ".",
    profile.description,
    "Expected output: " + config.expectedOutput,
  ].join(" ");
}

function toolSlug(profile: AgentProfile): string {
  return profile.id
    .replace(/^agent-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeAgentName(profile: AgentProfile): string {
  return profile.id === DEFAULT_AGENT_ID
    ? "Void"
    : profile.name.replace(/[^\w -]+/g, "").trim() || profile.id;
}

function summarizeUsage(rawResponses: Array<{ usage?: unknown }>): Record<string, unknown> {
  return {
    responses: rawResponses.length,
    usage: rawResponses.map((response) => response.usage ?? null),
  };
}

function defaultCapabilities(): ModelCapabilities {
  return {
    textGeneration: true,
    vision: false,
    imageOutput: false,
    speechOutput: false,
    transcription: false,
    videoOutput: false,
    toolCalling: true,
    reasoning: true,
    embedding: false,
  };
}

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function summarizeText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? compact.slice(0, maxLength - 3) + "..." : compact;
}
