/**
 * Drizzle ORM Schema 定义
 *
 * 设计原则：
 * - 类型安全：所有表结构以 TypeScript 描述，CRUD 时自动推断类型
 * - 字段命名：直接使用 snake_case（与数据库列名一致），让 $inferSelect 推断出的
 *   类型天然匹配 shared/types.ts 中的 Conversation / MessageRow，无需映射层
 * - 索引与约束：高频查询字段建立索引；外键级联删除保证数据完整性
 *
 * 时间戳统一使用 INTEGER（毫秒，Date.now()）。
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ============================================================
// 会话表
// ============================================================

export const conversations = sqliteTable("conversations", {
  /** 会话 ID（前端生成的 UUID） */
  id: text("id").primaryKey(),
  /** 会话标题，默认 "新会话" */
  title: text("title").notNull().default("新会话"),
  /** 创建时间（毫秒时间戳） */
  created_at: integer("created_at").notNull(),
  /** 最后更新时间（毫秒时间戳），用于排序与展示 */
  updated_at: integer("updated_at").notNull(),
});

// ============================================================
// 消息表
// ============================================================

export const messages = sqliteTable(
  "messages",
  {
    /** 消息 ID（UIMessage.id） */
    id: text("id").primaryKey(),
    /** 所属会话 ID */
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** 角色：'user' | 'assistant' | 'system' */
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    /** UIMessage JSON 序列化后的字符串 */
    content: text("content").notNull(),
    /** 创建时间（毫秒时间戳） */
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    // 按会话查询消息的高频索引
    index("idx_messages_conv").on(table.conversation_id),
  ],
);

// ============================================================
// 应用设置表
// ============================================================

export const settings = sqliteTable("settings", {
  /** 设置项键名 */
  key: text("key").primaryKey(),
  /** 设置项值（统一以字符串存储，复杂结构用 JSON 序列化） */
  value: text("value").notNull(),
});

// ============================================================
// API Key 加密存储表
// ============================================================

export const apiKeys = sqliteTable("api_keys", {
  /** Provider 标识：'openai' | 'anthropic' | 'google' 等 */
  provider: text("provider").primaryKey(),
  /** 加密载荷 JSON（EncryptedPayload） */
  ciphertext: text("ciphertext").notNull(),
  /** 最后更新时间（毫秒时间戳） */
  updated_at: integer("updated_at").notNull(),
});

/**
 * Schema 对象聚合，作为 drizzle 实例的 schema 参数与类型推断源。
 */
export const schema = { conversations, messages, settings, apiKeys };

// ============================================================
// 类型导出（自动推断，供业务层使用）
// ============================================================

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
