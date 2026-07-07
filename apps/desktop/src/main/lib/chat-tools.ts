import { randomUUID } from "node:crypto";
import { isStepCount, jsonSchema, tool } from "ai";
import type { streamText, ToolApprovalConfiguration, ToolChoice, ToolSet } from "ai";
import {
  CHAT_TOOL_IDS,
  normalizeChatToolSelection,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type ModelCapabilities,
  type ModelProviderKind,
} from "../../shared/types";
import type { NativeChatTool } from "./providers";
import {
  getWorkspaceSnapshot,
  insertHarnessEvent,
  listMemories,
  listMessages,
  saveMemory,
  upsertAgentRuntimeState,
} from "./db";

type StreamTextOptions = Parameters<typeof streamText>[0];

export interface ChatToolModelContext {
  providerId: string;
  providerKind: ModelProviderKind;
  modelId: string;
  capabilities: ModelCapabilities;
  nativeTools: NativeChatTool[];
}

export interface BuildChatToolRuntimeOptions {
  selection?: ChatToolSelectionRequest;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}

export interface ChatToolRuntimeConfig {
  descriptors: ChatToolDescriptor[];
  tools?: ToolSet;
  activeTools?: string[];
  toolChoice?: ToolChoice<ToolSet>;
  toolApproval?: ToolApprovalConfiguration<ToolSet, unknown>;
  stopWhen?: StreamTextOptions["stopWhen"];
  onStepEnd?: StreamTextOptions["onStepEnd"];
  instructions?: string;
}

export interface ChatToolAuditContext {
  runId?: string;
  agentId?: string | null;
}

export function auditChatToolApprovalResponses({
  messages,
  model,
  conversationId,
  agentId,
}: {
  messages: Array<{ role?: string; parts?: unknown[] }>;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): void {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant" || !Array.isArray(lastMessage.parts)) return;

  for (const part of lastMessage.parts) {
    const approval = getApprovalResponse(part);
    if (!approval) continue;
    const toolName = getToolPartName(part) ?? "unknown";
    recordHarnessEvent({
      kind: "approval",
      title: `Approval ${approval.approved ? "approved" : "denied"}: ${toolName}`,
      status: approval.approved ? "succeeded" : "cancelled",
      detail: baseAuditDetail(model, conversationId, {
        agentId,
        toolName,
        approvalId: approval.id,
        approved: approval.approved,
        reason: approval.reason ? truncate(approval.reason, 240) : undefined,
      }),
    });
  }
}

interface ToolDefinition {
  id: ChatToolId;
  label: string;
  description: string;
  kind: "provider" | "host";
  category: ChatToolDescriptor["category"];
  defaultAuto: boolean;
  requiresApproval: boolean;
}

interface MemorySearchInput {
  query: string;
  limit?: number;
}

interface WorkspaceSnapshotInput {
  limit?: number;
}

interface WebSearchInput {
  query: string;
  maxResults?: number;
}

interface ConversationSearchInput {
  query: string;
  limit?: number;
}

interface MemorySaveInput {
  title: string;
  content: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  salience?: number;
  pinned?: boolean;
}

const TOOL_DEFINITIONS: Record<ChatToolId, ToolDefinition> = {
  web_search: {
    id: "web_search",
    label: "Web search",
    description: "Search the live web with native provider search or a host fallback.",
    kind: "provider",
    category: "web",
    defaultAuto: true,
    requiresApproval: false,
  },
  current_time: {
    id: "current_time",
    label: "Current time",
    description: "Read the current system date, time, and timezone from the host device.",
    kind: "host",
    category: "system",
    defaultAuto: true,
    requiresApproval: false,
  },
  memory_search: {
    id: "memory_search",
    label: "Memory search",
    description: "Search saved local memories relevant to the conversation.",
    kind: "host",
    category: "memory",
    defaultAuto: true,
    requiresApproval: false,
  },
  workspace_snapshot: {
    id: "workspace_snapshot",
    label: "Workspace snapshot",
    description: "Read a compact local workspace summary.",
    kind: "host",
    category: "workspace",
    defaultAuto: true,
    requiresApproval: false,
  },
  model_capabilities: {
    id: "model_capabilities",
    label: "Model capabilities",
    description: "Inspect the selected model and enabled chat tools.",
    kind: "host",
    category: "model",
    defaultAuto: true,
    requiresApproval: false,
  },
  conversation_search: {
    id: "conversation_search",
    label: "Conversation search",
    description: "Search messages in this conversation after approval.",
    kind: "host",
    category: "conversation",
    defaultAuto: false,
    requiresApproval: true,
  },
  memory_save: {
    id: "memory_save",
    label: "Save memory",
    description: "Save a new local memory after approval.",
    kind: "host",
    category: "memory",
    defaultAuto: false,
    requiresApproval: true,
  },
};

export class ChatToolSelectionError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ChatToolSelectionError";
  }
}

export function createChatToolDescriptors(model: ChatToolModelContext): ChatToolDescriptor[] {
  const supportsTools = model.capabilities.toolCalling;
  const webSearchExecution = getWebSearchExecution(model);

  return CHAT_TOOL_IDS.map((id) => {
    const base = TOOL_DEFINITIONS[id];
    const available = supportsTools && (id !== "web_search" || !!webSearchExecution);
    const unavailableReason = available
      ? undefined
      : !supportsTools
        ? "Selected model does not advertise tool calling."
        : id === "web_search"
          ? webSearchUnavailableReason(model)
          : "Tool calling is unavailable for the selected model.";

    return {
      ...base,
      ...(id === "web_search" && webSearchExecution
        ? {
            kind: webSearchExecution,
            execution: webSearchExecution,
            description:
              webSearchExecution === "provider"
                ? "Search the live web with the selected model provider."
                : "Search the live web through the app when native provider search is unavailable.",
          }
        : {}),
      available,
      unavailableReason,
    };
  });
}

export function buildChatToolRuntime({
  selection: rawSelection,
  model,
  conversationId,
  agentId,
}: BuildChatToolRuntimeOptions): ChatToolRuntimeConfig {
  const selection = normalizeChatToolSelection(rawSelection);
  const descriptors = createChatToolDescriptors(model);
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  if (selection.mode === "off" || !model.capabilities.toolCalling) {
    if (selection.mode === "manual" && selection.selectedToolIds.length > 0) {
      throw new ChatToolSelectionError("Selected model does not support chat tools.");
    }
    return { descriptors, toolChoice: "none" };
  }

  const selectedIds =
    selection.mode === "auto"
      ? descriptors
          .filter((descriptor) => descriptor.defaultAuto && descriptor.available)
          .map((descriptor) => descriptor.id)
      : selection.selectedToolIds;

  const unavailable = selectedIds
    .map((id) => descriptorById.get(id))
    .filter(
      (descriptor): descriptor is ChatToolDescriptor => !!descriptor && !descriptor.available,
    );
  if (unavailable.length > 0) {
    const first = unavailable[0];
    throw new ChatToolSelectionError(
      `${first.label} is unavailable: ${first.unavailableReason ?? "unsupported"}`,
    );
  }

  const toolSet: ToolSet = {};
  const activeTools: string[] = [];
  const providerExecutedToolNames = new Set<string>();
  const hostTools = createHostTools({ model, descriptors, conversationId, agentId });

  for (const id of selectedIds) {
    if (id === "web_search") {
      const nativeTool = model.nativeTools.find((item) => item.id === "web_search");
      if (nativeTool) {
        assignTool(toolSet, nativeTool.toolName, nativeTool.tool);
        activeTools.push(nativeTool.toolName);
        providerExecutedToolNames.add(nativeTool.toolName);
      } else {
        const hostTool = hostTools.web_search;
        if (!hostTool) continue;
        assignTool(toolSet, "web_search", hostTool);
        activeTools.push("web_search");
      }
      continue;
    }

    const hostTool = hostTools[id];
    if (!hostTool) continue;
    assignTool(toolSet, id, hostTool);
    activeTools.push(id);
  }

  if (activeTools.length === 0) return { descriptors, toolChoice: "none" };

  const toolChoice = resolveToolChoice(selection.mode, activeTools, model);

  return {
    descriptors,
    tools: toolSet,
    activeTools,
    toolChoice,
    toolApproval: createToolApproval(conversationId, agentId, model),
    stopWhen: isStepCount(5),
    onStepEnd: createStepAuditor({
      model,
      conversationId,
      providerExecutedToolNames,
    }),
    instructions: createToolInstructions(activeTools),
  };
}

export async function executeChatHostTool({
  toolId,
  input,
  model,
  conversationId,
  agentId,
  audit,
}: {
  toolId: ChatToolId;
  input: unknown;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
  audit?: ChatToolAuditContext;
}): Promise<unknown> {
  const descriptor = TOOL_DEFINITIONS[toolId];
  return executeWithAudit(
    toolId,
    descriptor.label,
    model,
    conversationId,
    async () => {
      switch (toolId) {
        case "current_time":
          return getCurrentSystemTime();
        case "web_search":
          return searchWebFallback(input as WebSearchInput);
        case "memory_search": {
          const value = input as MemorySearchInput;
          const query = normalizeQuery(value.query);
          const limit = normalizeLimit(value.limit, 6, 12);
          const results = searchMemories(query, limit);
          return { query, count: results.length, results };
        }
        case "workspace_snapshot": {
          const value = input as WorkspaceSnapshotInput;
          return summarizeWorkspaceSnapshot(normalizeLimit(value.limit, 5, 10));
        }
        case "model_capabilities":
          return {
            providerId: model.providerId,
            providerKind: model.providerKind,
            modelId: model.modelId,
            capabilities: model.capabilities,
            tools: createChatToolDescriptors(model).map((item) => ({
              id: item.id,
              available: item.available,
              defaultAuto: item.defaultAuto,
              requiresApproval: item.requiresApproval,
              unavailableReason: item.unavailableReason,
            })),
          };
        case "conversation_search": {
          const value = input as ConversationSearchInput;
          const query = normalizeQuery(value.query);
          const limit = normalizeLimit(value.limit, 6, 12);
          return searchConversation(conversationId, query, limit);
        }
        case "memory_save":
          return saveChatMemory(input as MemorySaveInput, conversationId, agentId);
      }
    },
    audit,
  );
}

function resolveToolChoice(
  mode: ChatToolSelectionRequest["mode"],
  activeTools: string[],
  model: ChatToolModelContext,
): ToolChoice<ToolSet> {
  if (mode !== "manual") return "auto";
  if (model.providerKind === "openai-compatible") return "auto";
  return activeTools.length === 1 ? { type: "tool", toolName: activeTools[0] } : "required";
}

function createToolInstructions(activeTools: string[]): string | undefined {
  const hasWebSearch = activeTools.includes("web_search") || activeTools.includes("google_search");
  if (!hasWebSearch) return undefined;
  return [
    "When the user's request depends on current, live, recent, or time-sensitive information, call the available web search tool before answering.",
    "This includes weather, news, prices, schedules, versions, laws, availability, and questions using words like today, latest, now, current, or recent.",
    "Use the search results in the final answer and include source links or source names when available.",
  ].join(" ");
}

function createHostTools({
  model,
  descriptors,
  conversationId,
  agentId,
}: {
  model: ChatToolModelContext;
  descriptors: ChatToolDescriptor[];
  conversationId?: string;
  agentId?: string | null;
}): Partial<Record<ChatToolId, ToolSet[string]>> {
  return {
    current_time: tool({
      description: TOOL_DEFINITIONS.current_time.description,
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () =>
        executeWithAudit("current_time", "Current time", model, conversationId, async () =>
          getCurrentSystemTime(),
        ),
    }),
    web_search: canUseHostWebSearch(model)
      ? tool({
          description: TOOL_DEFINITIONS.web_search.description,
          inputSchema: jsonSchema<WebSearchInput>({
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              maxResults: {
                type: "number",
                description: "Maximum search results to return.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          }),
          execute: (input) =>
            executeWithAudit("web_search", "Web search", model, conversationId, async () =>
              searchWebFallback(input),
            ),
        })
      : undefined,
    memory_search: tool({
      description: TOOL_DEFINITIONS.memory_search.description,
      inputSchema: jsonSchema<MemorySearchInput>({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum results to return." },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit("memory_search", "Memory search", model, conversationId, async () => {
          const query = normalizeQuery(input.query);
          const limit = normalizeLimit(input.limit, 6, 12);
          const results = searchMemories(query, limit);
          return { query, count: results.length, results };
        }),
    }),
    workspace_snapshot: tool({
      description: TOOL_DEFINITIONS.workspace_snapshot.description,
      inputSchema: jsonSchema<WorkspaceSnapshotInput>({
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum recent items per section." },
        },
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "workspace_snapshot",
          "Workspace snapshot",
          model,
          conversationId,
          async () => summarizeWorkspaceSnapshot(normalizeLimit(input.limit, 5, 10)),
        ),
    }),
    model_capabilities: tool({
      description: TOOL_DEFINITIONS.model_capabilities.description,
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () =>
        executeWithAudit(
          "model_capabilities",
          "Model capabilities",
          model,
          conversationId,
          async () => ({
            providerId: model.providerId,
            providerKind: model.providerKind,
            modelId: model.modelId,
            capabilities: model.capabilities,
            tools: descriptors.map((descriptor) => ({
              id: descriptor.id,
              available: descriptor.available,
              defaultAuto: descriptor.defaultAuto,
              requiresApproval: descriptor.requiresApproval,
              unavailableReason: descriptor.unavailableReason,
            })),
          }),
        ),
    }),
    conversation_search: tool({
      description: TOOL_DEFINITIONS.conversation_search.description,
      inputSchema: jsonSchema<ConversationSearchInput>({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum messages to return." },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "conversation_search",
          "Conversation search",
          model,
          conversationId,
          async () => {
            const query = normalizeQuery(input.query);
            const limit = normalizeLimit(input.limit, 6, 12);
            return searchConversation(conversationId, query, limit);
          },
        ),
    }),
    memory_save: tool({
      description: TOOL_DEFINITIONS.memory_save.description,
      inputSchema: jsonSchema<MemorySaveInput>({
        type: "object",
        properties: {
          title: { type: "string", description: "Short memory title." },
          content: { type: "string", description: "Memory content." },
          scope: { type: "string", enum: ["global", "agent", "conversation"] },
          kind: {
            type: "string",
            enum: ["fact", "preference", "episode", "profile", "skill"],
          },
          salience: { type: "number", description: "Importance from 1 to 100." },
          pinned: { type: "boolean", description: "Whether to pin the memory." },
        },
        required: ["title", "content"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit("memory_save", "Save memory", model, conversationId, async () =>
          saveChatMemory(input, conversationId, agentId),
        ),
    }),
  };
}

function getCurrentSystemTime(): {
  timestampMs: number;
  utcIso: string;
  timeZone: string;
  locale: string;
  utcOffsetMinutes: number;
  localDateTime: string;
} {
  const now = new Date();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    timestampMs: now.getTime(),
    utcIso: now.toISOString(),
    timeZone: resolved.timeZone || "UTC",
    locale: resolved.locale || "en-US",
    utcOffsetMinutes: -now.getTimezoneOffset(),
    localDateTime: new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(now),
  };
}

function createToolApproval(
  conversationId: string | undefined,
  agentId: string | null | undefined,
  model: ChatToolModelContext,
): ToolApprovalConfiguration<ToolSet, unknown> {
  return {
    conversation_search: () => {
      recordHarnessEvent({
        kind: "approval",
        title: "Approval requested: conversation_search",
        status: "queued",
        detail: baseAuditDetail(model, conversationId, { agentId }),
      });
      return "user-approval";
    },
    memory_save: () => {
      recordHarnessEvent({
        kind: "approval",
        title: "Approval requested: memory_save",
        status: "queued",
        detail: baseAuditDetail(model, conversationId, { agentId }),
      });
      return "user-approval";
    },
  };
}

function createStepAuditor({
  model,
  conversationId,
  providerExecutedToolNames,
}: {
  model: ChatToolModelContext;
  conversationId?: string;
  providerExecutedToolNames: Set<string>;
}): StreamTextOptions["onStepEnd"] {
  return (event) => {
    const results = Array.isArray(event.toolResults) ? event.toolResults : [];
    for (const result of results) {
      const toolName = getUnknownString(result, "toolName");
      if (!toolName || !providerExecutedToolNames.has(toolName)) continue;
      recordHarnessEvent({
        kind: "tool",
        title: `Provider tool: ${toolName}`,
        status: "succeeded",
        detail: baseAuditDetail(model, conversationId, {
          toolName,
          providerExecuted: true,
          sourceCount: countSources((result as { output?: unknown }).output),
        }),
      });
    }
  };
}

async function executeWithAudit<T>(
  toolId: ChatToolId,
  title: string,
  model: ChatToolModelContext,
  conversationId: string | undefined,
  execute: () => Promise<T>,
  audit?: ChatToolAuditContext,
): Promise<T> {
  const started = Date.now();
  if (audit?.agentId) {
    recordAgentRuntimeState({
      agent_id: audit.agentId,
      status: "tool_calling",
      current_run_id: audit.runId ?? null,
      last_tool_at: started,
      last_error: null,
    });
  }
  try {
    const output = await execute();
    recordHarnessEvent({
      kind: "tool",
      title,
      status: "succeeded",
      detail: baseAuditDetail(model, conversationId, {
        runId: audit?.runId,
        agentId: audit?.agentId,
        toolId,
        durationMs: Date.now() - started,
        summary: summarizeToolOutput(output),
      }),
    });
    if (audit?.agentId) {
      recordAgentRuntimeState({
        agent_id: audit.agentId,
        status: "running",
        current_run_id: audit.runId ?? null,
        last_tool_at: Date.now(),
        last_error: null,
      });
    }
    return output;
  } catch (error) {
    recordHarnessEvent({
      kind: "error",
      title,
      status: "failed",
      detail: baseAuditDetail(model, conversationId, {
        runId: audit?.runId,
        agentId: audit?.agentId,
        toolId,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    if (audit?.agentId) {
      recordAgentRuntimeState({
        agent_id: audit.agentId,
        status: "failed",
        current_run_id: audit.runId ?? null,
        last_tool_at: Date.now(),
        last_error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

function recordAgentRuntimeState(patch: Parameters<typeof upsertAgentRuntimeState>[0]): void {
  try {
    upsertAgentRuntimeState(patch);
  } catch (error) {
    console.warn(
      "[chat-tools] failed to record agent runtime state:",
      error instanceof Error ? error.message : error,
    );
  }
}

function searchMemories(
  query: string,
  limit: number,
): Array<{
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  content: string;
  salience: number;
  pinned: boolean;
}> {
  const terms = splitTerms(query);
  return listMemories()
    .map((memory) => ({
      memory,
      score: scoreText([memory.title, memory.content, memory.kind, memory.scope].join(" "), terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.salience - a.memory.salience)
    .slice(0, limit)
    .map(({ memory }) => ({
      id: memory.id,
      scope: memory.scope,
      kind: memory.kind,
      title: memory.title,
      content: truncate(memory.content, 600),
      salience: memory.salience,
      pinned: memory.pinned === 1,
    }));
}

function summarizeWorkspaceSnapshot(limit: number): unknown {
  const snapshot = getWorkspaceSnapshot();
  return {
    agents: {
      total: snapshot.agents.length,
      active: snapshot.agents.filter((agent) => agent.status === "active").length,
      recent: snapshot.agents.slice(0, limit).map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
      })),
    },
    memories: {
      total: snapshot.memories.length,
      pinned: snapshot.memories.filter((memory) => memory.pinned === 1).length,
      recent: snapshot.memories.slice(0, limit).map((memory) => ({
        id: memory.id,
        scope: memory.scope,
        kind: memory.kind,
        title: memory.title,
        content: truncate(memory.content, 360),
      })),
    },
    workflows: snapshot.workflows.slice(0, limit).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      trigger: workflow.trigger,
    })),
    harnessEvents: snapshot.harnessEvents.slice(0, limit).map((event) => ({
      kind: event.kind,
      title: event.title,
      status: event.status,
      created_at: event.created_at,
    })),
    serverNodes: snapshot.serverNodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      status: node.status,
      capabilities: safeJsonParse(node.capabilities_json, []),
    })),
    sync: {
      mode: snapshot.syncState.mode,
      status: snapshot.syncState.status,
      encryption_enabled: snapshot.syncState.encryption_enabled === 1,
    },
  };
}

function searchConversation(
  conversationId: string | undefined,
  query: string,
  limit: number,
): unknown {
  if (!conversationId) throw new Error("conversationId is required for conversation_search.");
  const terms = splitTerms(query);
  const results = listMessages(conversationId)
    .map((message) => {
      const text = extractMessageText(message.content);
      return { message, text, score: scoreText(text, terms) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.created_at - a.message.created_at)
    .slice(0, limit)
    .map((item) => ({
      id: item.message.id,
      role: item.message.role,
      text: truncate(item.text, 700),
      created_at: item.message.created_at,
    }));
  return { query, count: results.length, results };
}

function saveChatMemory(
  input: MemorySaveInput,
  conversationId: string | undefined,
  agentId: string | null | undefined,
): unknown {
  const now = Date.now();
  const scope = input.scope ?? "conversation";
  const kind = input.kind ?? "fact";
  const memory: MemoryRecord = {
    id: randomUUID(),
    scope,
    kind,
    title: input.title.trim().slice(0, 120),
    content: input.content.trim().slice(0, 4_000),
    agent_id: scope === "agent" ? (agentId ?? null) : null,
    conversation_id: scope === "conversation" ? (conversationId ?? null) : null,
    salience: clampNumber(input.salience ?? 70, 1, 100),
    pinned: input.pinned ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  if (!memory.title || !memory.content) throw new Error("title and content are required.");
  saveMemory(memory);
  return {
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    salience: memory.salience,
    pinned: memory.pinned === 1,
  };
}

async function searchWebFallback(input: WebSearchInput): Promise<{
  query: string;
  source: "host_fallback";
  count: number;
  results: Array<{ title: string; url: string; snippet: string }>;
}> {
  const query = normalizeQuery(input.query);
  const maxResults = normalizeLimit(input.maxResults, 5, 10);
  const attempts = createSearchAttempts(query);
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const html = await fetchSearchHtml(attempt.url, attempt.timeoutMs);
      const results = attempt.parse(html, maxResults);
      if (results.length > 0) {
        return {
          query,
          source: "host_fallback",
          count: results.length,
          results,
        };
      }
      errors.push(`${attempt.label}: no parseable results`);
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("Web search failed: " + errors.join("; "));
}

interface SearchAttempt {
  label: string;
  url: URL;
  timeoutMs: number;
  parse: (
    html: string,
    maxResults: number,
  ) => Array<{ title: string; url: string; snippet: string }>;
}

function createSearchAttempts(query: string): SearchAttempt[] {
  const attempts: SearchAttempt[] = [];
  if (isWeatherQuery(query)) {
    const sogouWeatherUrl = new URL("https://www.sogou.com/web");
    sogouWeatherUrl.searchParams.set("query", query);
    attempts.push({
      label: "Sogou weather search",
      url: sogouWeatherUrl,
      timeoutMs: 8_000,
      parse: parseSogouWeatherResults,
    });

    const soWeatherUrl = new URL("https://www.so.com/s");
    soWeatherUrl.searchParams.set("q", query);
    attempts.push({
      label: "360 weather search",
      url: soWeatherUrl,
      timeoutMs: 8_000,
      parse: parseSoWeatherResults,
    });
  }

  const duckDuckGoUrl = new URL("https://duckduckgo.com/html/");
  duckDuckGoUrl.searchParams.set("q", query);

  const bingUrl = new URL("https://www.bing.com/search");
  bingUrl.searchParams.set("q", query);

  return [
    ...attempts,
    {
      label: "DuckDuckGo",
      url: duckDuckGoUrl,
      timeoutMs: 4_000,
      parse: parseDuckDuckGoResults,
    },
    {
      label: "Bing",
      url: bingUrl,
      timeoutMs: 12_000,
      parse: parseBingResults,
    },
  ];
}

function isWeatherQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /天气|气温|降雨|下雨|温度|weather|forecast|rain/.test(normalized) &&
    /今天|今日|现在|当前|实时|today|current|now|tonight/.test(normalized)
  );
}

async function fetchSearchHtml(url: URL, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Web search request failed with HTTP ${response.status}.`);
    }
    return response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Web search request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSogouWeatherResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  if (maxResults <= 0) return [];
  const weatherIndex = html.indexOf("weather201016");
  const currentDayIndex = html.indexOf("w-desc currentDay");
  if (weatherIndex < 0 || currentDayIndex < 0) return [];

  const titleBlock = html.slice(Math.max(0, weatherIndex - 800), weatherIndex + 1_500);
  const currentBlock = html.slice(currentDayIndex, currentDayIndex + 1_500);
  const titleLink =
    /<h3[^>]*class=["'][^"']*vr-title[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
      titleBlock,
    );
  const temperature = cleanHtmlText(
    /<div[^>]+class=["'][^"']*temperature[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      currentBlock,
    )?.[1],
  );
  const info = extractSpanTexts(
    /<p[^>]+class=["'][^"']*w-info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(currentBlock)?.[1],
  );
  if (!temperature && info.length === 0) return [];

  const title = cleanHtmlText(titleLink?.[2]) || "Weather search result";
  const url =
    normalizeResultUrl(titleLink?.[1], "https://www.sogou.com") ?? "https://www.sogou.com";
  const snippet = ["Current weather", temperature, ...info].filter(Boolean).join("; ");
  return [{ title, url, snippet }];
}

function parseSoWeatherResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  if (maxResults <= 0) return [];
  const weatherIndex = html.indexOf("mohe-weather");
  if (weatherIndex < 0) return [];

  const weatherBlock = html.slice(weatherIndex, weatherIndex + 80_000);
  const currentBlock = /<div[^>]+class=["'][^"']*mh-date js-mh-date[^"']*["'][\s\S]*?<\/a>/i.exec(
    weatherBlock,
  )?.[0];
  if (!currentBlock) return [];

  const title =
    cleanHtmlText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]) || "Weather search result";
  const url =
    normalizeResultUrl(
      /<a[^>]+href=["']([^"']+)["'][^>]*data-md=["'][^"']*\bcont\b/i.exec(currentBlock)?.[1],
      "https://www.so.com",
    ) ?? "https://www.so.com";
  const temperature = [
    cleanHtmlText(
      /<span[^>]+class=["'][^"']*mh-ico-num[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        currentBlock,
      )?.[1],
    ),
    cleanHtmlText(
      /<span[^>]+class=["'][^"']*mh-ico-unit[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        currentBlock,
      )?.[1],
    ),
  ]
    .filter(Boolean)
    .join("");
  const currentInfo = extractSpanTexts(
    /<div[^>]+class=["'][^"']*mh-desc-3[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(currentBlock)?.[1],
  );
  const alerts = extractSpanTexts(currentBlock).filter(
    (item) => item.includes("预警") || /优|良|轻度|中度|重度/.test(item),
  );
  const todayBlock =
    /mh-active[\s\S]*?(?=<div[^>]+class=["'][^"']*g-slider-item|<\/div><\/div><\/div>)/i.exec(
      weatherBlock,
    )?.[0];
  const todaySummary = todayBlock
    ? [
        cleanHtmlText(
          /<span[^>]+class=["'][^"']*mh-des-temperature[^"']*["'][^>]*title=["']([^"']+)["']/i.exec(
            todayBlock,
          )?.[1],
        ),
        cleanHtmlText(
          /<span[^>]+class=["'][^"']*mh-des-temperature-num[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
            todayBlock,
          )?.[1],
        ),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const snippet = [
    "Current weather",
    temperature,
    ...currentInfo,
    ...alerts,
    todaySummary ? `Today's forecast ${todaySummary}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (!snippet) return [];
  return [{ title, url, snippet }];
}

function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const resultPattern =
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class=["'][^"']*result__a[^"']*["']|<\/body>|$)/gi;

  for (const match of html.matchAll(resultPattern)) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = cleanHtmlText(match[2]);
    const snippet = extractSnippet(match[3] ?? "");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= maxResults) return results;
  }

  const litePattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(litePattern)) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = cleanHtmlText(match[2]);
    if (!url || !title || seen.has(url) || isDuckDuckGoNavigation(title, url)) continue;
    seen.add(url);
    results.push({ title, url, snippet: "" });
    if (results.length >= maxResults) return results;
  }

  return results;
}

function parseBingResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const resultPattern =
    /<li[^>]+class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)(?=<li[^>]+class=["'][^"']*\bb_algo\b|<\/ol>|<\/body>|$)/gi;

  for (const match of html.matchAll(resultPattern)) {
    const block = match[1] ?? "";
    const linkMatch = /<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
      block,
    );
    if (!linkMatch) continue;
    const url = normalizeBingResultUrl(linkMatch[1]);
    const title = cleanHtmlText(linkMatch[2]);
    const snippet = extractBingSnippet(block);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= maxResults) return results;
  }

  return results;
}

function extractSnippet(html: string): string {
  const match =
    /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(
      html,
    );
  return match ? cleanHtmlText(match[1]) : "";
}

function extractBingSnippet(html: string): string {
  const match = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  return match ? cleanHtmlText(match[1]) : "";
}

function extractSpanTexts(html: string | undefined): string[] {
  if (!html) return [];
  return [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => cleanHtmlText(match[1]))
    .filter(Boolean);
}

function normalizeResultUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtmlEntities(raw), baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSearchResultUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const withProtocol = raw.startsWith("//") ? "https:" + raw : decodeHtmlEntities(raw);
  try {
    const url = new URL(withProtocol, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    const finalUrl = redirected ? new URL(decodeURIComponent(redirected)) : url;
    if (finalUrl.protocol !== "https:" && finalUrl.protocol !== "http:") return null;
    if (finalUrl.hostname.endsWith("duckduckgo.com")) return null;
    return finalUrl.toString();
  } catch {
    return null;
  }
}

function normalizeBingResultUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtmlEntities(raw), "https://www.bing.com");
    const redirected = decodeBingRedirect(url);
    const finalUrl = redirected ? new URL(redirected) : url;
    if (finalUrl.protocol !== "https:" && finalUrl.protocol !== "http:") return null;
    if (finalUrl.hostname.endsWith("bing.com")) return null;
    return finalUrl.toString();
  } catch {
    return null;
  }
}

function decodeBingRedirect(url: URL): string | null {
  const encoded = url.searchParams.get("u");
  if (!encoded) return null;
  const value = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function cleanHtmlText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function isDuckDuckGoNavigation(title: string, url: string): boolean {
  const lowerTitle = title.toLowerCase();
  return (
    url.includes("duckduckgo.com") ||
    lowerTitle === "next" ||
    lowerTitle === "previous" ||
    lowerTitle.includes("duckduckgo")
  );
}

function isNativeWebSearchProvider(model: ChatToolModelContext): boolean {
  return (
    model.providerKind === "openai" ||
    model.providerKind === "anthropic" ||
    model.providerKind === "google"
  );
}

function getWebSearchExecution(model: ChatToolModelContext): "provider" | "host" | undefined {
  if (!model.capabilities.toolCalling) return undefined;
  const hasNativeWebSearch = model.nativeTools.some((item) => item.id === "web_search");
  if (isNativeWebSearchProvider(model)) return hasNativeWebSearch ? "provider" : undefined;
  return canUseHostWebSearch(model) ? "host" : undefined;
}

function canUseHostWebSearch(model: ChatToolModelContext): boolean {
  return model.capabilities.toolCalling && !isNativeWebSearchProvider(model);
}

function webSearchUnavailableReason(model: ChatToolModelContext): string {
  if (!isNativeWebSearchProvider(model)) {
    return "Web search requires a tool-calling model.";
  }
  return "Native web search is not available for this provider configuration.";
}

function assignTool(toolSet: ToolSet, name: string, value: unknown): void {
  (toolSet as Record<string, ToolSet[string]>)[name] = value as ToolSet[string];
}

function normalizeQuery(raw: string): string {
  const query = raw.trim();
  if (!query) throw new Error("query is required.");
  return query.slice(0, 500);
}

function normalizeLimit(raw: number | undefined, fallback: number, max: number): number {
  return Math.floor(clampNumber(raw ?? fallback, 1, max));
}

function clampNumber(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(max, Math.max(min, raw));
}

function splitTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? term.length : 0), 0);
}

function extractMessageText(content: string): string {
  const parsed = safeJsonParse(content, null) as {
    parts?: Array<{ type?: string; text?: string }>;
  } | null;
  if (!parsed?.parts) return content;
  return parsed.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

function safeJsonParse(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
}

function getUnknownString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function getApprovalResponse(part: unknown): {
  id: string;
  approved: boolean;
  reason?: string;
} | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  if (record.state !== "approval-responded") return null;
  const approval = record.approval;
  if (!approval || typeof approval !== "object") return null;
  const approvalRecord = approval as Record<string, unknown>;
  if (typeof approvalRecord.id !== "string" || typeof approvalRecord.approved !== "boolean") {
    return null;
  }
  return {
    id: approvalRecord.id,
    approved: approvalRecord.approved,
    reason: typeof approvalRecord.reason === "string" ? approvalRecord.reason : undefined,
  };
}

function getToolPartName(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  if (record.type === "dynamic-tool") return getUnknownString(part, "toolName");
  const type = getUnknownString(part, "type");
  return type?.startsWith("tool-") ? type.slice("tool-".length) : null;
}

function countSources(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const sources = (output as { sources?: unknown }).sources;
  return Array.isArray(sources) ? sources.length : undefined;
}

function summarizeToolOutput(output: unknown): Record<string, unknown> {
  if (Array.isArray(output)) return { type: "array", count: output.length };
  if (!output || typeof output !== "object") return { type: typeof output };
  const record = output as Record<string, unknown>;
  return {
    type: "object",
    count: typeof record.count === "number" ? record.count : undefined,
    id: typeof record.id === "string" ? record.id : undefined,
    sourceCount: countSources(output),
  };
}

function baseAuditDetail(
  model: ChatToolModelContext,
  conversationId: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    providerId: model.providerId,
    providerKind: model.providerKind,
    modelId: model.modelId,
    conversationId,
    ...extra,
  };
}

function recordHarnessEvent(input: {
  kind: "tool" | "test" | "approval" | "automation" | "error" | "agent" | "handoff" | "learning";
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  detail: unknown;
}): void {
  try {
    insertHarnessEvent(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[chat-tools] failed to record harness event:", message);
  }
}
