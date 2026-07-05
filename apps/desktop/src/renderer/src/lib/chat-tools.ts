import {
  CHAT_TOOL_IDS,
  normalizeChatToolSelection,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type ModelOption,
  type ProviderInfo,
} from "@shared/types";

const DEFAULT_AUTO_TOOL_IDS = new Set<ChatToolId>([
  "web_search",
  "memory_search",
  "workspace_snapshot",
  "model_capabilities",
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
  memory_search: {
    label: "Memory search",
    description: "Search saved local memories relevant to the conversation.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  workspace_snapshot: {
    label: "Workspace snapshot",
    description: "Read a compact local workspace summary.",
    kind: "host",
    category: "workspace",
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
}: {
  selectedModel: string | null | undefined;
  providers: ProviderInfo[];
}): ChatToolDescriptor[] {
  const selected = findSelectedChatModel(selectedModel, providers);
  const supportsToolCalling = selected?.model.capabilities.toolCalling === true;

  return CHAT_TOOL_IDS.map((id) => {
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
}

export function getActiveChatToolIds(
  selection: ChatToolSelectionRequest,
  descriptors: ChatToolDescriptor[],
): ChatToolId[] {
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
