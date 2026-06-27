import type { Conversation, MessageRow, ProviderInfo } from "@shared/types";

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
    get: (id: string): Promise<Conversation | null> => assertApi().conversations.get(id),
    create: (id: string, title?: string): Promise<Conversation> =>
      assertApi().conversations.create(id, title),
    delete: (id: string): Promise<boolean> => assertApi().conversations.delete(id),
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
  providers: {
    list: (): Promise<ProviderInfo[]> => assertApi().providers.list(),
  },
  server: {
    port: (): Promise<number> => assertApi().server.port(),
  },
};

export type { Conversation, MessageRow, ProviderInfo };
