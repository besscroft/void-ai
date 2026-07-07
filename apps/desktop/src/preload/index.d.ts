import { ElectronAPI } from "@electron-toolkit/preload";
import type {
  AgentInput,
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
  ProviderModelSyncResult,
  ProviderInfo,
  ProviderTestResult,
  ServerNode,
  SyncState,
  WorkflowDefinition,
  WorkflowRun,
  WorkspaceSnapshot,
} from "../shared/types";

/**
 * Void AI 暴露给渲染进程的 API
 *
 * 设计原则：
 * - 仅通过 contextBridge 暴露白名单方法，渲染层无法直接访问 Node API
 * - API key 明文不出主进程；这里只提供 set/list，不提供 get
 * - 所有方法返回 Promise（ipcRenderer.invoke 的语义）
 */
export interface VoidAIApi {
  // 会话历史
  conversations: {
    list: () => Promise<Conversation[]>;
    listDeleted: () => Promise<Conversation[]>;
    get: (id: string) => Promise<Conversation | null>;
    create: (id: string, title?: string) => Promise<Conversation>;
    delete: (id: string) => Promise<boolean>;
    restore: (id: string) => Promise<boolean>;
    permanentDelete: (id: string) => Promise<boolean>;
    permanentDeleteBatch: (ids: string[]) => Promise<number>;
    purgeExpired: () => Promise<number>;
    touch: (id: string, title?: string) => Promise<boolean>;
  };
  // 消息
  messages: {
    list: (conversationId: string) => Promise<MessageRow[]>;
    save: (msg: MessageRow) => Promise<boolean>;
    saveBatch: (msgs: MessageRow[]) => Promise<boolean>;
  };
  // 应用设置
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    getAll: (keys: string[]) => Promise<Record<string, string | null>>;
  };
  // API Key 管理（明文不外泄）
  apikeys: {
    list: () => Promise<string[]>;
    set: (provider: string, apiKey: string) => Promise<boolean>;
    delete: (provider: string) => Promise<boolean>;
  };
  workspace: {
    snapshot: () => Promise<WorkspaceSnapshot>;
  };
  agents: {
    list: () => Promise<AgentProfile[]>;
    get: (id: string) => Promise<AgentProfile | null>;
    create: (input: AgentInput) => Promise<AgentProfile>;
    update: (id: string, input: Partial<AgentInput>) => Promise<AgentProfile>;
    archive: (id: string) => Promise<AgentProfile>;
    restore: (id: string) => Promise<AgentProfile>;
    duplicate: (id: string) => Promise<AgentProfile>;
    queueLearning: (conversationId: string) => Promise<boolean>;
    runtimeSnapshot: () => Promise<
      Pick<
        WorkspaceSnapshot,
        | "agentRuns"
        | "agentRunSteps"
        | "agentRuntimeStates"
        | "conversationAgentStates"
        | "sandboxSessions"
        | "sandboxSnapshots"
        | "sandboxArtifacts"
      >
    >;
    save: (agent: AgentProfile) => Promise<boolean>;
  };
  memories: {
    list: () => Promise<MemoryRecord[]>;
    save: (memory: MemoryRecord) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
  };
  workflows: {
    list: () => Promise<WorkflowDefinition[]>;
    runs: () => Promise<WorkflowRun[]>;
  };
  harness: {
    list: () => Promise<HarnessEvent[]>;
  };
  serverNodes: {
    list: () => Promise<ServerNode[]>;
  };
  interactions: {
    list: () => Promise<InteractionProfile[]>;
  };
  sync: {
    get: () => Promise<SyncState>;
  };
  // Provider 元信息
  providers: {
    list: () => Promise<ProviderInfo[]>;
    listManagedModels: () => Promise<ManagedModelInfo[]>;
    upsertCustomProvider: (input: CustomProviderInput) => Promise<ProviderInfo>;
    deleteCustomProvider: (providerId: string) => Promise<boolean>;
    setProviderApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
    deleteProviderApiKey: (providerId: string) => Promise<boolean>;
    testProvider: (providerId: string) => Promise<ProviderTestResult>;
    syncAvailableModels: (providerId: string) => Promise<ProviderModelSyncResult>;
    upsertCustomModel: (input: CustomModelInput) => Promise<ProviderInfo>;
    updateModelEnabled: (providerId: string, modelId: string, enabled: boolean) => Promise<boolean>;
    setModelApiKey: (providerId: string, modelId: string, apiKey: string) => Promise<boolean>;
    deleteModelApiKey: (providerId: string, modelId: string) => Promise<boolean>;
    deleteCustomModel: (providerId: string, modelId: string) => Promise<boolean>;
  };
  // 本地 AI 服务
  server: {
    port: () => Promise<number>;
    info: () => Promise<LocalServerInfo>;
  };
  system: {
    locale: () => Promise<string>;
  };
  // 缓存管理
  cache: {
    stats: () => Promise<CacheStats>;
    clear: () => Promise<number>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: VoidAIApi;
  }
}
