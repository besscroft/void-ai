/**
 * 主进程与渲染进程共享的类型定义
 *
 * 这些类型描述了通过 IPC 在两个进程间传递的数据结构。
 * main 和 preload 都从这里 import，渲染进程通过 preload 的 d.ts 间接获取。
 */

/** 会话记录 */
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/** 消息记录（对应 DB 中的 messages 表） */
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  /** UIMessage JSON 序列化后的字符串 */
  content: string;
  created_at: number;
}

/** Provider 元信息（不含 API key） */
export interface ProviderInfo {
  id: string;
  label: string;
  models: { id: string; label?: string }[];
  helpUrl: string;
}

/** 应用设置键名枚举（避免拼写错误） */
export const SettingKey = {
  /** 主题：'light' | 'dark' | 'system' */
  Theme: "theme",
  /** 当前选中的模型引用，形如 "openai/gpt-4o" */
  SelectedModel: "selected_model",
  /** 当前会话 ID */
  ActiveConversationId: "active_conversation_id",
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];
