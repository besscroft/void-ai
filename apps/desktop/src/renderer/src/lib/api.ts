import type {
  AgentProfile,
  CacheStats,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  HarnessEvent,
  InteractionProfile,
  LocalServerInfo,
  ManagedModelInfo,
  MemoryRecord,
  MessageRow,
  ProviderInfo,
  ServerNode,
  SyncState,
  WorkflowDefinition,
  WorkflowRun,
  WorkspaceSnapshot,
} from "@shared/types";

/**
 * 渲染层对 window.api 的类型化封装
 *
 * 通过此模块统一访问 IPC，便于：
 * - 类型推导
 * - 单点修改 IPC 调用方式
 * - 单元测试 mock
 */

function assertApi(): NonNullable<Window["api"]> {
  if (!window.api) {
    throw new Error("window.api 未注入：请确认 preload 已正确加载");
  }
  return window.api;
}

export const api = {
  conversations: {
    list: (): Promise<Conversation[]> => assertApi().conversations.list(),
    listDeleted: (): Promise<Conversation[]> => assertApi().conversations.listDeleted(),
    get: (id: string): Promise<Conversation | null> => assertApi().conversations.get(id),
    create: (id: string, title?: string): Promise<Conversation> =>
      assertApi().conversations.create(id, title),
    delete: (id: string): Promise<boolean> => assertApi().conversations.delete(id),
    restore: (id: string): Promise<boolean> => assertApi().conversations.restore(id),
    permanentDelete: (id: string): Promise<boolean> =>
      assertApi().conversations.permanentDelete(id),
    purgeExpired: (): Promise<number> => assertApi().conversations.purgeExpired(),
    touch: (id: string, title?: string): Promise<boolean> =>
      assertApi().conversations.touch(id, title),
  },
  messages: {
    list: (conversationId: string): Promise<MessageRow[]> =>
      assertApi().messages.list(conversationId),
    save: (msg: MessageRow): Promise<boolean> => assertApi().messages.save(msg),
    saveBatch: (msgs: MessageRow[]): Promise<boolean> => assertApi().messages.saveBatch(msgs),
  },
  settings: {
    get: (key: string): Promise<string | null> => assertApi().settings.get(key),
    set: (key: string, value: string): Promise<boolean> => assertApi().settings.set(key, value),
    getAll: (keys: string[]): Promise<Record<string, string | null>> =>
      assertApi().settings.getAll(keys),
  },
  apikeys: {
    list: (): Promise<string[]> => assertApi().apikeys.list(),
    set: (provider: string, apiKey: string): Promise<boolean> =>
      assertApi().apikeys.set(provider, apiKey),
    delete: (provider: string): Promise<boolean> => assertApi().apikeys.delete(provider),
  },
  workspace: {
    snapshot: (): Promise<WorkspaceSnapshot> => assertApi().workspace.snapshot(),
  },
  agents: {
    list: (): Promise<AgentProfile[]> => assertApi().agents.list(),
    save: (agent: AgentProfile): Promise<boolean> => assertApi().agents.save(agent),
  },
  memories: {
    list: (): Promise<MemoryRecord[]> => assertApi().memories.list(),
    save: (memory: MemoryRecord): Promise<boolean> => assertApi().memories.save(memory),
    delete: (id: string): Promise<boolean> => assertApi().memories.delete(id),
  },
  workflows: {
    list: (): Promise<WorkflowDefinition[]> => assertApi().workflows.list(),
    runs: (): Promise<WorkflowRun[]> => assertApi().workflows.runs(),
  },
  harness: {
    list: (): Promise<HarnessEvent[]> => assertApi().harness.list(),
  },
  serverNodes: {
    list: (): Promise<ServerNode[]> => assertApi().serverNodes.list(),
  },
  interactions: {
    list: (): Promise<InteractionProfile[]> => assertApi().interactions.list(),
  },
  sync: {
    get: (): Promise<SyncState> => assertApi().sync.get(),
  },
  providers: {
    list: (): Promise<ProviderInfo[]> => assertApi().providers.list(),
    listManagedModels: (): Promise<ManagedModelInfo[]> => assertApi().providers.listManagedModels(),
    upsertCustomProvider: (input: CustomProviderInput): Promise<ProviderInfo> =>
      assertApi().providers.upsertCustomProvider(input),
    deleteCustomProvider: (providerId: string): Promise<boolean> =>
      assertApi().providers.deleteCustomProvider(providerId),
    upsertCustomModel: (input: CustomModelInput): Promise<ProviderInfo> =>
      assertApi().providers.upsertCustomModel(input),
    updateModelEnabled: (providerId: string, modelId: string, enabled: boolean): Promise<boolean> =>
      assertApi().providers.updateModelEnabled(providerId, modelId, enabled),
    setModelApiKey: (providerId: string, modelId: string, apiKey: string): Promise<boolean> =>
      assertApi().providers.setModelApiKey(providerId, modelId, apiKey),
    deleteModelApiKey: (providerId: string, modelId: string): Promise<boolean> =>
      assertApi().providers.deleteModelApiKey(providerId, modelId),
    deleteCustomModel: (providerId: string, modelId: string): Promise<boolean> =>
      assertApi().providers.deleteCustomModel(providerId, modelId),
  },
  server: {
    port: (): Promise<number> => assertApi().server.port(),
    info: (): Promise<LocalServerInfo> => assertApi().server.info(),
  },
  system: {
    locale: (): Promise<string> => assertApi().system.locale(),
  },
  cache: {
    stats: (): Promise<CacheStats> => assertApi().cache.stats(),
    clear: (): Promise<number> => assertApi().cache.clear(),
  },
};

export type {
  AgentProfile,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  HarnessEvent,
  InteractionProfile,
  LocalServerInfo,
  MemoryRecord,
  MessageRow,
  ProviderInfo,
  ServerNode,
  SyncState,
  WorkflowDefinition,
  WorkflowRun,
  WorkspaceSnapshot,
};
