import { randomUUID } from "node:crypto";
import { createAgentUIStreamResponse, isStepCount, jsonSchema, ToolLoopAgent, tool } from "ai";
import type {
  streamText,
  ToolApprovalConfiguration,
  ToolApprovalStatus,
  ToolSet,
  UIMessage,
  UIMessageStreamOptions,
} from "ai";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  isChatToolReference,
  normalizeChatToolSelection,
  type AgentHandoffConfig,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentRuntimeStatus,
  type AgentToolPolicy,
  type ChatMessageMetadata,
  type ChatReasoningLevel,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type ModelCapabilities,
} from "../../shared/types";
import { appendReactionFeedback, type ResolvedChatModel } from "./chat-agent";
import { z } from "zod";
import {
  auditChatToolApprovalResponses,
  buildChatToolRuntime,
  type ChatToolModelContext,
  type ChatToolRuntimeConfig,
} from "./chat-tools";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import { loadAgentGraph } from "./agent-graph";
import {
  upsertAgentRuntimeState,
  upsertConversationAgentState,
  createRuntimeRun,
  createRuntimeStep,
  updateRuntimeRun,
  updateRuntimeStep,
  insertRuntimeEvent,
} from "./db";
import {
  createSandboxSnapshot,
  getOrCreateSandboxSession,
  listSandboxFiles,
  listSandboxSessionArtifacts,
  readSandboxFile,
  registerSandboxPreviewPort,
  restoreSandboxSnapshot,
  runSandboxCommand,
  writeSandboxFile,
  type SandboxContext,
} from "./sandbox-agents";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";

type StreamTextOptions = Parameters<typeof streamText>[0];
type MessageMetadataCallback = NonNullable<
  UIMessageStreamOptions<UIMessage<ChatMessageMetadata>>["messageMetadata"]
>;

export interface RunAgentChatOptions {
  messages: UIMessage[];
  modelRef: string;
  resolved: ResolvedChatModel;
  conversationId?: string;
  preferredAgentId?: string | null;
  reasoning?: StreamTextOptions["reasoning"];
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => Promise<string>;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
}

interface RuntimeContext {
  runId: string;
  rootAgent: AgentProfile;
  enabledChildren: AgentProfile[];
  modelRef: string;
  resolved: ResolvedChatModel;
  modelContext: ChatToolModelContext;
  messages: UIMessage[];
  conversationId?: string;
  preferredAgentId?: string | null;
  reasoning?: StreamTextOptions["reasoning"];
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => Promise<string>;
  resolveModel: (modelRef: string) => ResolvedChatModel;
  finalAgentId: string;
  sandbox?: SandboxContext;
  approvalRequested: boolean;
}

const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

const handoffInputSchema = jsonSchema<{
  reason: string;
  taskSummary: string;
  priority?: "low" | "normal" | "high";
  expectedOutput?: string;
}>({
  type: "object",
  properties: {
    reason: { type: "string", description: "Why ownership should move to this agent." },
    taskSummary: { type: "string", description: "The task and context to hand off." },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    expectedOutput: { type: "string", description: "What the child agent should return." },
  },
  required: ["reason", "taskSummary"],
  additionalProperties: false,
});

const consultInputSchema = jsonSchema<{ task: string; expectedOutput?: string }>({
  type: "object",
  properties: {
    task: { type: "string", description: "Specialist task for the child agent." },
    expectedOutput: { type: "string", description: "Requested response format or focus." },
  },
  required: ["task"],
  additionalProperties: false,
});

export async function runAgentChat(options: RunAgentChatOptions): Promise<Response> {
  const resolveModel = options.resolveModel ?? (await import("./providers")).resolveModel;
  const { rootAgent, enabledChildren } = loadAgentGraph(DEFAULT_AGENT_ID);

  const rootModelRef = rootAgent.model_ref || options.modelRef;
  const rootResolved =
    rootModelRef === options.modelRef ? options.resolved : resolveModel(rootModelRef);
  const rootRuntimeConfig = readRuntimeConfig(rootAgent.runtime_config_json);
  const resolved = applyRuntimeConfig(rootResolved, rootRuntimeConfig);
  const modelContext = toChatToolModelContext(rootModelRef, resolved);
  const runId = randomUUID();
  createRuntimeRun({
    id: runId,
    conversation_id: options.conversationId ?? null,
    root_agent_id: DEFAULT_AGENT_ID,
    final_agent_id: DEFAULT_AGENT_ID,
    status: "running",
    model_ref: rootModelRef,
    trace_id: runId,
    input_summary: summarizeText(extractTranscript(options.messages, 6), 1_000),
    output_summary: null,
    error: null,
    usage_json: null,
    finished_at: null,
  });
  recordState({
    agentId: DEFAULT_AGENT_ID,
    status: "running",
    runId,
    conversationId: options.conversationId,
    summary: "Void is planning",
  });
  createRuntimeStep({
    run_id: runId,
    agent_id: DEFAULT_AGENT_ID,
    kind: "input_guardrail",
    status: "succeeded",
    title: "Input guardrails passed",
    detail: { conversationId: options.conversationId, messageCount: options.messages.length },
    finished_at: Date.now(),
  });
  insertRuntimeEvent({
    kind: "agent",
    title: "Void orchestration started",
    status: "running",
    detail: {
      runId,
      modelRef: rootModelRef,
      providerKind: resolved.providerKind,
      enabledChildAgents: enabledChildren.map((agent) => agent.id),
    },
  });

  auditChatToolApprovalResponses({
    messages: options.messages,
    model: modelContext,
    conversationId: options.conversationId,
    agentId: DEFAULT_AGENT_ID,
  });

  const context: RuntimeContext = {
    runId,
    rootAgent,
    enabledChildren,
    modelRef: rootModelRef,
    resolved,
    modelContext,
    messages: options.messages,
    conversationId: options.conversationId,
    preferredAgentId: options.preferredAgentId,
    reasoning: rootRuntimeConfig.reasoning
      ? normalizeRuntimeReasoning(rootRuntimeConfig.reasoning)
      : options.reasoning,
    toolSelection: applyAgentToolPolicy(
      options.toolSelection,
      readToolPolicy(rootAgent.tool_policy_json),
    ),
    buildAgentSystemPrompt: options.buildAgentSystemPrompt,
    resolveModel,
    finalAgentId: DEFAULT_AGENT_ID,
    approvalRequested: false,
  };

  try {
    const toolRuntime = await buildRootToolRuntime(context);
    const tracker = createExecutionTracker({
      runId,
      modelRef: rootModelRef,
      agentId: DEFAULT_AGENT_ID,
      context,
    });
    const agent = createToolLoopAgent({
      id: DEFAULT_AGENT_ID,
      modelRef: rootModelRef,
      resolved,
      instructions: await createRootInstructions(context, toolRuntime.instructions),
      messages: options.messages,
      runtimeConfig: rootRuntimeConfig,
      reasoning: context.reasoning,
      toolRuntime,
      messageStepRecorder: tracker.recordModelStep,
    });

    return await createAgentUIStreamResponse({
      agent,
      uiMessages: options.messages,
      sendReasoning: true,
      sendSources: true,
      messageMetadata: tracker.messageMetadata,
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        finishRun(context, "failed", { error: message });
        console.error("[agent-runtime] stream failed:", message);
        return message || "Agent stream failed";
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(context, "failed", { error: message });
    throw error;
  }
}

async function buildRootToolRuntime(context: RuntimeContext): Promise<ChatToolRuntimeConfig> {
  const base = buildChatToolRuntime({
    selection: context.toolSelection,
    model: context.modelContext,
    conversationId: context.conversationId,
    agentId: DEFAULT_AGENT_ID,
  });

  if (!context.modelContext.capabilities.toolCalling || base.toolChoice === "none") {
    return base;
  }

  const tools: ToolSet = { ...base.tools };
  const activeTools = new Set<string>(base.activeTools ?? []);
  const policy = readToolPolicy(context.rootAgent.tool_policy_json);

  const sandboxToolIds = selectedSandboxToolIds(context, policy);
  if (sandboxToolIds.length > 0) {
    context.sandbox = await getOrCreateSandboxSession({
      conversationId: context.conversationId,
      runId: context.runId,
      agentId: DEFAULT_AGENT_ID,
      preferredMode:
        readRuntimeConfig(context.rootAgent.runtime_config_json).sandboxPolicy === "docker"
          ? "docker"
          : "local",
    });
    for (const [toolName, value] of Object.entries(createSandboxTools(context, sandboxToolIds))) {
      assignTool(tools, toolName, value);
      activeTools.add(toolName);
    }
  }

  for (const child of context.enabledChildren) {
    const handoff = readHandoffConfig(child.handoff_config_json);
    const slug = toolSlug(child);
    if (handoff.mode === "consult" || handoff.mode === "both") {
      const toolName = "consult_" + slug;
      assignTool(tools, toolName, createConsultTool(context, child));
      activeTools.add(toolName);
    }
    if (handoff.mode === "handoff" || handoff.mode === "both") {
      const toolName = "handoff_" + slug;
      assignTool(tools, toolName, createHandoffTool(context, child));
      activeTools.add(toolName);
    }
  }

  // 仅有 Void 自身可调用工作流：把控制权转交给编排好的多步流程。
  // Child agent 不挂此工具，避免循环调度。
  const runWorkflowName = "run_workflow";
  assignTool(tools, runWorkflowName, createRunWorkflowTool(context));
  activeTools.add(runWorkflowName);

  const names = [...activeTools];
  return {
    ...base,
    tools,
    activeTools: names,
    toolChoice: names.length ? "auto" : "none",
    toolApproval: createGuardrailApproval(context, new Set(base.approvalToolNames ?? [])),
    stopWhen: isStepCount(readRuntimeConfig(context.rootAgent.runtime_config_json).maxTurns),
    onStepEnd: (event) => {
      base.onStepEnd?.(event);
      return undefined;
    },
    instructions: [base.instructions, createSandboxIsolationNote(context)]
      .filter(Boolean)
      .join("\n"),
  };
}

function createToolLoopAgent({
  id,
  resolved,
  instructions,
  messages,
  runtimeConfig,
  reasoning,
  toolRuntime,
  messageStepRecorder,
}: {
  id: string;
  modelRef: string;
  resolved: ResolvedChatModel;
  instructions: string;
  messages: UIMessage[];
  runtimeConfig: AgentRuntimeConfig;
  reasoning?: StreamTextOptions["reasoning"];
  toolRuntime: ChatToolRuntimeConfig;
  messageStepRecorder?: () => void;
}): ToolLoopAgent<never, ToolSet> {
  return new ToolLoopAgent<never, ToolSet>({
    id,
    model: resolved.model,
    instructions: appendReactionFeedback(instructions, messages),
    tools: toolRuntime.tools ?? {},
    activeTools: toolRuntime.activeTools,
    toolChoice: toolRuntime.toolChoice,
    toolApproval: toolRuntime.toolApproval,
    stopWhen: toolRuntime.stopWhen ?? isStepCount(runtimeConfig.maxTurns),
    temperature: runtimeConfig.temperature ?? resolved.temperature,
    topP: runtimeConfig.topP ?? resolved.topP,
    maxOutputTokens: runtimeConfig.maxOutputTokens ?? resolved.maxOutputTokens,
    providerOptions: resolved.providerOptions,
    reasoning,
    onStepEnd: (event) => {
      messageStepRecorder?.();
      return toolRuntime.onStepEnd?.(event);
    },
  });
}

function createConsultTool(context: RuntimeContext, child: AgentProfile): ToolSet[string] {
  return tool({
    description: "Consult " + child.name + " while Void keeps ownership of the response.",
    inputSchema: consultInputSchema,
    execute: async (input) => runChildAgent(context, child, "consult", input),
  });
}

function createHandoffTool(context: RuntimeContext, child: AgentProfile): ToolSet[string] {
  return tool({
    description: "Transfer task ownership to " + child.name + " and run that child agent.",
    inputSchema: handoffInputSchema,
    execute: async (input) => runChildAgent(context, child, "handoff", input),
  });
}

// 仅在 Void 自身可用的 run_workflow 工具：触发预定义的多步工作流。
// 对齐 OpenAI Orchestration 范式中"manager 调度多步流程"的语义；
// 实际子步骤执行由工作流引擎（workflow-engine.ts）接管。
const runWorkflowInputSchema = z.object({
  workflowId: z.string().describe("Workflow definition id to run"),
  input: z.record(z.string(), z.unknown()).optional().describe("Input payload for the workflow"),
  reason: z.string().optional().describe("Why Void chose to invoke this workflow"),
});

function createRunWorkflowTool(context: RuntimeContext): ToolSet[string] {
  // 用一个可变容器承载 runId；引擎在 run_started 事件中写入，
  // 工作流节点派发（approval 队列、记忆写入、handoff 记录）会读取最新值。
  const liveRunId = { value: "" };
  return tool({
    description:
      "Run a saved multi-step workflow by id. Use when the user request is best served by a " +
      "predefined orchestration (multiple steps, agent handoffs, parallel/branch logic) rather " +
      "than a single direct answer. Returns the workflow run id and a summary of node outcomes.",
    inputSchema: runWorkflowInputSchema,
    execute: async (input) => {
      const { executeWorkflow } = await import("./workflow-engine");
      const { getWorkflowDefinition } = await import("./workflow-runs");
      const { buildDefaultEngineDeps } = await import("./workflow-dispatcher");
      const workflow = getWorkflowDefinition(input.workflowId);
      if (!workflow) {
        throw new Error(`Workflow '${input.workflowId}' not found.`);
      }
      if (workflow.status === "paused") {
        throw new Error(`Workflow '${input.workflowId}' is paused.`);
      }
      // deps 工厂：每次派发都基于最新 runId 生成
      const depsFactory = () =>
        buildDefaultEngineDeps({
          conversationId: context.conversationId ?? null,
          runtimeRunId: context.runId ?? null,
          triggeredByAgentId: DEFAULT_AGENT_ID,
          workflowRunId: liveRunId.value,
        });
      const result = await executeWorkflow({
        workflow,
        input: input.input ?? {},
        triggeredBy: "void-tool",
        triggeredByAgentId: DEFAULT_AGENT_ID,
        conversationId: context.conversationId ?? null,
        runtimeRunId: context.runId ?? null,
        deps: {
          dispatchTool: async (ref, payload) => depsFactory().dispatchTool(ref, payload),
          dispatchChildAgent: (target, payload, mode) =>
            depsFactory().dispatchChildAgent(target, payload, mode),
          waitForApproval: async (nodeId, prompt) => depsFactory().waitForApproval(nodeId, prompt),
          readMemories: (q, k) => depsFactory().readMemories(q, k),
          writeMemory: (payload) => depsFactory().writeMemory(payload),
          resolveModelRef: (node) => depsFactory().resolveModelRef(node),
          onNodeEvent: (event) => {
            if (event.type === "run_started") {
              liveRunId.value = event.runId;
            }
            if (event.type === "node_started") {
              insertRuntimeEvent({
                kind: "workflow",
                title: `Workflow node started: ${event.nodeId}`,
                status: "running",
                detail: { runId: event.runId, nodeId: event.nodeId, attempt: event.attempt },
              });
            } else if (event.type === "node_completed") {
              insertRuntimeEvent({
                kind: "workflow",
                title: `Workflow node ${event.status}: ${event.nodeId}`,
                status: event.status as "succeeded" | "failed" | "running",
                detail: {
                  runId: event.runId,
                  nodeId: event.nodeId,
                  durationMs: event.durationMs,
                },
              });
            } else if (event.type === "run_completed") {
              insertRuntimeEvent({
                kind: "workflow",
                title: `Workflow ${event.status}`,
                status: event.status,
                detail: { runId: event.runId, output: event.output, error: event.error },
              });
            }
          },
        },
      });
      return {
        runId: result.runId,
        status: result.status,
        durationMs: result.durationMs,
        output: result.output,
        error: result.error,
        reason: input.reason ?? null,
      };
    },
  });
}

async function runChildAgent(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
  input: { task?: string; taskSummary?: string; expectedOutput?: string; reason?: string },
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const step = createRuntimeStep({
    run_id: context.runId,
    agent_id: child.id,
    kind: mode,
    status: "running",
    title: (mode === "handoff" ? "Handoff to " : "Consult ") + child.name,
    detail: { input },
  });
  if (mode === "handoff") {
    context.finalAgentId = child.id;
    recordState({
      agentId: DEFAULT_AGENT_ID,
      status: "handoff",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: "Void handed off to " + child.name,
      stepId: step.id,
    });
  }
  recordState({
    agentId: child.id,
    status: "running",
    runId: context.runId,
    conversationId: context.conversationId,
    summary: child.name + (mode === "handoff" ? " is handling the task" : " is consulting"),
    stepId: step.id,
  });

  try {
    const childModelRef = child.model_ref || context.modelRef;
    const childResolved = applyRuntimeConfig(
      child.model_ref ? context.resolveModel(childModelRef) : context.resolved,
      readRuntimeConfig(child.runtime_config_json),
    );
    const childModelContext = toChatToolModelContext(childModelRef, childResolved);
    const childRuntime = buildSafeChildToolRuntime(context, child, childModelContext);
    const childConfig = readRuntimeConfig(child.runtime_config_json);
    const childAgent = createToolLoopAgent({
      id: child.id,
      modelRef: childModelRef,
      resolved: childResolved,
      instructions: await createChildInstructions(context, child, mode),
      messages: [],
      runtimeConfig: childConfig,
      reasoning: normalizeRuntimeReasoning(childConfig.reasoning),
      toolRuntime: childRuntime,
    });
    const result = await childAgent.generate({
      prompt: createChildPrompt(context, child, mode, input),
      timeout: { totalMs: 120_000 },
    });
    const output = summarizeText(result.text, 6_000);
    updateRuntimeStep(step.id, {
      status: "succeeded",
      detail: { input, output, durationMs: Date.now() - started },
      finished_at: Date.now(),
    });
    recordState({
      agentId: child.id,
      status: mode === "handoff" ? "running" : "idle",
      runId: mode === "handoff" ? context.runId : null,
      conversationId: context.conversationId,
      summary: child.name + " completed " + mode,
      stepId: step.id,
    });
    insertRuntimeEvent({
      kind: "handoff",
      title: (mode === "handoff" ? "Handoff" : "Consult") + " completed: " + child.name,
      status: "succeeded",
      detail: { runId: context.runId, agentId: child.id, durationMs: Date.now() - started },
    });
    return {
      mode,
      agentId: child.id,
      agentName: child.name,
      output,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRuntimeStep(step.id, {
      status: "failed",
      error: message,
      detail: { input, error: message },
      finished_at: Date.now(),
    });
    recordState({
      agentId: child.id,
      status: "failed",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: child.name + " failed",
      error: message,
      stepId: step.id,
    });
    throw error;
  }
}

function buildSafeChildToolRuntime(
  context: RuntimeContext,
  child: AgentProfile,
  model: ChatToolModelContext,
): ChatToolRuntimeConfig {
  if (!model.capabilities.toolCalling) {
    return { descriptors: [], toolChoice: "none" };
  }
  const policy = readToolPolicy(child.tool_policy_json);
  const allowed = selectedBaseToolIds(context.toolSelection, policy).filter(
    (id) => !policy.requireApprovalToolIds.includes(id),
  );
  return buildChatToolRuntime({
    selection: { mode: allowed.length ? "manual" : "off", selectedToolIds: allowed },
    model,
    conversationId: context.conversationId,
    agentId: child.id,
  });
}

function createSandboxTools(context: RuntimeContext, enabledIds: ChatToolId[]): ToolSet {
  const enabled = new Set(enabledIds);
  const tools: ToolSet = {};
  if (enabled.has("sandbox_list_files")) {
    assignTool(
      tools,
      "sandbox_list_files",
      tool({
        description: "List files inside the sandbox.",
        inputSchema: jsonSchema<{ path?: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "List sandbox files", async (sandbox) =>
            listSandboxFiles(sandbox.session, input.path ?? "."),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_read_file")) {
    assignTool(
      tools,
      "sandbox_read_file",
      tool({
        description: "Read a UTF-8 text file inside the sandbox.",
        inputSchema: jsonSchema<{ path: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Read sandbox file", async (sandbox) =>
            readSandboxFile(sandbox.session, input.path),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_write_file")) {
    assignTool(
      tools,
      "sandbox_write_file",
      tool({
        description: "Write or append a UTF-8 file inside the sandbox.",
        inputSchema: jsonSchema<{ path: string; content: string; append?: boolean }>({
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            append: { type: "boolean" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Write sandbox file", async (sandbox) =>
            writeSandboxFile(sandbox.session, input.path, input.content, { append: input.append }),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_run_command")) {
    assignTool(
      tools,
      "sandbox_run_command",
      tool({
        description: "Run a command in the sandbox cwd with a timeout.",
        inputSchema: jsonSchema<{
          command: string;
          args?: string[];
          cwd?: string;
          env?: Record<string, string>;
          timeoutMs?: number;
        }>({
          type: "object",
          properties: {
            command: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            env: { type: "object", additionalProperties: { type: "string" } },
            timeoutMs: { type: "number" },
          },
          required: ["command"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Run sandbox command", async (sandbox) =>
            runSandboxCommand(sandbox.session, input),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_snapshot")) {
    assignTool(
      tools,
      "sandbox_snapshot",
      tool({
        description: "Create a restorable sandbox snapshot.",
        inputSchema: jsonSchema<{ label?: string }>({
          type: "object",
          properties: { label: { type: "string" } },
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Create sandbox snapshot", async (sandbox) =>
            createSandboxSnapshot(sandbox.session, input.label),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_restore")) {
    assignTool(
      tools,
      "sandbox_restore",
      tool({
        description: "Restore a sandbox snapshot.",
        inputSchema: jsonSchema<{ snapshotId: string }>({
          type: "object",
          properties: { snapshotId: { type: "string" } },
          required: ["snapshotId"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Restore sandbox snapshot", async (sandbox) =>
            restoreSandboxSnapshot(sandbox.session, input.snapshotId),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_list_artifacts")) {
    assignTool(
      tools,
      "sandbox_list_artifacts",
      tool({
        description: "List sandbox artifacts and preview links.",
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: () =>
          runSandboxStep(context, "List sandbox artifacts", async (sandbox) => ({
            artifacts: listSandboxSessionArtifacts(sandbox.session),
          })),
      }),
    );
  }
  if (enabled.has("sandbox_preview_port")) {
    assignTool(
      tools,
      "sandbox_preview_port",
      tool({
        description: "Register a localhost preview port for the sandbox.",
        inputSchema: jsonSchema<{ port: number; label?: string }>({
          type: "object",
          properties: { port: { type: "number" }, label: { type: "string" } },
          required: ["port"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Register sandbox preview", async (sandbox) =>
            registerSandboxPreviewPort(sandbox.session, input),
          ),
      }),
    );
  }
  return tools;
}

async function runSandboxStep<T>(
  context: RuntimeContext,
  title: string,
  action: (sandbox: SandboxContext) => Promise<T> | T,
): Promise<T> {
  const sandbox = getSandboxSessionOrThrow(context.sandbox);
  const step = createRuntimeStep({
    run_id: context.runId,
    agent_id: DEFAULT_AGENT_ID,
    kind: "sandbox",
    status: "running",
    title,
    detail: {
      sessionId: sandbox.session.id,
      isolationMode: sandbox.session.isolation_mode,
    },
  });
  recordState({
    agentId: DEFAULT_AGENT_ID,
    status: "sandbox",
    runId: context.runId,
    conversationId: context.conversationId,
    summary: title,
    stepId: step.id,
  });
  try {
    const result = await action(sandbox);
    updateRuntimeStep(step.id, {
      status: "succeeded",
      detail: {
        sessionId: sandbox.session.id,
        isolationMode: sandbox.session.isolation_mode,
        result: summarizeUnknown(result),
      },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      kind: "sandbox",
      title,
      status: "succeeded",
      detail: {
        runId: context.runId,
        sessionId: sandbox.session.id,
        isolationMode: sandbox.session.isolation_mode,
      },
    });
    recordState({
      agentId: DEFAULT_AGENT_ID,
      status: "running",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: "Void is continuing after sandbox action",
      stepId: step.id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRuntimeStep(step.id, {
      status: "failed",
      error: message,
      detail: { error: message },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      kind: "sandbox",
      title,
      status: "failed",
      detail: { runId: context.runId, error: message },
    });
    throw error;
  }
}

function createGuardrailApproval(
  context: RuntimeContext,
  toolApprovalToolNames = new Set<string>(),
): ToolApprovalConfiguration<ToolSet, unknown> {
  return ({ toolCall }) => {
    const toolName = String(toolCall.toolName);
    const input = (toolCall as { input?: unknown }).input;
    const decision = evaluateToolGuardrail(context, toolName, input, toolApprovalToolNames);
    const step = createRuntimeStep({
      run_id: context.runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: decision.decision === "require_review" ? "approval" : "tool",
      status:
        decision.decision === "deny"
          ? "cancelled"
          : decision.decision === "require_review"
            ? "queued"
            : "succeeded",
      title:
        decision.decision === "require_review"
          ? "Approval requested: " + toolName
          : "Guardrail " + decision.decision + ": " + toolName,
      detail: { toolName, input, decision },
      finished_at: decision.decision === "require_review" ? null : Date.now(),
    });
    insertRuntimeEvent({
      kind: decision.decision === "require_review" ? "approval" : "guardrail",
      title:
        decision.decision === "require_review"
          ? "Approval requested: " + toolName
          : "Guardrail " + decision.decision + ": " + toolName,
      status:
        decision.decision === "deny"
          ? "cancelled"
          : decision.decision === "require_review"
            ? "queued"
            : "succeeded",
      detail: { runId: context.runId, toolName, input, decision },
    });
    if (decision.decision === "require_review") {
      context.approvalRequested = true;
      recordState({
        agentId: DEFAULT_AGENT_ID,
        status: "reviewing",
        runId: context.runId,
        conversationId: context.conversationId,
        summary: "Waiting for user approval: " + toolName,
        stepId: step.id,
      });
      return "user-approval";
    }
    if (decision.decision === "deny") {
      return { type: "denied", reason: decision.reason } satisfies ToolApprovalStatus;
    }
    return "not-applicable";
  };
}

function evaluateToolGuardrail(
  context: RuntimeContext,
  toolName: string,
  input: unknown,
  toolApprovalToolNames = new Set<string>(),
): {
  decision: "allow" | "deny" | "require_review";
  risk: "low" | "medium" | "high";
  reason: string;
} {
  if (toolName.startsWith("handoff_") || toolName.startsWith("consult_")) {
    return { decision: "allow", risk: "low", reason: "Agent orchestration tool." };
  }
  if (toolName.startsWith("sandbox_") && inputHasPathEscape(input)) {
    return { decision: "deny", risk: "high", reason: "Sandbox path escapes the session root." };
  }
  if (toolName === "sandbox_run_command" && commandLooksDangerous(input)) {
    return {
      decision: "require_review",
      risk: "high",
      reason: "Command may modify files, install dependencies, or start processes.",
    };
  }
  const policy = readToolPolicy(context.rootAgent.tool_policy_json);
  const mappedTool = toolNameToChatToolId(toolName);
  const reviewAll =
    readRuntimeConfig(context.rootAgent.runtime_config_json).reviewPolicy === "review_all";
  if (
    reviewAll ||
    toolApprovalToolNames.has(toolName) ||
    (mappedTool && policy.requireApprovalToolIds.includes(mappedTool)) ||
    toolName === "memory_save" ||
    toolName === "conversation_search"
  ) {
    return {
      decision: "require_review",
      risk: toolName.startsWith("sandbox_") ? "high" : "medium",
      reason: "Policy requires chat approval.",
    };
  }
  return { decision: "allow", risk: "low", reason: "Allowed by policy." };
}

function finishRun(
  context: RuntimeContext,
  status: "succeeded" | "failed" | "cancelled",
  extra: { error?: string; execution?: ChatMessageMetadata["execution"] } = {},
): void {
  const finishedAt = Date.now();
  const finalStatus = context.approvalRequested && status === "succeeded" ? "running" : status;
  updateRuntimeRun(context.runId, {
    status: finalStatus,
    final_agent_id: context.finalAgentId,
    finished_at: finalStatus === "running" ? null : finishedAt,
    error: extra.error ?? null,
    usage_json: extra.execution ? JSON.stringify(extra.execution) : null,
  });
  createRuntimeStep({
    run_id: context.runId,
    agent_id: context.finalAgentId,
    kind: extra.error ? "error" : "output_guardrail",
    status: extra.error ? "failed" : "succeeded",
    title: extra.error ? "Agent run failed" : "Output guardrails passed",
    detail: extra,
    finished_at: finishedAt,
    error: extra.error ?? null,
  });
  for (const agent of [context.rootAgent, ...context.enabledChildren]) {
    const isFinalHandoffAgent =
      agent.id === context.finalAgentId && context.finalAgentId !== DEFAULT_AGENT_ID;
    upsertAgentRuntimeState({
      agent_id: agent.id,
      status: context.approvalRequested ? "reviewing" : isFinalHandoffAgent ? "idle" : "idle",
      current_run_id: context.approvalRequested ? context.runId : null,
      last_error: extra.error ?? null,
    });
  }
  if (context.conversationId) {
    upsertConversationAgentState({
      conversation_id: context.conversationId,
      active_agent_id: context.finalAgentId,
      current_run_id: context.approvalRequested ? context.runId : null,
      current_step_id: null,
      status: context.approvalRequested ? "reviewing" : extra.error ? "failed" : "idle",
      summary: context.approvalRequested
        ? "Waiting for user approval"
        : extra.error
          ? extra.error
          : "Agent run finished",
    });
  }
  insertRuntimeEvent({
    kind: "agent",
    title: extra.error ? "Void orchestration failed" : "Void orchestration finished",
    status: extra.error ? "failed" : finalStatus === "running" ? "running" : "succeeded",
    detail: { runId: context.runId, finalAgentId: context.finalAgentId, ...extra },
  });
}

function createExecutionTracker({
  runId,
  modelRef,
  agentId,
  context,
}: {
  runId: string;
  modelRef: string;
  agentId: string;
  context: RuntimeContext;
}): {
  messageMetadata: MessageMetadataCallback;
  recordModelStep: () => void;
} {
  const startedAt = Date.now();
  let stepCount = 0;
  let toolCallCount = 0;
  const messageMetadata: MessageMetadataCallback = ({ part }) => {
    if (part.type === "tool-call") {
      toolCallCount += 1;
      return undefined;
    }
    if (part.type === "start") {
      return { execution: { startedAt, model: modelRef, agentId } };
    }
    if (part.type !== "finish") return undefined;
    const finishedAt = Date.now();
    const execution = {
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      model: modelRef,
      agentId,
      finishReason: String(part.finishReason),
      inputTokens: readTokenTotal(part.totalUsage, "inputTokens"),
      outputTokens: readTokenTotal(part.totalUsage, "outputTokens"),
      totalTokens: undefined as number | undefined,
      stepCount: stepCount || undefined,
      toolCallCount: toolCallCount || undefined,
    };
    execution.totalTokens =
      execution.inputTokens !== undefined || execution.outputTokens !== undefined
        ? (execution.inputTokens ?? 0) + (execution.outputTokens ?? 0)
        : undefined;
    finishRun(context, "succeeded", { execution });
    return { execution };
  };
  return {
    messageMetadata,
    recordModelStep: () => {
      stepCount += 1;
      createRuntimeStep({
        run_id: runId,
        agent_id: agentId,
        kind: "model",
        status: "succeeded",
        title: "Model step " + stepCount,
        detail: { modelRef, stepCount },
        finished_at: Date.now(),
      });
    },
  };
}

async function createRootInstructions(
  context: RuntimeContext,
  toolInstructions?: string,
): Promise<string> {
  const childLines = context.enabledChildren.map((agent) => {
    const handoff = readHandoffConfig(agent.handoff_config_json);
    return [
      "- " + agent.name + " [" + handoff.mode + "]: " + agent.role,
      agent.description,
      handoff.accepts.length ? "Best for: " + handoff.accepts.join(", ") : "",
      "Expected output: " + handoff.expectedOutput,
      agent.model_ref ? "Model: " + agent.model_ref : "Model: inherit",
    ]
      .filter(Boolean)
      .join(" ");
  });
  const basePrompt = await context.buildAgentSystemPrompt(DEFAULT_AGENT_ID, context.conversationId);
  return [
    basePrompt,
    "You are Void, the root orchestrator. Every chat request enters through you, regardless of provider.",
    "Decide whether to answer directly, consult a child agent, or hand off ownership to a child agent.",
    "When a child agent is disabled, draft, archived, or locked, it is not available and must not be used.",
    "Use consult tools for specialist advice while you keep ownership. Use handoff tools when the child agent should own the result.",
    context.preferredAgentId
      ? "The user selected " +
        context.preferredAgentId +
        " as a routing preference. Treat it as a hint."
      : "",
    childLines.length
      ? "Enabled child agents:\n" + childLines.join("\n")
      : "No child agents are currently enabled.",
    toolInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createChildInstructions(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
): Promise<string> {
  const handoff = readHandoffConfig(child.handoff_config_json);
  const basePrompt = await context.buildAgentSystemPrompt(child.id, context.conversationId);
  return [
    basePrompt,
    "You are a child agent under Void. Stay inside your specialty and be concise.",
    mode === "handoff"
      ? "Ownership has been transferred to you for this task."
      : "You are being consulted; Void will synthesize your output.",
    "Expected output: " + handoff.expectedOutput,
  ].join("\n\n");
}

function createChildPrompt(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
  input: { task?: string; taskSummary?: string; expectedOutput?: string; reason?: string },
): string {
  return [
    "Mode: " + mode,
    "Agent: " + child.name + " (" + child.role + ")",
    input.reason ? "Reason: " + input.reason : "",
    "Task: " + (input.taskSummary ?? input.task ?? ""),
    input.expectedOutput ? "Expected output: " + input.expectedOutput : "",
    "Recent conversation:\n" + extractTranscript(context.messages, 12),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createSandboxIsolationNote(context: RuntimeContext): string | undefined {
  if (!context.sandbox) return undefined;
  return [
    "Sandbox isolation:",
    "- Session: " + context.sandbox.session.id,
    "- Mode: " + context.sandbox.session.isolation_mode,
    context.sandbox.session.isolation_mode === "local"
      ? "- Docker was unavailable or not selected; commands are restricted to a local sandbox directory."
      : "- Docker was detected; this session records docker-capable isolation.",
    "- All file paths must be relative to the sandbox root.",
  ].join("\n");
}

function recordState(input: {
  agentId: string;
  status: AgentRuntimeStatus;
  runId: string | null;
  conversationId?: string;
  summary?: string;
  error?: string | null;
  stepId?: string | null;
}): void {
  upsertAgentRuntimeState({
    agent_id: input.agentId,
    status: input.status,
    current_run_id: input.runId,
    last_error: input.error ?? null,
    last_handoff_at: input.status === "handoff" ? Date.now() : undefined,
    last_tool_at:
      input.status === "tool_calling" || input.status === "sandbox" ? Date.now() : undefined,
  });
  if (input.conversationId) {
    upsertConversationAgentState({
      conversation_id: input.conversationId,
      active_agent_id: input.agentId,
      current_run_id: input.runId,
      current_step_id: input.stepId ?? null,
      status: input.status,
      summary: input.summary ?? null,
    });
  }
}

function applyRuntimeConfig(
  resolved: ResolvedChatModel,
  config: AgentRuntimeConfig,
): ResolvedChatModel {
  return {
    ...resolved,
    temperature: config.temperature ?? resolved.temperature,
    topP: config.topP ?? resolved.topP,
    maxOutputTokens: config.maxOutputTokens ?? resolved.maxOutputTokens,
  };
}

function applyAgentToolPolicy(
  rawSelection: ChatToolSelectionRequest | undefined,
  policy: AgentToolPolicy,
): ChatToolSelectionRequest | undefined {
  if (policy.mode !== "custom" || policy.allowedToolIds.length === 0) return rawSelection;
  const selection = normalizeChatToolSelection(rawSelection);
  if (selection.mode === "off") return selection;
  if (selection.mode === "manual") {
    return {
      mode: "manual",
      selectedToolIds: selection.selectedToolIds.filter((id) => policy.allowedToolIds.includes(id)),
    };
  }
  return { mode: "manual", selectedToolIds: policy.allowedToolIds };
}

function selectedBaseToolIds(
  rawSelection: ChatToolSelectionRequest | undefined,
  policy: AgentToolPolicy,
): ChatToolId[] {
  const selection = normalizeChatToolSelection(applyAgentToolPolicy(rawSelection, policy));
  if (selection.mode === "off") return [];
  if (selection.mode === "manual") return selection.selectedToolIds.filter(isBaseChatTool);
  return ["web_search", "current_time", "memory_search", "runtime_snapshot", "model_capabilities"];
}

function selectedSandboxToolIds(context: RuntimeContext, policy: AgentToolPolicy): ChatToolId[] {
  const selection = normalizeChatToolSelection(applyAgentToolPolicy(context.toolSelection, policy));
  if (readRuntimeConfig(context.rootAgent.runtime_config_json).sandboxPolicy === "disabled") {
    return [];
  }
  if (selection.mode === "off") return [];
  if (selection.mode === "manual") return selection.selectedToolIds.filter(isSandboxToolId);
  return ["sandbox_list_files", "sandbox_read_file", "sandbox_snapshot", "sandbox_list_artifacts"];
}

function readToolPolicy(raw: string): AgentToolPolicy {
  return readJsonObject(raw, DEFAULT_AGENT_TOOL_POLICY, (value) => ({
    mode: value.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: Array.isArray(value.allowedToolIds)
      ? value.allowedToolIds.filter(isChatToolReference)
      : [],
    requireApprovalToolIds: Array.isArray(value.requireApprovalToolIds)
      ? value.requireApprovalToolIds.filter(isChatToolReference)
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
    topP: typeof value.topP === "number" ? clampNumber(value.topP, 1, 0, 1) : undefined,
    maxOutputTokens:
      typeof value.maxOutputTokens === "number"
        ? Math.floor(clampNumber(value.maxOutputTokens, 4096, 1, 32768))
        : undefined,
    reasoning: isChatReasoningLevel(value.reasoning) ? value.reasoning : undefined,
    reviewPolicy:
      value.reviewPolicy === "auto" ||
      value.reviewPolicy === "review_sensitive" ||
      value.reviewPolicy === "review_all" ||
      value.reviewPolicy === "inherit"
        ? value.reviewPolicy
        : DEFAULT_AGENT_RUNTIME_CONFIG.reviewPolicy,
    sandboxPolicy:
      value.sandboxPolicy === "disabled" ||
      value.sandboxPolicy === "local" ||
      value.sandboxPolicy === "docker" ||
      value.sandboxPolicy === "inherit"
        ? value.sandboxPolicy
        : DEFAULT_AGENT_RUNTIME_CONFIG.sandboxPolicy,
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

function toChatToolModelContext(
  modelRef: string,
  resolved: ResolvedChatModel,
): ChatToolModelContext {
  const slashIdx = modelRef.indexOf("/");
  const providerId =
    resolved.providerId ?? (slashIdx > 0 ? modelRef.slice(0, slashIdx) : "unknown");
  const modelId = resolved.modelId ?? (slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef);
  return {
    providerId,
    providerKind: resolved.providerKind ?? "openai-compatible",
    modelId,
    capabilities: resolved.capabilities ?? DEFAULT_MODEL_CAPABILITIES,
    nativeTools: resolved.nativeTools ?? [],
  };
}

function normalizeRuntimeReasoning(
  value: ChatReasoningLevel | StreamTextOptions["reasoning"] | undefined,
): StreamTextOptions["reasoning"] | undefined {
  if (!value || value === "provider-default" || value === "none") return undefined;
  return value as StreamTextOptions["reasoning"];
}

function toolSlug(profile: AgentProfile): string {
  return profile.id
    .replace(/^agent-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isBaseChatTool(value: unknown): value is ChatToolId {
  return isChatToolId(value) && !isSandboxToolId(value);
}

function isSandboxToolId(value: unknown): value is ChatToolId {
  return isChatToolId(value) && value.startsWith("sandbox_");
}

function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

function isChatReasoningLevel(value: unknown): value is ChatReasoningLevel {
  return (
    typeof value === "string" &&
    ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"].includes(value)
  );
}

function toolNameToChatToolId(toolName: string): ChatToolId | null {
  return isChatToolId(toolName) ? toolName : null;
}

function assignTool(toolSet: ToolSet, name: string, value: unknown): void {
  (toolSet as Record<string, ToolSet[string]>)[name] = value as ToolSet[string];
}

function extractTranscript(messages: UIMessage[], limit: number): string {
  return messages
    .slice(limit > 0 ? -limit : 0)
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

function summarizeText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? compact.slice(0, maxLength - 3) + "..." : compact;
}

function summarizeUnknown(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (!value || typeof value !== "object") return { type: typeof value };
  const record = value as Record<string, unknown>;
  return {
    type: "object",
    keys: Object.keys(record).slice(0, 12),
    count: typeof record.count === "number" ? record.count : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    id: typeof record.id === "string" ? record.id : undefined,
  };
}

function readTokenTotal(usage: unknown, key: "inputTokens" | "outputTokens"): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = (usage as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const total = (value as Record<string, unknown>).total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
