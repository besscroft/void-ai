import {
  CHAT_TOOL_IDS,
  normalizeChatToolSelection,
  type ChatToolReference,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type ToolsSnapshot,
  type ModelOption,
  type ProviderInfo,
} from "@shared/types";

const DEFAULT_AUTO_TOOL_IDS = new Set<ChatToolId>([
  "web_search",
  "current_time",
  "memory_search",
  "runtime_snapshot",
  "model_capabilities",
  "sandbox_list_files",
  "sandbox_read_file",
  "sandbox_snapshot",
  "sandbox_list_artifacts",
]);

const TOOL_METADATA: Record<
  ChatToolId,
  Pick<ChatToolDescriptor, "label" | "description" | "kind" | "category" | "requiresApproval">
> = {
  web_search: {
    label: "Web search",
    description: "Search the live web with native provider search or a host fallback.",
    kind: "provider",
    category: "web",
    requiresApproval: false,
  },
  current_time: {
    label: "Current time",
    description: "Read the current system date, time, and timezone from the host device.",
    kind: "host",
    category: "system",
    requiresApproval: false,
  },
  memory_search: {
    label: "Memory search",
    description: "Search saved local memories relevant to the conversation.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  runtime_snapshot: {
    label: "Runtime snapshot",
    description: "Read a compact local runtime summary.",
    kind: "host",
    category: "runtime",
    requiresApproval: false,
  },
  model_capabilities: {
    label: "Model capabilities",
    description: "Inspect the selected model and enabled chat tools.",
    kind: "host",
    category: "model",
    requiresApproval: false,
  },
  conversation_search: {
    label: "Conversation search",
    description: "Search messages in this conversation after approval.",
    kind: "host",
    category: "conversation",
    requiresApproval: true,
  },
  memory_save: {
    label: "Save memory",
    description: "Save a new local memory after approval.",
    kind: "host",
    category: "memory",
    requiresApproval: true,
  },
  memory_update: {
    label: "Update memory",
    description: "Update an existing local memory after approval.",
    kind: "host",
    category: "memory",
    requiresApproval: true,
  },
  memory_delete: {
    label: "Delete memory",
    description: "Delete an existing local memory after approval.",
    kind: "host",
    category: "memory",
    requiresApproval: true,
  },
  sandbox_list_files: {
    label: "Sandbox files",
    description: "List files inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_read_file: {
    label: "Read sandbox file",
    description: "Read a text file inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_write_file: {
    label: "Write sandbox file",
    description: "Write or overwrite a file inside the current sandbox session after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_run_command: {
    label: "Run sandbox command",
    description: "Run a command in the current sandbox session after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_snapshot: {
    label: "Create sandbox snapshot",
    description: "Create a restorable snapshot of the current sandbox files.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_restore: {
    label: "Restore sandbox snapshot",
    description: "Restore a sandbox snapshot after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_list_artifacts: {
    label: "Sandbox artifacts",
    description: "List files and previews exported from the sandbox.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_preview_port: {
    label: "Sandbox preview port",
    description: "Register a local preview port for the sandbox after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
};

export interface SelectedChatModelInfo {
  provider: ProviderInfo;
  model: ModelOption;
}

export function findSelectedChatModel(
  selectedModel: string | null | undefined,
  providers: ProviderInfo[],
): SelectedChatModelInfo | null {
  if (!selectedModel) return null;
  const slashIdx = selectedModel.indexOf("/");
  if (slashIdx <= 0) return null;
  const providerId = selectedModel.slice(0, slashIdx);
  const modelId = selectedModel.slice(slashIdx + 1);
  const provider = providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return provider && model ? { provider, model } : null;
}

export function createClientChatToolDescriptors({
  selectedModel,
  providers,
  tools,
}: {
  selectedModel: string | null | undefined;
  providers: ProviderInfo[];
  tools?: ToolsSnapshot | null;
}): ChatToolDescriptor[] {
  const selected = findSelectedChatModel(selectedModel, providers);
  const supportsToolCalling = selected?.model.capabilities.toolCalling === true;

  const builtIn = CHAT_TOOL_IDS.map((id) => {
    const meta = TOOL_METADATA[id];
    const webSearchExecution =
      id === "web_search" && selected ? getWebSearchExecution(selected.provider.kind) : undefined;
    const available = !!selected && supportsToolCalling;

    return {
      id,
      ...meta,
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
      defaultAuto: DEFAULT_AUTO_TOOL_IDS.has(id),
      available,
      unavailableReason: available
        ? undefined
        : getUnavailableReason({ id, selected, supportsToolCalling }),
    };
  });

  return [...builtIn, ...createtoolChatToolDescriptors(tools, supportsToolCalling)];
}

export function getActiveChatToolIds(
  selection: ChatToolSelectionRequest,
  descriptors: ChatToolDescriptor[],
): ChatToolReference[] {
  const normalized = normalizeChatToolSelection(selection);
  if (normalized.mode === "off") return [];
  if (normalized.mode === "auto") {
    return descriptors
      .filter((descriptor) => descriptor.available && descriptor.defaultAuto)
      .map((descriptor) => descriptor.id);
  }
  const availableIds = new Set(
    descriptors.filter((descriptor) => descriptor.available).map((descriptor) => descriptor.id),
  );
  return normalized.selectedToolIds.filter((id) => availableIds.has(id));
}

function createtoolChatToolDescriptors(
  tools: ToolsSnapshot | null | undefined,
  supportsToolCalling: boolean,
): ChatToolDescriptor[] {
  if (!tools) return [];
  const serverById = new Map(tools.toolServers.map((server) => [server.id, server]));
  const mcpDescriptors = tools.toolRecords
    .filter((toolRecord) => toolRecord.kind === "mcp")
    .map((toolRecord) => {
      const serverId = toolRecord.server_id ?? "";
      const server = serverId ? serverById.get(serverId) : undefined;
      const enabled = !!server && server.enabled !== 0 && toolRecord.enabled !== 0;
      const available = supportsToolCalling && enabled;
      return {
        id: `mcp:${serverId}:${toolRecord.name}`,
        label: toolRecord.title || `${server?.name ?? serverId}: ${toolRecord.name}`,
        description: toolRecord.description || `MCP tool from ${server?.name ?? "server"}.`,
        kind: "host",
        execution: "host",
        category: "mcp",
        defaultAuto:
          supportsToolCalling &&
          enabled &&
          (server?.auto_use ?? 0) !== 0 &&
          toolRecord.auto_use !== 0,
        requiresApproval:
          (server?.requires_approval ?? 1) !== 0 || toolRecord.requires_approval !== 0,
        available,
        unavailableReason: available
          ? undefined
          : supportsToolCalling
            ? "MCP server or tool is disabled."
            : "Selected model does not advertise tool calling.",
        sourceId: serverId || undefined,
        sourceName: server?.name,
      } satisfies ChatToolDescriptor;
    });

  const skillDescriptors = tools.skills.map((skill) => {
    const enabled = skill.enabled !== 0;
    const available = supportsToolCalling && enabled;
    return {
      id: `skill:${skill.id}`,
      label: skill.name,
      description: skill.description || "Workflow skill",
      kind: "host",
      execution: "host",
      category: "skill",
      defaultAuto: supportsToolCalling && enabled && skill.auto_use !== 0,
      requiresApproval: skill.requires_approval !== 0,
      available,
      unavailableReason: available
        ? undefined
        : supportsToolCalling
          ? "Skill is disabled."
          : "Selected model does not advertise tool calling.",
      sourceId: skill.id,
      sourceName: skill.category,
    } satisfies ChatToolDescriptor;
  });

  return [...mcpDescriptors, ...skillDescriptors];
}

function isNativeWebSearchProvider(kind: ProviderInfo["kind"]): boolean {
  return kind === "openai" || kind === "anthropic" || kind === "google";
}

function getWebSearchExecution(kind: ProviderInfo["kind"]): "provider" | "host" {
  return isNativeWebSearchProvider(kind) ? "provider" : "host";
}

function getUnavailableReason({
  id,
  selected,
  supportsToolCalling,
}: {
  id: ChatToolId;
  selected: SelectedChatModelInfo | null;
  supportsToolCalling: boolean;
}): string {
  if (!selected) return "Select a model before enabling tools.";
  if (!supportsToolCalling) return "Selected model does not advertise tool calling.";
  if (id === "web_search") {
    return "Web search requires a tool-calling model.";
  }
  return "Tool calling is unavailable for the selected model.";
}
