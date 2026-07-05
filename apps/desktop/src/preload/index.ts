import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

/**
 * 暴露给渲染进程的 API
 *
 * 设计要点：
 * - 仅通过 contextBridge.exposeInMainWorld 暴露白名单方法
 * - 渲染层通过 window.api.* 调用，无直接 ipcRenderer 访问
 * - 所有方法返回 Promise（ipcRenderer.invoke 语义）
 * - API key 明文不出主进程（无 get 方法）
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
  workspace: {
    snapshot: () => ipcRenderer.invoke("workspace:snapshot"),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
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
  harness: {
    list: () => ipcRenderer.invoke("harness:list"),
  },
  serverNodes: {
    list: () => ipcRenderer.invoke("serverNodes:list"),
  },
  interactions: {
    list: () => ipcRenderer.invoke("interactions:list"),
  },
  sync: {
    get: () => ipcRenderer.invoke("sync:get"),
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

// contextIsolation 启用时通过 contextBridge 暴露；否则直接挂到 window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error 由 d.ts 声明
  window.electron = electronAPI;
  // @ts-expect-error 由 d.ts 声明
  window.api = api;
}
