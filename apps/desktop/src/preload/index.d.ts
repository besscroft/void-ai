import { ElectronAPI } from "@electron-toolkit/preload";
import type { Conversation, MessageRow, ProviderInfo, CacheStats } from "../shared/types";

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
    get: (id: string) => Promise<Conversation | null>;
    create: (id: string, title?: string) => Promise<Conversation>;
    delete: (id: string) => Promise<boolean>;
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
  // Provider 元信息
  providers: {
    list: () => Promise<ProviderInfo[]>;
  };
  // 本地 AI 服务
  server: {
    port: () => Promise<number>;
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
