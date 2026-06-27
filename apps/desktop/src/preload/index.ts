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
    get: (id: string) => ipcRenderer.invoke("conversations:get", id),
    create: (id: string, title?: string) => ipcRenderer.invoke("conversations:create", id, title),
    delete: (id: string) => ipcRenderer.invoke("conversations:delete", id),
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
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
  },
  server: {
    port: () => ipcRenderer.invoke("server:port"),
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
