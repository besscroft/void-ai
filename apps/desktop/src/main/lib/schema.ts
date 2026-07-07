/**
 * Drizzle ORM Schema 定义
 *
 * 时间戳统一使用 INTEGER（毫秒，Date.now()）。
 */

import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

// ============================================================
// 会话表
// ============================================================

export const conversations = sqliteTable(
  "conversations",
  {
    /** 会话 ID（前端生成的 UUID） */
    id: text("id").primaryKey(),
    /** 会话标题，默认 "新会话" */
    title: text("title").notNull().default("新会话"),
    /** 创建时间（毫秒时间戳） */
    created_at: integer("created_at").notNull(),
    /** 最后更新时间（毫秒时间戳），用于排序与展示 */
    updated_at: integer("updated_at").notNull(),
    /** 软删除时间；null 表示仍在普通会话列表中 */
    deleted_at: integer("deleted_at"),
    /** 自动永久删除时间；删除后固定为 deleted_at + 7 天 */
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_conversations_deleted_at").on(table.deleted_at),
    index("idx_conversations_purge_after_at").on(table.purge_after_at),
  ],
);
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
  (table) => [index("idx_messages_conv").on(table.conversation_id)],
);

// ============================================================
// 智能体、记忆与工作流
// ============================================================

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    description: text("description").notNull(),
    personality: text("personality").notNull(),
    soul_prompt: text("soul_prompt").notNull(),
    avatar: text("avatar").notNull(),
    status: text("status", { enum: ["active", "draft", "archived"] })
      .notNull()
      .default("active"),
    kind: text("kind", { enum: ["main", "child"] })
      .notNull()
      .default("child"),
    parent_agent_id: text("parent_agent_id"),
    locked: integer("locked").notNull().default(0),
    tool_policy_json: text("tool_policy_json").notNull().default("{}"),
    handoff_config_json: text("handoff_config_json").notNull().default("{}"),
    runtime_config_json: text("runtime_config_json").notNull().default("{}"),
    model_ref: text("model_ref"),
    voice: text("voice"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
    index("idx_agents_kind").on(table.kind),
    index("idx_agents_parent").on(table.parent_agent_id),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    root_agent_id: text("root_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    final_agent_id: text("final_agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    model_ref: text("model_ref"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
    trace_id: text("trace_id"),
    input_summary: text("input_summary"),
    output_summary: text("output_summary"),
    error: text("error"),
    usage_json: text("usage_json"),
  },
  (table) => [
    index("idx_agent_runs_conversation").on(table.conversation_id),
    index("idx_agent_runs_root").on(table.root_agent_id),
    index("idx_agent_runs_started").on(table.started_at),
  ],
);

export const agentRuntimeState = sqliteTable(
  "agent_runtime_state",
  {
    agent_id: text("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["idle", "queued", "running", "handoff", "tool_calling", "learning", "failed"],
    })
      .notNull()
      .default("idle"),
    current_run_id: text("current_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    last_handoff_at: integer("last_handoff_at"),
    last_tool_at: integer("last_tool_at"),
    last_learning_at: integer("last_learning_at"),
    last_error: text("last_error"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_agent_runtime_status").on(table.status),
    index("idx_agent_runtime_run").on(table.current_run_id),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["global", "agent", "conversation"] }).notNull(),
    kind: text("kind", { enum: ["fact", "preference", "episode", "profile", "skill"] }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    salience: integer("salience").notNull().default(50),
    pinned: integer("pinned").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_memories_agent").on(table.agent_id),
    index("idx_memories_conversation").on(table.conversation_id),
    index("idx_memories_salience").on(table.salience),
  ],
);

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ["enabled", "paused", "draft"] })
      .notNull()
      .default("draft"),
    steps_json: text("steps_json").notNull(),
    trigger: text("trigger").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_workflows_status").on(table.status)],
);

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    input_json: text("input_json"),
    output_json: text("output_json"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
  },
  (table) => [index("idx_workflow_runs_workflow").on(table.workflow_id)],
);

export const harnessEvents = sqliteTable(
  "harness_events",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["tool", "test", "approval", "automation", "error", "agent", "handoff", "learning"],
    }).notNull(),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    detail_json: text("detail_json").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (table) => [index("idx_harness_events_created").on(table.created_at)],
);

// ============================================================
// Server、交互方式与同步状态
// ============================================================

export const serverNodes = sqliteTable(
  "server_nodes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["local", "cloud", "mcp", "sync"] }).notNull(),
    url: text("url").notNull(),
    status: text("status", { enum: ["online", "offline", "disabled"] }).notNull(),
    capabilities_json: text("capabilities_json").notNull(),
    last_seen_at: integer("last_seen_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_server_nodes_kind").on(table.kind)],
);

export const interactionProfiles = sqliteTable("interaction_profiles", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["chat", "voice", "video", "mouse", "desktop_pet"] }).notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled").notNull().default(0),
  status: text("status", { enum: ["ready", "prototype", "blocked"] }).notNull(),
  config_json: text("config_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["local_only", "manual", "cloud"] }).notNull(),
  endpoint: text("endpoint"),
  device_id: text("device_id").notNull(),
  encryption_enabled: integer("encryption_enabled").notNull().default(1),
  conflict_strategy: text("conflict_strategy", {
    enum: ["last_write_wins", "merge_with_review"],
  }).notNull(),
  status: text("status", { enum: ["idle", "syncing", "error"] }).notNull(),
  last_synced_at: integer("last_synced_at"),
  updated_at: integer("updated_at").notNull(),
});

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

export const modelApiKeys = sqliteTable(
  "model_api_keys",
  {
    provider_id: text("provider_id").notNull(),
    model_id: text("model_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider_id, table.model_id] }),
    index("idx_model_api_keys_provider").on(table.provider_id),
  ],
);

export const schema = {
  conversations,
  messages,
  agents,
  agentRuns,
  agentRuntimeState,
  memories,
  workflows,
  workflowRuns,
  harnessEvents,
  serverNodes,
  interactionProfiles,
  syncState,
  settings,
  apiKeys,
  modelApiKeys,
};

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type AgentProfile = typeof agents.$inferSelect;
export type NewAgentProfile = typeof agents.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentRuntimeState = typeof agentRuntimeState.$inferSelect;
export type NewAgentRuntimeState = typeof agentRuntimeState.$inferInsert;
export type MemoryRecord = typeof memories.$inferSelect;
export type NewMemoryRecord = typeof memories.$inferInsert;
export type WorkflowDefinition = typeof workflows.$inferSelect;
export type NewWorkflowDefinition = typeof workflows.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type HarnessEvent = typeof harnessEvents.$inferSelect;
export type ServerNode = typeof serverNodes.$inferSelect;
export type InteractionProfile = typeof interactionProfiles.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
