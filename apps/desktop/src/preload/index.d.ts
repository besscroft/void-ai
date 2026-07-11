import { ElectronAPI } from "@electron-toolkit/preload";
import type {
  AgentInput,
  AgentProfile,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  DesktopPetConfig,
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
  MemoryKind,
  MemoryPendingSuggestion,
  MemoryRecord,
  MemoryScope,
  MessageRow,
  ToolDiscoveryResult,
  ToolServer,
  ToolServerInput,
  ToolRecord,
  ProviderModelSyncResult,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTransition,
  ProviderInfo,
  ProviderTestResult,
  SyncState,
  RuntimeSnapshot,
  ActiveWorkflowRunSnapshot,
} from "../shared/types";

/**
 * Void AI 鏆撮湶缁欐覆鏌撹繘绋嬬殑 API
 *
 * 璁捐鍘熷垯锛?
 * - 浠呴€氳繃 contextBridge 鏆撮湶鐧藉悕鍗曟柟娉曪紝娓叉煋灞傛棤娉曠洿鎺ヨ闂?Node API
 * - API key 鏄庢枃涓嶅嚭涓昏繘绋嬶紱杩欓噷鍙彁渚?set/list锛屼笉鎻愪緵 get
 * - 鎵€鏈夋柟娉曡繑鍥?Promise锛坕pcRenderer.invoke 鐨勮涔夛級
 */
export interface VoidAIApi {
  // 浼氳瘽鍘嗗彶
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
  // 娑堟伅
  messages: {
    list: (conversationId: string) => Promise<MessageRow[]>;
    save: (msg: MessageRow) => Promise<boolean>;
    saveBatch: (msgs: MessageRow[]) => Promise<boolean>;
  };
  // 搴旂敤璁剧疆
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    getAll: (keys: string[]) => Promise<Record<string, string | null>>;
  };
  // API Key 绠＄悊锛堟槑鏂囦笉澶栨硠锛?
  apikeys: {
    list: () => Promise<string[]>;
    set: (provider: string, apiKey: string) => Promise<boolean>;
    delete: (provider: string) => Promise<boolean>;
  };
  runtime: {
    snapshot: () => Promise<RuntimeSnapshot>;
    events: {
      list: () => Promise<RuntimeEvent[]>;
    };
  };
  agents: {
    list: () => Promise<AgentProfile[]>;
    get: (id: string) => Promise<AgentProfile | null>;
    create: (input: AgentInput) => Promise<AgentProfile>;
    update: (id: string, input: Partial<AgentInput>) => Promise<AgentProfile>;
    archive: (id: string) => Promise<AgentProfile>;
    restore: (id: string) => Promise<AgentProfile>;
    duplicate: (id: string) => Promise<AgentProfile>;
    delete: (id: string) => Promise<boolean>;
    queueLearning: (conversationId: string) => Promise<boolean>;
    runtimeSnapshot: () => Promise<
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
    >;
    save: (agent: AgentProfile) => Promise<boolean>;
  };
  memories: {
    list: () => Promise<MemoryRecord[]>;
    search: (filters: {
      query?: string;
      scope?: MemoryScope | null;
      kind?: MemoryKind | null;
      agentId?: string | null;
      conversationId?: string | null;
      pinned?: boolean | null;
      sortBy?: "salience" | "updated" | "created";
      sortOrder?: "asc" | "desc";
      limit?: number;
    }) => Promise<MemoryRecord[]>;
    get: (id: string) => Promise<MemoryRecord | null>;
    save: (memory: MemoryRecord) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
    deleteBatch: (ids: string[]) => Promise<number>;
    updateBatch: (
      ids: string[],
      patch: Partial<Pick<MemoryRecord, "pinned" | "salience" | "kind" | "scope">>,
    ) => Promise<number>;
    pending: {
      list: () => Promise<MemoryPendingSuggestion[]>;
      confirm: (id: string) => Promise<boolean>;
      reject: (id: string) => Promise<boolean>;
      confirmAll: () => Promise<boolean>;
      rejectAll: () => Promise<boolean>;
    };
  };
  workflows: {
    // chat 页面悬浮状态框专用：按会话取最近一次 run（活动优先 / 终态次之）
    activeRunForConversation: (conversationId: string) => Promise<ActiveWorkflowRunSnapshot | null>;
    // 用户在悬浮状态框中可主动取消正在运行的 workflow
    cancelRun: (runId: string) => Promise<boolean>;
  };
  interactions: {
    list: () => Promise<InteractionProfile[]>;
  };
  desktopPet: {
    getSnapshot: () => Promise<DesktopPetSnapshot>;
    setEnabled: (enabled: boolean) => Promise<DesktopPetSnapshot>;
    updateConfig: (patch: DesktopPetConfigPatch) => Promise<DesktopPetSnapshot>;
    show: () => Promise<DesktopPetSnapshot>;
    hide: () => Promise<DesktopPetSnapshot>;
    resetPosition: () => Promise<DesktopPetSnapshot>;
    moveWindowBy: (delta: { dx: number; dy: number }) => Promise<boolean>;
    openMain: (conversationId?: string) => Promise<boolean>;
    showContextMenu: () => Promise<boolean>;
    setFrameRate: (fps: number) => Promise<boolean>;
    setWindowSize: (size: { width: number; height: number }) => Promise<boolean>;
    setIgnoreMouseEvents: (ignore: boolean) => Promise<boolean>;
    onOpenConversation: (handler: (conversationId?: string) => void) => () => void;
    onConfigApplied: (handler: (config: DesktopPetConfig) => void) => () => void;
  };
  sync: {
    get: () => Promise<SyncState>;
  };
  // Provider 鍏冧俊鎭?
  tools: {
    snapshot: () => Promise<ToolsSnapshot>;
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ) => Promise<ToolRecord>;
    mcp: {
      create: (input: ToolServerInput) => Promise<ToolServer>;
      update: (id: string, input: Partial<ToolServerInput>) => Promise<ToolServer>;
      delete: (id: string) => Promise<boolean>;
      listDeleted: () => Promise<ToolServer[]>;
      restore: (id: string) => Promise<ToolServer>;
      permanentDelete: (id: string) => Promise<boolean>;
      permanentDeleteBatch: (ids: string[]) => Promise<number>;
      purgeExpired: () => Promise<number>;
      setEnabled: (id: string, enabled: boolean) => Promise<ToolServer>;
      test: (id: string) => Promise<ToolDiscoveryResult>;
      discover: (id: string) => Promise<ToolDiscoveryResult>;
      updateTool: (
        id: string,
        patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
      ) => Promise<ToolRecord>;
      setSecret: (input: ToolSecretInput) => Promise<ToolSecretPublic>;
      deleteSecret: (id: string) => Promise<boolean>;
    };
    skills: {
      create: (input: ToolSkillInput) => Promise<ToolSkill>;
      generateDraft: (input: SkillDraftRequest) => Promise<SkillDraftResult>;
      update: (id: string, input: Partial<ToolSkillInput>) => Promise<ToolSkill>;
      delete: (id: string) => Promise<boolean>;
      listDeleted: () => Promise<ToolSkill[]>;
      restore: (id: string) => Promise<ToolSkill>;
      permanentDelete: (id: string) => Promise<boolean>;
      permanentDeleteBatch: (ids: string[]) => Promise<number>;
      purgeExpired: () => Promise<number>;
      setEnabled: (id: string, enabled: boolean) => Promise<ToolSkill>;
      run: (skillId: string, input?: unknown) => Promise<unknown>;
      setSecret: (input: ToolSecretInput) => Promise<ToolSecretPublic>;
      deleteSecret: (id: string) => Promise<boolean>;
    };
  };
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
  // 鏈湴 AI 鏈嶅姟
  server: {
    port: () => Promise<number>;
    info: () => Promise<LocalServerInfo>;
  };
  system: {
    locale: () => Promise<string>;
    onPetOpenSettings: (handler: () => void) => () => void;
    onPetOpenAbout: (handler: () => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: VoidAIApi;
  }
}
