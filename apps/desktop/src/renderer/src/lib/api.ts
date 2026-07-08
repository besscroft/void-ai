import type {
  AgentInput,
  AgentProfile,
  CacheStats,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  DesktopPetConfigPatch,
  DesktopPetSnapshot,
  SkillDraftRequest,
  SkillDraftResult,
  ToolSecretInput,
  ToolSecretPublic,
  ToolSkill,
  ToolSkillInput,
  ToolsSnapshot,
  RuntimeEvent,
  InteractionProfile,
  LocalServerInfo,
  ManagedModelInfo,
  MemoryRecord,
  MessageRow,
  ToolDiscoveryResult,
  ToolServer,
  ToolServerInput,
  ToolRecord,
  ProviderModelSyncResult,
  ProviderInfo,
  ProviderTestResult,
  SyncState,
  WorkflowDefinition,
  WorkflowRun,
  RuntimeSnapshot,
} from "@shared/types";

/**
 * 娓叉煋灞傚 window.api 鐨勭被鍨嬪寲灏佽
 *
 * 閫氳繃姝ゆā鍧楃粺涓€璁块棶 IPC锛屼究浜庯細
 * - 绫诲瀷鎺ㄥ
 * - 鍗曠偣淇敼 IPC 璋冪敤鏂瑰紡
 * - 鍗曞厓娴嬭瘯 mock
 */

function assertApi(): NonNullable<Window["api"]> {
  if (!window.api) {
    throw new Error("window.api is not available. Ensure preload has loaded correctly.");
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
    permanentDeleteBatch: (ids: string[]): Promise<number> =>
      assertApi().conversations.permanentDeleteBatch(ids),
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
  runtime: {
    snapshot: (): Promise<RuntimeSnapshot> => assertApi().runtime.snapshot(),
    events: {
      list: (): Promise<RuntimeEvent[]> => assertApi().runtime.events.list(),
    },
  },
  agents: {
    list: (): Promise<AgentProfile[]> => assertApi().agents.list(),
    get: (id: string): Promise<AgentProfile | null> => assertApi().agents.get(id),
    create: (input: AgentInput): Promise<AgentProfile> => assertApi().agents.create(input),
    update: (id: string, input: Partial<AgentInput>): Promise<AgentProfile> =>
      assertApi().agents.update(id, input),
    archive: (id: string): Promise<AgentProfile> => assertApi().agents.archive(id),
    restore: (id: string): Promise<AgentProfile> => assertApi().agents.restore(id),
    duplicate: (id: string): Promise<AgentProfile> => assertApi().agents.duplicate(id),
    queueLearning: (conversationId: string): Promise<boolean> =>
      assertApi().agents.queueLearning(conversationId),
    runtimeSnapshot: (): Promise<
      Pick<
        RuntimeSnapshot,
        | "runtimeRuns"
        | "runtimeSteps"
        | "agentRuntimeStates"
        | "conversationAgentStates"
        | "sandboxSessions"
        | "sandboxSnapshots"
        | "sandboxArtifacts"
        | "runtimeEvents"
      >
    > => assertApi().agents.runtimeSnapshot(),
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
  interactions: {
    list: (): Promise<InteractionProfile[]> => assertApi().interactions.list(),
  },
  desktopPet: {
    getSnapshot: (): Promise<DesktopPetSnapshot> => assertApi().desktopPet.getSnapshot(),
    setEnabled: (enabled: boolean): Promise<DesktopPetSnapshot> =>
      assertApi().desktopPet.setEnabled(enabled),
    updateConfig: (patch: DesktopPetConfigPatch): Promise<DesktopPetSnapshot> =>
      assertApi().desktopPet.updateConfig(patch),
    show: (): Promise<DesktopPetSnapshot> => assertApi().desktopPet.show(),
    hide: (): Promise<DesktopPetSnapshot> => assertApi().desktopPet.hide(),
    resetPosition: (): Promise<DesktopPetSnapshot> => assertApi().desktopPet.resetPosition(),
    moveWindowBy: (delta: { dx: number; dy: number }): Promise<boolean> =>
      assertApi().desktopPet.moveWindowBy(delta),
    openMain: (conversationId?: string): Promise<boolean> =>
      assertApi().desktopPet.openMain(conversationId),
    onOpenConversation: (handler: (conversationId?: string) => void): (() => void) =>
      assertApi().desktopPet.onOpenConversation(handler),
  },
  sync: {
    get: (): Promise<SyncState> => assertApi().sync.get(),
  },
  tools: {
    snapshot: (): Promise<ToolsSnapshot> => assertApi().tools.snapshot(),
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ): Promise<ToolRecord> => assertApi().tools.updateTool(id, patch),
    mcp: {
      create: (input: ToolServerInput): Promise<ToolServer> => assertApi().tools.mcp.create(input),
      update: (id: string, input: Partial<ToolServerInput>): Promise<ToolServer> =>
        assertApi().tools.mcp.update(id, input),
      delete: (id: string): Promise<boolean> => assertApi().tools.mcp.delete(id),
      listDeleted: (): Promise<ToolServer[]> => assertApi().tools.mcp.listDeleted(),
      restore: (id: string): Promise<ToolServer> => assertApi().tools.mcp.restore(id),
      permanentDelete: (id: string): Promise<boolean> => assertApi().tools.mcp.permanentDelete(id),
      permanentDeleteBatch: (ids: string[]): Promise<number> =>
        assertApi().tools.mcp.permanentDeleteBatch(ids),
      purgeExpired: (): Promise<number> => assertApi().tools.mcp.purgeExpired(),
      setEnabled: (id: string, enabled: boolean): Promise<ToolServer> =>
        assertApi().tools.mcp.setEnabled(id, enabled),
      test: (id: string): Promise<ToolDiscoveryResult> => assertApi().tools.mcp.test(id),
      discover: (id: string): Promise<ToolDiscoveryResult> => assertApi().tools.mcp.discover(id),
      updateTool: (
        id: string,
        patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
      ): Promise<ToolRecord> => assertApi().tools.mcp.updateTool(id, patch),
      setSecret: (input: ToolSecretInput): Promise<ToolSecretPublic> =>
        assertApi().tools.mcp.setSecret(input),
      deleteSecret: (id: string): Promise<boolean> => assertApi().tools.mcp.deleteSecret(id),
    },
    skills: {
      create: (input: ToolSkillInput): Promise<ToolSkill> => assertApi().tools.skills.create(input),
      generateDraft: (input: SkillDraftRequest): Promise<SkillDraftResult> =>
        assertApi().tools.skills.generateDraft(input),
      update: (id: string, input: Partial<ToolSkillInput>): Promise<ToolSkill> =>
        assertApi().tools.skills.update(id, input),
      delete: (id: string): Promise<boolean> => assertApi().tools.skills.delete(id),
      listDeleted: (): Promise<ToolSkill[]> => assertApi().tools.skills.listDeleted(),
      restore: (id: string): Promise<ToolSkill> => assertApi().tools.skills.restore(id),
      permanentDelete: (id: string): Promise<boolean> =>
        assertApi().tools.skills.permanentDelete(id),
      permanentDeleteBatch: (ids: string[]): Promise<number> =>
        assertApi().tools.skills.permanentDeleteBatch(ids),
      purgeExpired: (): Promise<number> => assertApi().tools.skills.purgeExpired(),
      setEnabled: (id: string, enabled: boolean): Promise<ToolSkill> =>
        assertApi().tools.skills.setEnabled(id, enabled),
      run: (skillId: string, input?: unknown): Promise<unknown> =>
        assertApi().tools.skills.run(skillId, input),
      setSecret: (input: ToolSecretInput): Promise<ToolSecretPublic> =>
        assertApi().tools.skills.setSecret(input),
      deleteSecret: (id: string): Promise<boolean> => assertApi().tools.skills.deleteSecret(id),
    },
  },
  providers: {
    list: (): Promise<ProviderInfo[]> => assertApi().providers.list(),
    listManagedModels: (): Promise<ManagedModelInfo[]> => assertApi().providers.listManagedModels(),
    upsertCustomProvider: (input: CustomProviderInput): Promise<ProviderInfo> =>
      assertApi().providers.upsertCustomProvider(input),
    deleteCustomProvider: (providerId: string): Promise<boolean> =>
      assertApi().providers.deleteCustomProvider(providerId),
    setProviderApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
      assertApi().providers.setProviderApiKey(providerId, apiKey),
    deleteProviderApiKey: (providerId: string): Promise<boolean> =>
      assertApi().providers.deleteProviderApiKey(providerId),
    testProvider: (providerId: string): Promise<ProviderTestResult> =>
      assertApi().providers.testProvider(providerId),
    syncAvailableModels: (providerId: string): Promise<ProviderModelSyncResult> =>
      assertApi().providers.syncAvailableModels(providerId),
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
  AgentInput,
  AgentProfile,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  DesktopPetConfigPatch,
  DesktopPetSnapshot,
  ToolSecretInput,
  ToolSecretPublic,
  ToolSkill,
  ToolSkillInput,
  ToolsSnapshot,
  RuntimeEvent,
  InteractionProfile,
  LocalServerInfo,
  MemoryRecord,
  MessageRow,
  ToolDiscoveryResult,
  ToolServer,
  ToolServerInput,
  ToolRecord,
  ProviderModelSyncResult,
  ProviderInfo,
  ProviderTestResult,
  SyncState,
  WorkflowDefinition,
  WorkflowRun,
  RuntimeSnapshot,
};
