import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

/**
 * 鏆撮湶缁欐覆鏌撹繘绋嬬殑 API
 *
 * 璁捐瑕佺偣锛?
 * - 浠呴€氳繃 contextBridge.exposeInMainWorld 鏆撮湶鐧藉悕鍗曟柟娉?
 * - 娓叉煋灞傞€氳繃 window.api.* 璋冪敤锛屾棤鐩存帴 ipcRenderer 璁块棶
 * - 鎵€鏈夋柟娉曡繑鍥?Promise锛坕pcRenderer.invoke 璇箟锛?
 * - API key 鏄庢枃涓嶅嚭涓昏繘绋嬶紙鏃?get 鏂规硶锛?
 */
const api = {
  conversations: {
    list: () => ipcRenderer.invoke("conversations:list"),
    listDeleted: () => ipcRenderer.invoke("conversations:listDeleted"),
    get: (id: string) => ipcRenderer.invoke("conversations:get", id),
    create: (id: string, title?: string) => ipcRenderer.invoke("conversations:create", id, title),
    delete: (id: string) => ipcRenderer.invoke("conversations:delete", id),
    restore: (id: string) => ipcRenderer.invoke("conversations:restore", id),
    permanentDelete: (id: string) => ipcRenderer.invoke("conversations:permanentDelete", id),
    permanentDeleteBatch: (ids: string[]) =>
      ipcRenderer.invoke("conversations:permanentDeleteBatch", ids),
    purgeExpired: () => ipcRenderer.invoke("conversations:purgeExpired"),
    touch: (id: string, title?: string) => ipcRenderer.invoke("conversations:touch", id, title),
  },
  messages: {
    list: (conversationId: string) => ipcRenderer.invoke("messages:list", conversationId),
    save: (msg: unknown) => ipcRenderer.invoke("messages:save", msg),
    saveBatch: (msgs: unknown[]) => ipcRenderer.invoke("messages:saveBatch", msgs),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),
    getAll: (keys: string[]) => ipcRenderer.invoke("settings:getAll", keys),
  },
  apikeys: {
    list: () => ipcRenderer.invoke("apikeys:list"),
    set: (provider: string, apiKey: string) => ipcRenderer.invoke("apikeys:set", provider, apiKey),
    delete: (provider: string) => ipcRenderer.invoke("apikeys:delete", provider),
  },
  runtime: {
    snapshot: () => ipcRenderer.invoke("runtime:snapshot"),
    events: {
      list: () => ipcRenderer.invoke("runtime:events:list"),
    },
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    get: (id: string) => ipcRenderer.invoke("agents:get", id),
    create: (input: unknown) => ipcRenderer.invoke("agents:create", input),
    update: (id: string, input: unknown) => ipcRenderer.invoke("agents:update", id, input),
    archive: (id: string) => ipcRenderer.invoke("agents:archive", id),
    restore: (id: string) => ipcRenderer.invoke("agents:restore", id),
    duplicate: (id: string) => ipcRenderer.invoke("agents:duplicate", id),
    delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
    queueLearning: (conversationId: string) =>
      ipcRenderer.invoke("agents:queueLearning", conversationId),
    runtimeSnapshot: () => ipcRenderer.invoke("agents:runtimeSnapshot"),
    save: (agent: unknown) => ipcRenderer.invoke("agents:save", agent),
  },
  memories: {
    list: () => ipcRenderer.invoke("memories:list"),
    save: (memory: unknown) => ipcRenderer.invoke("memories:save", memory),
    delete: (id: string) => ipcRenderer.invoke("memories:delete", id),
  },
  workflows: {
    list: () => ipcRenderer.invoke("workflows:list"),
    runs: () => ipcRenderer.invoke("workflowRuns:list"),
  },
  interactions: {
    list: () => ipcRenderer.invoke("interactions:list"),
  },
  desktopPet: {
    getSnapshot: () => ipcRenderer.invoke("desktopPet:getSnapshot"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("desktopPet:setEnabled", enabled),
    updateConfig: (patch: unknown) => ipcRenderer.invoke("desktopPet:updateConfig", patch),
    show: () => ipcRenderer.invoke("desktopPet:show"),
    hide: () => ipcRenderer.invoke("desktopPet:hide"),
    resetPosition: () => ipcRenderer.invoke("desktopPet:resetPosition"),
    moveWindowBy: (delta: { dx: number; dy: number }) =>
      ipcRenderer.invoke("desktopPet:moveWindowBy", delta),
    openMain: (conversationId?: string) =>
      ipcRenderer.invoke("desktopPet:openMain", conversationId),
    onOpenConversation: (handler: (conversationId?: string) => void) => {
      const listener = (_event: IpcRendererEvent, conversationId?: string): void => {
        handler(conversationId);
      };
      ipcRenderer.on("desktopPet:openConversation", listener);
      return () => ipcRenderer.removeListener("desktopPet:openConversation", listener);
    },
  },
  sync: {
    get: () => ipcRenderer.invoke("sync:get"),
  },
  tools: {
    snapshot: () => ipcRenderer.invoke("tools:snapshot"),
    updateTool: (id: string, patch: unknown) => ipcRenderer.invoke("tools:updateTool", id, patch),
    mcp: {
      create: (input: unknown) => ipcRenderer.invoke("tools:mcp:create", input),
      update: (id: string, input: unknown) => ipcRenderer.invoke("tools:mcp:update", id, input),
      delete: (id: string) => ipcRenderer.invoke("tools:mcp:delete", id),
      listDeleted: () => ipcRenderer.invoke("tools:mcp:listDeleted"),
      restore: (id: string) => ipcRenderer.invoke("tools:mcp:restore", id),
      permanentDelete: (id: string) => ipcRenderer.invoke("tools:mcp:permanentDelete", id),
      permanentDeleteBatch: (ids: string[]) =>
        ipcRenderer.invoke("tools:mcp:permanentDeleteBatch", ids),
      purgeExpired: () => ipcRenderer.invoke("tools:mcp:purgeExpired"),
      setEnabled: (id: string, enabled: boolean) =>
        ipcRenderer.invoke("tools:mcp:setEnabled", id, enabled),
      test: (id: string) => ipcRenderer.invoke("tools:mcp:test", id),
      discover: (id: string) => ipcRenderer.invoke("tools:mcp:discover", id),
      updateTool: (id: string, patch: unknown) =>
        ipcRenderer.invoke("tools:mcp:updateTool", id, patch),
      setSecret: (input: unknown) => ipcRenderer.invoke("tools:mcp:setSecret", input),
      deleteSecret: (id: string) => ipcRenderer.invoke("tools:mcp:deleteSecret", id),
    },
    skills: {
      create: (input: unknown) => ipcRenderer.invoke("tools:skills:create", input),
      generateDraft: (input: unknown) => ipcRenderer.invoke("tools:skills:generateDraft", input),
      update: (id: string, input: unknown) => ipcRenderer.invoke("tools:skills:update", id, input),
      delete: (id: string) => ipcRenderer.invoke("tools:skills:delete", id),
      listDeleted: () => ipcRenderer.invoke("tools:skills:listDeleted"),
      restore: (id: string) => ipcRenderer.invoke("tools:skills:restore", id),
      permanentDelete: (id: string) => ipcRenderer.invoke("tools:skills:permanentDelete", id),
      permanentDeleteBatch: (ids: string[]) =>
        ipcRenderer.invoke("tools:skills:permanentDeleteBatch", ids),
      purgeExpired: () => ipcRenderer.invoke("tools:skills:purgeExpired"),
      setEnabled: (id: string, enabled: boolean) =>
        ipcRenderer.invoke("tools:skills:setEnabled", id, enabled),
      run: (skillId: string, input?: unknown) =>
        ipcRenderer.invoke("tools:skills:run", skillId, input),
      setSecret: (input: unknown) => ipcRenderer.invoke("tools:skills:setSecret", input),
      deleteSecret: (id: string) => ipcRenderer.invoke("tools:skills:deleteSecret", id),
    },
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    listManagedModels: () => ipcRenderer.invoke("providers:listManagedModels"),
    upsertCustomProvider: (input: unknown) =>
      ipcRenderer.invoke("providers:upsertCustomProvider", input),
    deleteCustomProvider: (providerId: string) =>
      ipcRenderer.invoke("providers:deleteCustomProvider", providerId),
    setProviderApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke("providers:setProviderApiKey", providerId, apiKey),
    deleteProviderApiKey: (providerId: string) =>
      ipcRenderer.invoke("providers:deleteProviderApiKey", providerId),
    testProvider: (providerId: string) => ipcRenderer.invoke("providers:testProvider", providerId),
    syncAvailableModels: (providerId: string) =>
      ipcRenderer.invoke("providers:syncAvailableModels", providerId),
    upsertCustomModel: (input: unknown) => ipcRenderer.invoke("providers:upsertCustomModel", input),
    updateModelEnabled: (providerId: string, modelId: string, enabled: boolean) =>
      ipcRenderer.invoke("providers:updateModelEnabled", providerId, modelId, enabled),
    setModelApiKey: (providerId: string, modelId: string, apiKey: string) =>
      ipcRenderer.invoke("providers:setModelApiKey", providerId, modelId, apiKey),
    deleteModelApiKey: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("providers:deleteModelApiKey", providerId, modelId),
    deleteCustomModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("providers:deleteCustomModel", providerId, modelId),
  },
  server: {
    port: () => ipcRenderer.invoke("server:port"),
    info: () => ipcRenderer.invoke("server:info"),
  },
  system: {
    locale: () => ipcRenderer.invoke("system:locale"),
  },
  cache: {
    stats: () => ipcRenderer.invoke("cache:stats"),
    clear: () => ipcRenderer.invoke("cache:clear"),
  },
} as const;

// contextIsolation 鍚敤鏃堕€氳繃 contextBridge 鏆撮湶锛涘惁鍒欑洿鎺ユ寕鍒?window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error 鐢?d.ts 澹版槑
  window.electron = electronAPI;
  // @ts-expect-error 鐢?d.ts 澹版槑
  window.api = api;
}
