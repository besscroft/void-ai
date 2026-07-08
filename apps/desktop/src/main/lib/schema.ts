import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull().default("New conversation"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_conversations_deleted_at").on(table.deleted_at),
    index("idx_conversations_purge_after_at").on(table.purge_after_at),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content_json: text("content_json").notNull(),
    metadata_json: text("metadata_json").notNull().default("{}"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [index("idx_messages_conversation").on(table.conversation_id)],
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    instructions: text("instructions").notNull(),
    persona: text("persona").notNull().default(""),
    description: text("description").notNull().default(""),
    avatar: text("avatar").notNull().default("VA"),
    status: text("status", { enum: ["active", "draft", "archived"] })
      .notNull()
      .default("active"),
    kind: text("kind", { enum: ["main", "child"] })
      .notNull()
      .default("child"),
    parent_agent_id: text("parent_agent_id"),
    locked: integer("locked").notNull().default(0),
    enabled: integer("enabled").notNull().default(1),
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

export const agentPolicies = sqliteTable(
  "agent_policies",
  {
    agent_id: text("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    tool_policy_json: text("tool_policy_json").notNull().default("{}"),
    review_policy_json: text("review_policy_json").notNull().default("{}"),
    sandbox_policy_json: text("sandbox_policy_json").notNull().default("{}"),
    routing_policy_json: text("routing_policy_json").notNull().default("{}"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_agent_policies_updated").on(table.updated_at)],
);

export const runtimeRuns = sqliteTable(
  "runtime_runs",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    root_agent_id: text("root_agent_id").references(() => agents.id, { onDelete: "set null" }),
    final_agent_id: text("final_agent_id").references(() => agents.id, { onDelete: "set null" }),
    workflow_id: text("workflow_id"),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
    }).notNull(),
    model_ref: text("model_ref"),
    trace_id: text("trace_id"),
    input_summary: text("input_summary"),
    output_summary: text("output_summary"),
    error: text("error"),
    usage_json: text("usage_json"),
    metadata_json: text("metadata_json").notNull().default("{}"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_runtime_runs_conversation").on(table.conversation_id),
    index("idx_runtime_runs_root_agent").on(table.root_agent_id),
    index("idx_runtime_runs_started").on(table.started_at),
    index("idx_runtime_runs_status").on(table.status),
  ],
);

export const runtimeSteps = sqliteTable(
  "runtime_steps",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runtimeRuns.id, { onDelete: "cascade" }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    tool_id: text("tool_id"),
    kind: text("kind", {
      enum: [
        "model",
        "tool",
        "approval",
        "handoff",
        "memory",
        "workflow",
        "sandbox",
        "guardrail",
        "diagnostic",
        "error",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
    }).notNull(),
    title: text("title").notNull(),
    detail_json: text("detail_json").notNull().default("{}"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_runtime_steps_run").on(table.run_id),
    index("idx_runtime_steps_agent").on(table.agent_id),
    index("idx_runtime_steps_kind").on(table.kind),
    index("idx_runtime_steps_started").on(table.started_at),
  ],
);

export const runtimeEvents = sqliteTable(
  "runtime_events",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    step_id: text("step_id").references(() => runtimeSteps.id, { onDelete: "set null" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    tool_id: text("tool_id"),
    owner_type: text("owner_type"),
    owner_id: text("owner_id"),
    kind: text("kind", {
      enum: [
        "model",
        "tool",
        "approval",
        "handoff",
        "memory",
        "workflow",
        "sandbox",
        "guardrail",
        "diagnostic",
        "error",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
    }).notNull(),
    severity: text("severity", { enum: ["debug", "info", "warning", "error"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    detail_json: text("detail_json").notNull().default("{}"),
    duration_ms: integer("duration_ms"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_runtime_events_run").on(table.run_id),
    index("idx_runtime_events_step").on(table.step_id),
    index("idx_runtime_events_conversation").on(table.conversation_id),
    index("idx_runtime_events_agent").on(table.agent_id),
    index("idx_runtime_events_tool").on(table.tool_id),
    index("idx_runtime_events_owner").on(table.owner_type, table.owner_id),
    index("idx_runtime_events_created").on(table.created_at),
    index("idx_runtime_events_kind").on(table.kind),
  ],
);

export const toolServers = sqliteTable(
  "tool_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: ["mcp", "local", "sandbox"] })
      .notNull()
      .default("mcp"),
    transport: text("transport", { enum: ["stdio", "http", "sse", "builtin"] })
      .notNull()
      .default("stdio"),
    enabled: integer("enabled").notNull().default(1),
    auto_use: integer("auto_use").notNull().default(0),
    requires_approval: integer("requires_approval").notNull().default(1),
    status: text("status", { enum: ["ready", "disabled", "error", "unknown"] })
      .notNull()
      .default("unknown"),
    command: text("command"),
    args_json: text("args_json").notNull().default("[]"),
    url: text("url"),
    headers_json: text("headers_json").notNull().default("{}"),
    env_json: text("env_json").notNull().default("{}"),
    cwd: text("cwd"),
    timeout_seconds: integer("timeout_seconds").notNull().default(60),
    last_error: text("last_error"),
    last_connected_at: integer("last_connected_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_tool_servers_kind").on(table.kind),
    index("idx_tool_servers_enabled").on(table.enabled),
    index("idx_tool_servers_status").on(table.status),
    index("idx_tool_servers_deleted_at").on(table.deleted_at),
    index("idx_tool_servers_purge_after_at").on(table.purge_after_at),
  ],
);

export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    server_id: text("server_id").references(() => toolServers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: ["builtin", "mcp", "skill", "sandbox"] }).notNull(),
    category: text("category").notNull().default("general"),
    reference: text("reference").notNull(),
    enabled: integer("enabled").notNull().default(1),
    auto_use: integer("auto_use").notNull().default(0),
    requires_approval: integer("requires_approval").notNull().default(1),
    input_schema_json: text("input_schema_json").notNull().default("{}"),
    output_schema_json: text("output_schema_json").notNull().default("{}"),
    config_json: text("config_json").notNull().default("{}"),
    steps_json: text("steps_json").notNull().default("[]"),
    workflow_id: text("workflow_id"),
    trigger_keywords_json: text("trigger_keywords_json").notNull().default("[]"),
    tags_json: text("tags_json").notNull().default("[]"),
    discovered_at: integer("discovered_at").notNull(),
    last_run_at: integer("last_run_at"),
    updated_at: integer("updated_at").notNull(),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_tools_server").on(table.server_id),
    index("idx_tools_kind").on(table.kind),
    index("idx_tools_reference").on(table.reference),
    index("idx_tools_enabled").on(table.enabled),
    index("idx_tools_deleted_at").on(table.deleted_at),
    index("idx_tools_purge_after_at").on(table.purge_after_at),
  ],
);

export const toolSecrets = sqliteTable(
  "tool_secrets",
  {
    id: text("id").primaryKey(),
    owner_type: text("owner_type", { enum: ["server", "tool"] }).notNull(),
    owner_id: text("owner_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_tool_secrets_owner").on(table.owner_type, table.owner_id),
    index("idx_tool_secrets_key").on(table.key),
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
    steps_json: text("steps_json").notNull().default("[]"),
    trigger: text("trigger").notNull().default("manual"),
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
    runtime_run_id: text("runtime_run_id").references(() => runtimeRuns.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
    }).notNull(),
    input_json: text("input_json"),
    output_json: text("output_json"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
  },
  (table) => [
    index("idx_workflow_runs_workflow").on(table.workflow_id),
    index("idx_workflow_runs_runtime").on(table.runtime_run_id),
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
    source_run_id: text("source_run_id").references(() => runtimeRuns.id, {
      onDelete: "set null",
    }),
    salience: integer("salience").notNull().default(50),
    pinned: integer("pinned").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_memories_agent").on(table.agent_id),
    index("idx_memories_conversation").on(table.conversation_id),
    index("idx_memories_source_run").on(table.source_run_id),
    index("idx_memories_salience").on(table.salience),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const modelProviders = sqliteTable("model_providers", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["openai", "openai-compatible", "anthropic", "google"] }).notNull(),
  source: text("source", { enum: ["builtin", "custom"] })
    .notNull()
    .default("custom"),
  base_url: text("base_url"),
  help_url: text("help_url").notNull().default(""),
  config_json: text("config_json").notNull().default("{}"),
  created_at: integer("created_at").notNull(),
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

export const apiKeys = sqliteTable("api_keys", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const interactionProfiles = sqliteTable("interaction_profiles", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["chat", "voice", "video", "mouse", "desktop_pet"] }).notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled").notNull().default(0),
  status: text("status", { enum: ["ready", "prototype", "blocked"] }).notNull(),
  config_json: text("config_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const syncProfiles = sqliteTable("sync_profiles", {
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

export const sandboxSessions = sqliteTable(
  "sandbox_sessions",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    root_path: text("root_path").notNull(),
    isolation_mode: text("isolation_mode", { enum: ["docker", "local"] }).notNull(),
    status: text("status", { enum: ["active", "stopped", "failed"] }).notNull(),
    docker_available: integer("docker_available").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_sandbox_sessions_conversation").on(table.conversation_id),
    index("idx_sandbox_sessions_run").on(table.run_id),
    index("idx_sandbox_sessions_updated").on(table.updated_at),
  ],
);

export const sandboxSnapshots = sqliteTable(
  "sandbox_snapshots",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sandboxSessions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    manifest_json: text("manifest_json").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_sandbox_snapshots_session").on(table.session_id),
    index("idx_sandbox_snapshots_created").on(table.created_at),
  ],
);

export const sandboxArtifacts = sqliteTable(
  "sandbox_artifacts",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sandboxSessions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["file", "directory", "preview"] }).notNull(),
    path: text("path").notNull(),
    url: text("url"),
    size_bytes: integer("size_bytes"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_sandbox_artifacts_session").on(table.session_id),
    index("idx_sandbox_artifacts_created").on(table.created_at),
  ],
);

export const schema = {
  conversations,
  messages,
  agents,
  agentPolicies,
  runtimeRuns,
  runtimeSteps,
  runtimeEvents,
  toolServers,
  tools,
  toolSecrets,
  workflows,
  workflowRuns,
  memories,
  settings,
  modelProviders,
  modelApiKeys,
  apiKeys,
  interactionProfiles,
  syncProfiles,
  sandboxSessions,
  sandboxSnapshots,
  sandboxArtifacts,
};

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type AgentProfile = typeof agents.$inferSelect;
export type NewAgentProfile = typeof agents.$inferInsert;
export type AgentPolicy = typeof agentPolicies.$inferSelect;
export type NewAgentPolicy = typeof agentPolicies.$inferInsert;
export type RuntimeRun = typeof runtimeRuns.$inferSelect;
export type NewRuntimeRun = typeof runtimeRuns.$inferInsert;
export type RuntimeStep = typeof runtimeSteps.$inferSelect;
export type NewRuntimeStep = typeof runtimeSteps.$inferInsert;
export type RuntimeEvent = typeof runtimeEvents.$inferSelect;
export type NewRuntimeEvent = typeof runtimeEvents.$inferInsert;
export type ToolServer = typeof toolServers.$inferSelect;
export type NewToolServer = typeof toolServers.$inferInsert;
export type ToolRecord = typeof tools.$inferSelect;
export type NewToolRecord = typeof tools.$inferInsert;
export type ToolSecret = typeof toolSecrets.$inferSelect;
export type NewToolSecret = typeof toolSecrets.$inferInsert;
export type MemoryRecord = typeof memories.$inferSelect;
export type NewMemoryRecord = typeof memories.$inferInsert;
export type WorkflowDefinition = typeof workflows.$inferSelect;
export type NewWorkflowDefinition = typeof workflows.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type InteractionProfile = typeof interactionProfiles.$inferSelect;
export type SyncProfile = typeof syncProfiles.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ModelApiKey = typeof modelApiKeys.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type SandboxSession = typeof sandboxSessions.$inferSelect;
export type NewSandboxSession = typeof sandboxSessions.$inferInsert;
export type SandboxSnapshot = typeof sandboxSnapshots.$inferSelect;
export type NewSandboxSnapshot = typeof sandboxSnapshots.$inferInsert;
export type SandboxArtifact = typeof sandboxArtifacts.$inferSelect;
export type NewSandboxArtifact = typeof sandboxArtifacts.$inferInsert;
