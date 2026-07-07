/**
 * 数据库访问层（Drizzle ORM + better-sqlite3）
 *
 * 设计要点：
 * - 运行时数据库文件位于 `app.getPath('userData')/data/void-ai.db`，符合各平台规范
 * - 启用 WAL / foreign_keys / busy_timeout 提升并发与数据完整性
 * - schema 由 drizzle-kit 生成迁移文件，运行时 migrate() 自动应用
 * - 所有导出函数签名与旧版（node:sqlite 版）保持一致，IPC/renderer 无需改动
 *
 * 错误处理策略：
 * - 可恢复错误（如 API key 解密失败）就近返回 null 并记录日志
 * - 不可恢复错误（DB 未初始化、SQL 失败）由上层捕获，drizzle 自身会抛出
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq, desc, asc, and, isNull, isNotNull, lt } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { encrypt, decrypt, type EncryptedPayload } from "./crypto";
import {
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  DEFAULT_AGENT_ID as SHARED_DEFAULT_AGENT_ID,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  type AgentInput,
  type AgentHandoffConfig,
  type AgentRuntimeConfig,
  type AgentRuntimeStatus,
  type AgentToolPolicy,
} from "../../shared/types";
import {
  schema,
  conversations,
  messages,
  settings,
  apiKeys,
  modelApiKeys,
  agents,
  agentRuns,
  agentRuntimeState,
  agentRunSteps,
  conversationAgentState,
  memories,
  workflows,
  workflowRuns,
  harnessEvents,
  sandboxSessions,
  sandboxSnapshots,
  sandboxArtifacts,
  serverNodes,
  interactionProfiles,
  syncState,
  type Conversation,
  type MessageRow,
  type AgentProfile,
  type AgentRun,
  type NewAgentRun,
  type AgentRuntimeState,
  type AgentRunStep,
  type NewAgentRunStep,
  type ConversationAgentState,
  type MemoryRecord,
  type WorkflowDefinition,
  type WorkflowRun,
  type HarnessEvent,
  type SandboxSession,
  type NewSandboxSession,
  type SandboxSnapshot,
  type NewSandboxSnapshot,
  type SandboxArtifact,
  type NewSandboxArtifact,
  type ServerNode,
  type InteractionProfile,
  type SyncState,
} from "./schema";

export type {
  Conversation,
  MessageRow,
  AgentProfile,
  AgentRun,
  AgentRuntimeState,
  AgentRunStep,
  ConversationAgentState,
  MemoryRecord,
  WorkflowDefinition,
  WorkflowRun,
  HarnessEvent,
  SandboxSession,
  SandboxSnapshot,
  SandboxArtifact,
  ServerNode,
  InteractionProfile,
  SyncState,
};
/** 数据库文件名 */
const DB_FILENAME = "void-ai.db";
/** 数据目录名（位于 userData 下） */
const DATA_DIRNAME = "data";
const DEFAULT_AGENT_ID = SHARED_DEFAULT_AGENT_ID;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** drizzle 实例类型（基于 schema 推断，保证类型安全的查询/插入/更新） */
type DbInstance = BetterSQLite3Database<typeof schema>;

let rawDb: Database.Database | null = null;
let dbInstance: DbInstance | null = null;

/**
 * 解析数据目录路径，并在首次调用时创建。
 * 路径：app.getPath('userData')/data
 */
function resolveDataDir(): string {
  const userDataDir = process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData");
  const dir = join(userDataDir, DATA_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 解析迁移文件目录路径。
 * - dev：apps/desktop/drizzle（源码目录，drizzle-kit 生成产物落地处）
 * - prod：process.resourcesPath/drizzle（由 electron-builder extraResources 复制）
 */
function resolveMigrationsFolder(): string {
  if (is.dev) {
    // dev 下 __dirname = apps/desktop/out/main
    // 上溯两级到 apps/desktop，再进入 drizzle 目录
    const candidates = [
      join(__dirname, "..", "..", "drizzle"),
      join(__dirname, "..", "..", "..", "drizzle"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  }
  return join(process.resourcesPath, "drizzle");
}

/**
 * 初始化数据库并应用迁移。
 * 必须在 app ready 之后调用。
 */
export function initDb(): DbInstance {
  if (dbInstance) return dbInstance;

  const dataDir = resolveDataDir();
  const dbPath = join(dataDir, DB_FILENAME);
  console.log("[db] 数据库路径:", dbPath);

  rawDb = new Database(dbPath);
  // SQLite 优化项：WAL 提升并发；foreign_keys 保证级联；busy_timeout 避免短时锁冲突
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.pragma("busy_timeout = 5000");

  dbInstance = drizzle(rawDb, { schema });

  // 应用迁移文件
  const migrationsFolder = resolveMigrationsFolder();
  console.log("[db] 迁移目录:", migrationsFolder);
  try {
    migrate(dbInstance, { migrationsFolder });
    purgeExpiredDeletedConversations();
    seedWorkspaceDefaults();
    console.log("[db] 迁移应用完成");
  } catch (err) {
    // 迁移失败属于不可恢复错误，关闭资源后向上抛出
    rawDb.close();
    rawDb = null;
    dbInstance = null;
    throw err;
  }

  return dbInstance;
}

/** 获取已初始化的 drizzle 实例 */
export function getDb(): DbInstance {
  if (!dbInstance) throw new Error("数据库未初始化，请先调用 initDb()");
  return dbInstance;
}

/** 关闭数据库连接（应用退出时调用） */
export function closeDb(): void {
  if (rawDb) {
    rawDb.close();
    rawDb = null;
    dbInstance = null;
  }
}

// ============================================================
// 会话历史
// ============================================================

/** 创建新会话 */
export function createConversation(id: string, title = "新会话"): Conversation {
  const now = Date.now();
  const row: Conversation = {
    id,
    title,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
  getDb().insert(conversations).values(row).run();
  return row;
}

/** 列出普通会话（按更新时间倒序，不包含回收站） */
export function listConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNull(conversations.deleted_at))
    .orderBy(desc(conversations.updated_at))
    .all();
}

/** 列出回收站会话（按删除时间倒序） */
export function listDeletedConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNotNull(conversations.deleted_at))
    .orderBy(desc(conversations.deleted_at))
    .all();
}

/** 获取单个普通会话 */
export function getConversation(id: string): Conversation | null {
  return (
    getDb()
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), isNull(conversations.deleted_at)))
      .get() ?? null
  );
}

/** 更新会话标题/时间戳 */
export function touchConversation(id: string, title?: string): void {
  const now = Date.now();
  const db = getDb();
  const where = and(eq(conversations.id, id), isNull(conversations.deleted_at));
  if (title) {
    db.update(conversations).set({ title, updated_at: now }).where(where).run();
  } else {
    db.update(conversations).set({ updated_at: now }).where(where).run();
  }
}

/** 软删除会话：移入回收站，7 天后自动永久删除 */
export function deleteConversation(id: string): void {
  const now = Date.now();
  getDb()
    .update(conversations)
    .set({ deleted_at: now, purge_after_at: now + TRASH_RETENTION_MS, updated_at: now })
    .where(and(eq(conversations.id, id), isNull(conversations.deleted_at)))
    .run();
}

/** 从回收站恢复会话 */
export function restoreConversation(id: string): void {
  const now = Date.now();
  getDb()
    .update(conversations)
    .set({ deleted_at: null, purge_after_at: null, updated_at: now })
    .where(eq(conversations.id, id))
    .run();
}

/** 永久删除会话及其所有消息（外键级联） */
export function permanentlyDeleteConversation(id: string): void {
  getDb().delete(conversations).where(eq(conversations.id, id)).run();
}

/**
 * 批量永久删除多个会话（事务）。
 * 入参为 id 列表，返回实际删除的行数；空数组直接返回 0。
 */
export function permanentlyDeleteConversations(ids: string[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  return db.transaction((tx) => {
    let changes = 0;
    for (const id of ids) {
      changes += tx.delete(conversations).where(eq(conversations.id, id)).run().changes;
    }
    return changes;
  });
}

/** 永久删除已超过回收站保留期的会话 */
export function purgeExpiredDeletedConversations(now = Date.now()): number {
  return getDb()
    .delete(conversations)
    .where(and(isNotNull(conversations.deleted_at), lt(conversations.purge_after_at, now)))
    .run().changes;
}
/** 保存一条消息（已存在则更新） */
export function saveMessage(msg: MessageRow): void {
  getDb()
    .insert(messages)
    .values({
      id: msg.id,
      conversation_id: msg.conversation_id,
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at,
    })
    .onConflictDoUpdate({
      target: messages.id,
      set: {
        content: msg.content,
        role: msg.role,
        created_at: msg.created_at,
      },
    })
    .run();
}

/** 批量保存消息，使用事务保证原子性 */
export function saveMessagesBatch(msgs: MessageRow[]): void {
  if (!msgs.length) return;
  const db = getDb();
  db.transaction((tx) => {
    for (const msg of msgs) {
      tx.insert(messages)
        .values({
          id: msg.id,
          conversation_id: msg.conversation_id,
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at,
        })
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            content: msg.content,
            role: msg.role,
            created_at: msg.created_at,
          },
        })
        .run();
    }
  });
}

/** 获取会话的所有消息（按时间升序） */
export function listMessages(conversationId: string): MessageRow[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(asc(messages.created_at))
    .all();
}

// ============================================================
// 设置
// ============================================================

export function getSetting(key: string): string | null {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
}

// ============================================================
// API Key 加密存储
// ============================================================

/**
 * 保存指定 provider 的 API key（加密存储）
 */
export function setApiKey(provider: string, apiKey: string): void {
  const payload = encrypt(apiKey);
  const now = Date.now();
  getDb()
    .insert(apiKeys)
    .values({
      provider,
      ciphertext: JSON.stringify(payload),
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: apiKeys.provider,
      set: {
        ciphertext: JSON.stringify(payload),
        updated_at: now,
      },
    })
    .run();
}

/**
 * 读取指定 provider 的 API key（解密）
 * @returns 解密后的明文 key；若未存储或解密失败则返回 null
 */
export function getApiKey(provider: string): string | null {
  const row = getDb().select().from(apiKeys).where(eq(apiKeys.provider, provider)).get();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.ciphertext) as EncryptedPayload;
    return decrypt(payload);
  } catch (err) {
    // 解密失败属于可恢复错误：记录日志并返回 null，让上层走"未配置"分支
    console.error(`[db] 解密 ${provider} 的 API key 失败:`, err);
    return null;
  }
}

/** 删除指定 provider 的 API key */
export function deleteApiKey(provider: string): void {
  getDb().delete(apiKeys).where(eq(apiKeys.provider, provider)).run();
}

/** 列出已配置 API key 的 provider 列表（不返回明文） */
export function listApiKeyProviders(): string[] {
  const rows = getDb().select({ provider: apiKeys.provider }).from(apiKeys).all();
  return rows.map((r) => r.provider);
}

// ============================================================
// Model API Key encrypted storage
// ============================================================

export function setModelApiKey(providerId: string, modelId: string, apiKey: string): void {
  const payload = encrypt(apiKey);
  const now = Date.now();
  getDb()
    .insert(modelApiKeys)
    .values({
      provider_id: providerId,
      model_id: modelId,
      ciphertext: JSON.stringify(payload),
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [modelApiKeys.provider_id, modelApiKeys.model_id],
      set: {
        ciphertext: JSON.stringify(payload),
        updated_at: now,
      },
    })
    .run();
}

export function getModelApiKey(providerId: string, modelId: string): string | null {
  const row = getDb()
    .select()
    .from(modelApiKeys)
    .where(and(eq(modelApiKeys.provider_id, providerId), eq(modelApiKeys.model_id, modelId)))
    .get();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.ciphertext) as EncryptedPayload;
    return decrypt(payload);
  } catch (err) {
    console.error("[db] Failed to decrypt API key for " + providerId + "/" + modelId + ":", err);
    return null;
  }
}

export function deleteModelApiKey(providerId: string, modelId: string): void {
  getDb()
    .delete(modelApiKeys)
    .where(and(eq(modelApiKeys.provider_id, providerId), eq(modelApiKeys.model_id, modelId)))
    .run();
}

export function deleteModelApiKeysForProvider(providerId: string): void {
  getDb().delete(modelApiKeys).where(eq(modelApiKeys.provider_id, providerId)).run();
}

export function listModelApiKeyRefs(): string[] {
  const rows = getDb()
    .select({ providerId: modelApiKeys.provider_id, modelId: modelApiKeys.model_id })
    .from(modelApiKeys)
    .all();
  return rows.map((row) => row.providerId + "/" + row.modelId);
}

// ============================================================
// 工作台数据：Agents / Memory / Workflows / Harness / Server / Sync
// ============================================================

export function listAgents(): AgentProfile[] {
  return getDb().select().from(agents).orderBy(desc(agents.updated_at)).all();
}

export function getAgent(id: string): AgentProfile | null {
  return getDb().select().from(agents).where(eq(agents.id, id)).get() ?? null;
}

export function createAgent(input: AgentInput): AgentProfile {
  const now = Date.now();
  const row = normalizeAgentInput({
    id: randomUUID(),
    input,
    existing: null,
    now,
  });
  getDb().insert(agents).values(row).run();
  ensureAgentRuntimeState(row.id, "idle");
  insertHarnessEvent({
    kind: "agent",
    title: "Child agent created: " + row.name,
    status: "succeeded",
    detail: { agentId: row.id, mode: parseAgentHandoffConfig(row).mode },
  });
  return row;
}

export function updateAgent(id: string, input: Partial<AgentInput>): AgentProfile {
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found: " + id);
  assertAgentEditable(existing);
  const now = Date.now();
  const next = normalizeAgentInput({
    id,
    input: { ...existing, ...input },
    existing,
    now,
  });
  getDb()
    .update(agents)
    .set({
      name: next.name,
      role: next.role,
      description: next.description,
      personality: next.personality,
      soul_prompt: next.soul_prompt,
      avatar: next.avatar,
      status: next.status,
      kind: next.kind,
      parent_agent_id: next.parent_agent_id,
      locked: next.locked,
      enabled: next.enabled,
      tool_policy_json: next.tool_policy_json,
      handoff_config_json: next.handoff_config_json,
      runtime_config_json: next.runtime_config_json,
      model_ref: next.model_ref,
      voice: next.voice,
      updated_at: now,
    })
    .where(eq(agents.id, id))
    .run();
  insertHarnessEvent({
    kind: "agent",
    title: "Child agent updated: " + next.name,
    status: "succeeded",
    detail: { agentId: next.id, status: next.status },
  });
  return getAgent(id) ?? next;
}

export function saveAgent(agent: AgentProfile): void {
  const existing = getAgent(agent.id);
  if (existing) {
    updateAgent(agent.id, agent);
    return;
  }
  if (agent.id === DEFAULT_AGENT_ID || agent.kind === "main" || agent.locked) {
    throw new Error("Void is managed internally and cannot be created through this API.");
  }
  const now = Date.now();
  const row = normalizeAgentInput({ id: agent.id, input: agent, existing: null, now });
  getDb().insert(agents).values(row).run();
  ensureAgentRuntimeState(row.id, "idle");
}

export function archiveAgent(id: string): AgentProfile {
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found: " + id);
  assertAgentEditable(existing);
  getDb()
    .update(agents)
    .set({ status: "archived", updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  upsertAgentRuntimeState({ agent_id: id, status: "idle", current_run_id: null });
  insertHarnessEvent({
    kind: "agent",
    title: "Child agent archived: " + existing.name,
    status: "succeeded",
    detail: { agentId: id },
  });
  return getAgent(id) ?? { ...existing, status: "archived" };
}

export function restoreAgent(id: string): AgentProfile {
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found: " + id);
  assertAgentEditable(existing);
  getDb()
    .update(agents)
    .set({ status: "active", updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  ensureAgentRuntimeState(id, "idle");
  insertHarnessEvent({
    kind: "agent",
    title: "Child agent restored: " + existing.name,
    status: "succeeded",
    detail: { agentId: id },
  });
  return getAgent(id) ?? { ...existing, status: "active" };
}

export function duplicateAgent(id: string): AgentProfile {
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found: " + id);
  if (existing.kind === "main" || existing.locked) {
    throw new Error("Void cannot be duplicated.");
  }
  const copy = createAgent({
    name: existing.name + " Copy",
    role: existing.role,
    description: existing.description,
    personality: existing.personality,
    soul_prompt: existing.soul_prompt,
    avatar: existing.avatar,
    status: existing.status === "archived" ? "draft" : existing.status,
    enabled: existing.enabled,
    model_ref: existing.model_ref,
    voice: existing.voice,
    tool_policy_json: existing.tool_policy_json,
    handoff_config_json: existing.handoff_config_json,
    runtime_config_json: existing.runtime_config_json,
  });
  insertHarnessEvent({
    kind: "agent",
    title: "Child agent duplicated: " + existing.name,
    status: "succeeded",
    detail: { sourceAgentId: id, agentId: copy.id },
  });
  return copy;
}

export function listAgentRuns(limit = 50): AgentRun[] {
  return getDb().select().from(agentRuns).orderBy(desc(agentRuns.started_at)).limit(limit).all();
}

export function listAgentRunSteps(limit = 200): AgentRunStep[] {
  return getDb()
    .select()
    .from(agentRunSteps)
    .orderBy(desc(agentRunSteps.started_at))
    .limit(limit)
    .all();
}

export function createAgentRun(
  input: Omit<NewAgentRun, "id" | "started_at"> & {
    id?: string;
    started_at?: number;
  },
): AgentRun {
  const row: NewAgentRun = {
    id: input.id ?? randomUUID(),
    conversation_id: input.conversation_id ?? null,
    root_agent_id: input.root_agent_id,
    final_agent_id: input.final_agent_id ?? null,
    status: input.status,
    model_ref: input.model_ref ?? null,
    started_at: input.started_at ?? Date.now(),
    finished_at: input.finished_at ?? null,
    trace_id: input.trace_id ?? null,
    input_summary: input.input_summary ?? null,
    output_summary: input.output_summary ?? null,
    error: input.error ?? null,
    usage_json: input.usage_json ?? null,
  };
  getDb().insert(agentRuns).values(row).run();
  return row as AgentRun;
}

export function updateAgentRun(
  id: string,
  patch: Partial<Omit<AgentRun, "id" | "started_at">>,
): AgentRun | null {
  const existing = getDb().select().from(agentRuns).where(eq(agentRuns.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(agentRuns)
    .set({
      final_agent_id: patch.final_agent_id ?? existing.final_agent_id,
      status: patch.status ?? existing.status,
      model_ref: patch.model_ref ?? existing.model_ref,
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      trace_id: patch.trace_id === undefined ? existing.trace_id : patch.trace_id,
      input_summary:
        patch.input_summary === undefined ? existing.input_summary : patch.input_summary,
      output_summary:
        patch.output_summary === undefined ? existing.output_summary : patch.output_summary,
      error: patch.error === undefined ? existing.error : patch.error,
      usage_json: patch.usage_json === undefined ? existing.usage_json : patch.usage_json,
    })
    .where(eq(agentRuns.id, id))
    .run();
  return getDb().select().from(agentRuns).where(eq(agentRuns.id, id)).get() ?? null;
}

export function createAgentRunStep(
  input: Omit<NewAgentRunStep, "id" | "started_at" | "detail_json"> & {
    id?: string;
    started_at?: number;
    detail?: unknown;
    detail_json?: string;
  },
): AgentRunStep {
  const row: NewAgentRunStep = {
    id: input.id ?? randomUUID(),
    run_id: input.run_id,
    agent_id: input.agent_id ?? null,
    kind: input.kind,
    status: input.status,
    title: input.title,
    detail_json: input.detail_json ?? JSON.stringify(sanitizeHarnessDetail(input.detail ?? {})),
    started_at: input.started_at ?? Date.now(),
    finished_at: input.finished_at ?? null,
    error: input.error ?? null,
  };
  getDb().insert(agentRunSteps).values(row).run();
  return row as AgentRunStep;
}

export function updateAgentRunStep(
  id: string,
  patch: Partial<Omit<AgentRunStep, "id" | "run_id" | "started_at">> & { detail?: unknown },
): AgentRunStep | null {
  const existing = getDb().select().from(agentRunSteps).where(eq(agentRunSteps.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(agentRunSteps)
    .set({
      agent_id: patch.agent_id === undefined ? existing.agent_id : patch.agent_id,
      kind: patch.kind ?? existing.kind,
      status: patch.status ?? existing.status,
      title: patch.title ?? existing.title,
      detail_json:
        patch.detail !== undefined
          ? JSON.stringify(sanitizeHarnessDetail(patch.detail))
          : (patch.detail_json ?? existing.detail_json),
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      error: patch.error === undefined ? existing.error : patch.error,
    })
    .where(eq(agentRunSteps.id, id))
    .run();
  return getDb().select().from(agentRunSteps).where(eq(agentRunSteps.id, id)).get() ?? null;
}

export function listAgentRuntimeStates(): AgentRuntimeState[] {
  ensureAllAgentRuntimeStates();
  return getDb().select().from(agentRuntimeState).orderBy(desc(agentRuntimeState.updated_at)).all();
}

export function upsertAgentRuntimeState(
  patch: Partial<AgentRuntimeState> & { agent_id: string; status?: AgentRuntimeStatus },
): AgentRuntimeState {
  const now = Date.now();
  const existing = getDb()
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.agent_id, patch.agent_id))
    .get();
  const row: AgentRuntimeState = {
    agent_id: patch.agent_id,
    status: patch.status ?? existing?.status ?? "idle",
    current_run_id:
      patch.current_run_id === undefined
        ? (existing?.current_run_id ?? null)
        : patch.current_run_id,
    last_handoff_at:
      patch.last_handoff_at === undefined
        ? (existing?.last_handoff_at ?? null)
        : patch.last_handoff_at,
    last_tool_at:
      patch.last_tool_at === undefined ? (existing?.last_tool_at ?? null) : patch.last_tool_at,
    last_learning_at:
      patch.last_learning_at === undefined
        ? (existing?.last_learning_at ?? null)
        : patch.last_learning_at,
    last_error: patch.last_error === undefined ? (existing?.last_error ?? null) : patch.last_error,
    updated_at: now,
  };
  getDb()
    .insert(agentRuntimeState)
    .values(row)
    .onConflictDoUpdate({
      target: agentRuntimeState.agent_id,
      set: {
        status: row.status,
        current_run_id: row.current_run_id,
        last_handoff_at: row.last_handoff_at,
        last_tool_at: row.last_tool_at,
        last_learning_at: row.last_learning_at,
        last_error: row.last_error,
        updated_at: now,
      },
    })
    .run();
  return row;
}

export function runtimeSnapshot(): {
  agentRuns: AgentRun[];
  agentRunSteps: AgentRunStep[];
  agentRuntimeStates: AgentRuntimeState[];
  conversationAgentStates: ConversationAgentState[];
  sandboxSessions: SandboxSession[];
  sandboxSnapshots: SandboxSnapshot[];
  sandboxArtifacts: SandboxArtifact[];
} {
  return {
    agentRuns: listAgentRuns(),
    agentRunSteps: listAgentRunSteps(),
    agentRuntimeStates: listAgentRuntimeStates(),
    conversationAgentStates: listConversationAgentStates(),
    sandboxSessions: listSandboxSessions(),
    sandboxSnapshots: listSandboxSnapshots(),
    sandboxArtifacts: listSandboxArtifacts(),
  };
}

export function listConversationAgentStates(): ConversationAgentState[] {
  return getDb()
    .select()
    .from(conversationAgentState)
    .orderBy(desc(conversationAgentState.updated_at))
    .all();
}

export function upsertConversationAgentState(
  patch: Partial<ConversationAgentState> & { conversation_id: string },
): ConversationAgentState {
  const now = Date.now();
  const existing = getDb()
    .select()
    .from(conversationAgentState)
    .where(eq(conversationAgentState.conversation_id, patch.conversation_id))
    .get();
  const row: ConversationAgentState = {
    conversation_id: patch.conversation_id,
    active_agent_id:
      patch.active_agent_id === undefined
        ? (existing?.active_agent_id ?? null)
        : patch.active_agent_id,
    current_run_id:
      patch.current_run_id === undefined
        ? (existing?.current_run_id ?? null)
        : patch.current_run_id,
    current_step_id:
      patch.current_step_id === undefined
        ? (existing?.current_step_id ?? null)
        : patch.current_step_id,
    status: patch.status ?? existing?.status ?? "idle",
    summary: patch.summary === undefined ? (existing?.summary ?? null) : patch.summary,
    updated_at: now,
  };
  getDb()
    .insert(conversationAgentState)
    .values(row)
    .onConflictDoUpdate({
      target: conversationAgentState.conversation_id,
      set: {
        active_agent_id: row.active_agent_id,
        current_run_id: row.current_run_id,
        current_step_id: row.current_step_id,
        status: row.status,
        summary: row.summary,
        updated_at: now,
      },
    })
    .run();
  return row;
}

export function listSandboxSessions(limit = 50): SandboxSession[] {
  return getDb()
    .select()
    .from(sandboxSessions)
    .orderBy(desc(sandboxSessions.updated_at))
    .limit(limit)
    .all();
}

export function upsertSandboxSession(input: NewSandboxSession): SandboxSession {
  const row: NewSandboxSession = {
    ...input,
    docker_available: input.docker_available ?? 0,
    created_at: input.created_at ?? Date.now(),
    updated_at: input.updated_at ?? Date.now(),
  };
  getDb()
    .insert(sandboxSessions)
    .values(row)
    .onConflictDoUpdate({
      target: sandboxSessions.id,
      set: {
        conversation_id: row.conversation_id ?? null,
        run_id: row.run_id ?? null,
        agent_id: row.agent_id ?? null,
        root_path: row.root_path,
        isolation_mode: row.isolation_mode,
        status: row.status,
        docker_available: row.docker_available,
        updated_at: row.updated_at,
      },
    })
    .run();
  return getDb().select().from(sandboxSessions).where(eq(sandboxSessions.id, row.id)).get()!;
}

export function listSandboxSnapshots(limit = 100): SandboxSnapshot[] {
  return getDb()
    .select()
    .from(sandboxSnapshots)
    .orderBy(desc(sandboxSnapshots.created_at))
    .limit(limit)
    .all();
}

export function insertSandboxSnapshot(
  input: Omit<NewSandboxSnapshot, "id" | "created_at"> & {
    id?: string;
    created_at?: number;
  },
): SandboxSnapshot {
  const row: NewSandboxSnapshot = {
    id: input.id ?? randomUUID(),
    session_id: input.session_id,
    label: input.label,
    manifest_json: input.manifest_json,
    created_at: input.created_at ?? Date.now(),
  };
  getDb().insert(sandboxSnapshots).values(row).run();
  return row as SandboxSnapshot;
}

export function getSandboxSnapshot(id: string): SandboxSnapshot | null {
  return getDb().select().from(sandboxSnapshots).where(eq(sandboxSnapshots.id, id)).get() ?? null;
}

export function listSandboxArtifacts(limit = 100): SandboxArtifact[] {
  return getDb()
    .select()
    .from(sandboxArtifacts)
    .orderBy(desc(sandboxArtifacts.created_at))
    .limit(limit)
    .all();
}

export function insertSandboxArtifact(
  input: Omit<NewSandboxArtifact, "id" | "created_at"> & {
    id?: string;
    created_at?: number;
  },
): SandboxArtifact {
  const row: NewSandboxArtifact = {
    id: input.id ?? randomUUID(),
    session_id: input.session_id,
    kind: input.kind,
    path: input.path,
    url: input.url ?? null,
    size_bytes: input.size_bytes ?? null,
    created_at: input.created_at ?? Date.now(),
  };
  getDb().insert(sandboxArtifacts).values(row).run();
  return row as SandboxArtifact;
}

export function updateVoidLearningState(input: {
  status: AgentRuntimeStatus;
  lastLearningAt?: number | null;
  lastError?: string | null;
  soulPromptAppend?: string;
}): void {
  upsertAgentRuntimeState({
    agent_id: DEFAULT_AGENT_ID,
    status: input.status,
    last_learning_at: input.lastLearningAt ?? (input.status === "learning" ? null : Date.now()),
    last_error: input.lastError ?? null,
  });
  if (!input.soulPromptAppend?.trim()) return;
  const voidAgent = getAgent(DEFAULT_AGENT_ID);
  if (!voidAgent) return;
  const addition = input.soulPromptAppend.trim();
  const current = voidAgent.soul_prompt.trim();
  const marker = "\n\nLearning notes:\n";
  const nextPrompt = truncateText(
    current.includes(addition) ? current : current + marker + "- " + addition,
    4_000,
  );
  getDb()
    .update(agents)
    .set({ soul_prompt: nextPrompt, updated_at: Date.now() })
    .where(eq(agents.id, DEFAULT_AGENT_ID))
    .run();
}

function normalizeAgentInput({
  id,
  input,
  existing,
  now,
}: {
  id: string;
  input: Partial<AgentInput> & {
    name?: string;
    role?: string;
    description?: string;
    personality?: string;
    soul_prompt?: string;
    avatar?: string;
  };
  existing: AgentProfile | null;
  now: number;
}): AgentProfile {
  const name = normalizeRequiredText(input.name ?? existing?.name, "Agent name", 80);
  return {
    id,
    name,
    role: normalizeRequiredText(input.role ?? existing?.role, "Agent role", 160),
    description: normalizeRequiredText(
      input.description ?? existing?.description,
      "Agent description",
      1_000,
    ),
    personality: normalizeRequiredText(
      input.personality ?? existing?.personality,
      "Agent personality",
      1_000,
    ),
    soul_prompt: normalizeRequiredText(
      input.soul_prompt ?? existing?.soul_prompt,
      "Agent soul prompt",
      4_000,
    ),
    avatar: normalizeAvatar(input.avatar ?? existing?.avatar ?? name),
    status: input.status ?? existing?.status ?? "draft",
    kind: "child",
    parent_agent_id: DEFAULT_AGENT_ID,
    locked: 0,
    enabled: normalizeEnabled(input.enabled ?? existing?.enabled ?? 1),
    tool_policy_json: normalizeAgentToolPolicyJsonString(
      input.tool_policy_json ?? existing?.tool_policy_json,
      DEFAULT_AGENT_TOOL_POLICY,
    ),
    handoff_config_json: normalizeAgentHandoffConfigJsonString(
      input.handoff_config_json ?? existing?.handoff_config_json,
      DEFAULT_AGENT_HANDOFF_CONFIG,
    ),
    runtime_config_json: normalizeAgentRuntimeConfigJsonString(
      input.runtime_config_json ?? existing?.runtime_config_json,
      DEFAULT_AGENT_RUNTIME_CONFIG,
    ),
    model_ref: normalizeNullableText(input.model_ref ?? existing?.model_ref, 160),
    voice: normalizeNullableText(input.voice ?? existing?.voice, 80),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

function assertAgentEditable(agent: AgentProfile): void {
  if (agent.id === DEFAULT_AGENT_ID || agent.kind === "main" || agent.locked) {
    throw new Error("Void is locked and cannot be edited, archived, or deleted.");
  }
}

function ensureAgentRuntimeState(agentId: string, status: AgentRuntimeStatus): void {
  upsertAgentRuntimeState({
    agent_id: agentId,
    status,
    current_run_id: null,
    last_error: null,
  });
}

function ensureAllAgentRuntimeStates(): void {
  for (const agent of listAgents()) {
    const existing = getDb()
      .select({ agent_id: agentRuntimeState.agent_id })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agent_id, agent.id))
      .get();
    if (!existing) ensureAgentRuntimeState(agent.id, "idle");
  }
}

function parseAgentHandoffConfig(agent: AgentProfile): { mode: string } {
  try {
    const parsed = JSON.parse(agent.handoff_config_json) as { mode?: unknown };
    return { mode: typeof parsed.mode === "string" ? parsed.mode : "consult" };
  } catch {
    return { mode: "consult" };
  }
}

function normalizeRequiredText(raw: unknown, label: string, maxLength: number): string {
  const text = coercePlainText(raw).trim();
  if (!text) throw new Error(label + " is required.");
  return truncateText(text, maxLength);
}

function normalizeNullableText(raw: unknown, maxLength: number): string | null {
  if (raw == null) return null;
  const text = coercePlainText(raw).trim();
  return text ? truncateText(text, maxLength) : null;
}

function normalizeAvatar(raw: unknown): string {
  const text = coercePlainText(raw, "A").trim();
  return ((text.match(/[A-Za-z0-9]/)?.[0] ?? text.slice(0, 1)) || "A").toUpperCase();
}

function normalizeEnabled(raw: unknown): number {
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return raw === 0 ? 0 : 1;
  if (typeof raw === "string") return raw === "0" || raw.toLowerCase() === "false" ? 0 : 1;
  return 1;
}

function coercePlainText(raw: unknown, fallback = ""): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return fallback;
}

function normalizeAgentToolPolicyJsonString(raw: unknown, fallback: AgentToolPolicy): string {
  return JSON.stringify(normalizeAgentToolPolicy(raw, fallback));
}

function normalizeAgentHandoffConfigJsonString(raw: unknown, fallback: AgentHandoffConfig): string {
  return JSON.stringify(normalizeAgentHandoffConfig(raw, fallback));
}

function normalizeAgentRuntimeConfigJsonString(raw: unknown, fallback: AgentRuntimeConfig): string {
  return JSON.stringify(normalizeAgentRuntimeConfig(raw, fallback));
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
}

export function listMemories(): MemoryRecord[] {
  return getDb()
    .select()
    .from(memories)
    .orderBy(desc(memories.pinned), desc(memories.salience), desc(memories.updated_at))
    .all();
}

export function saveMemory(memory: MemoryRecord): void {
  getDb()
    .insert(memories)
    .values(memory)
    .onConflictDoUpdate({
      target: memories.id,
      set: {
        scope: memory.scope,
        kind: memory.kind,
        title: memory.title,
        content: memory.content,
        agent_id: memory.agent_id,
        conversation_id: memory.conversation_id,
        salience: memory.salience,
        pinned: memory.pinned,
        updated_at: Date.now(),
      },
    })
    .run();
}

export function deleteMemory(id: string): void {
  getDb().delete(memories).where(eq(memories.id, id)).run();
}

export function listWorkflows(): WorkflowDefinition[] {
  return getDb().select().from(workflows).orderBy(desc(workflows.updated_at)).all();
}

export function listWorkflowRuns(): WorkflowRun[] {
  return getDb().select().from(workflowRuns).orderBy(desc(workflowRuns.started_at)).all();
}

export function listHarnessEvents(): HarnessEvent[] {
  return getDb().select().from(harnessEvents).orderBy(desc(harnessEvents.created_at)).all();
}

export function insertHarnessEvent(input: {
  id?: string;
  kind: HarnessEvent["kind"];
  title: string;
  status: HarnessEvent["status"];
  detail?: unknown;
  created_at?: number;
}): HarnessEvent {
  const row: HarnessEvent = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    title: input.title,
    status: input.status,
    detail_json: JSON.stringify(sanitizeHarnessDetail(input.detail ?? {})),
    created_at: input.created_at ?? Date.now(),
  };
  getDb().insert(harnessEvents).values(row).run();
  return row;
}

function sanitizeHarnessDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object") return detail;
  const redactKeys = new Set(["apiKey", "api_key", "authorization", "Authorization", "token"]);
  if (Array.isArray(detail)) return detail.map(sanitizeHarnessDetail);
  return Object.fromEntries(
    Object.entries(detail as Record<string, unknown>).map(([key, value]) => [
      key,
      redactKeys.has(key) ? "[redacted]" : sanitizeHarnessDetail(value),
    ]),
  );
}

export function listServerNodes(): ServerNode[] {
  return getDb().select().from(serverNodes).orderBy(desc(serverNodes.updated_at)).all();
}

export function upsertServerNode(node: ServerNode): void {
  getDb()
    .insert(serverNodes)
    .values(node)
    .onConflictDoUpdate({
      target: serverNodes.id,
      set: {
        name: node.name,
        kind: node.kind,
        url: node.url,
        status: node.status,
        capabilities_json: node.capabilities_json,
        last_seen_at: node.last_seen_at,
        updated_at: Date.now(),
      },
    })
    .run();
}

export function listInteractionProfiles(): InteractionProfile[] {
  return getDb().select().from(interactionProfiles).orderBy(asc(interactionProfiles.id)).all();
}

export function getSyncState(): SyncState {
  const existing = getDb().select().from(syncState).where(eq(syncState.id, "primary")).get();
  if (existing) return existing;
  const now = Date.now();
  const row: SyncState = {
    id: "primary",
    mode: "local_only",
    endpoint: null,
    device_id: randomUUID(),
    encryption_enabled: 1,
    conflict_strategy: "merge_with_review",
    status: "idle",
    last_synced_at: null,
    updated_at: now,
  };
  getDb().insert(syncState).values(row).run();
  return row;
}

export function getWorkspaceSnapshot(): {
  agents: AgentProfile[];
  agentRuns: AgentRun[];
  agentRunSteps: AgentRunStep[];
  agentRuntimeStates: AgentRuntimeState[];
  conversationAgentStates: ConversationAgentState[];
  sandboxSessions: SandboxSession[];
  sandboxSnapshots: SandboxSnapshot[];
  sandboxArtifacts: SandboxArtifact[];
  memories: MemoryRecord[];
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  harnessEvents: HarnessEvent[];
  serverNodes: ServerNode[];
  interactionProfiles: InteractionProfile[];
  syncState: SyncState;
} {
  return {
    agents: listAgents(),
    agentRuns: listAgentRuns(),
    agentRunSteps: listAgentRunSteps(),
    agentRuntimeStates: listAgentRuntimeStates(),
    conversationAgentStates: listConversationAgentStates(),
    sandboxSessions: listSandboxSessions(),
    sandboxSnapshots: listSandboxSnapshots(),
    sandboxArtifacts: listSandboxArtifacts(),
    memories: listMemories(),
    workflows: listWorkflows(),
    workflowRuns: listWorkflowRuns(),
    harnessEvents: listHarnessEvents(),
    serverNodes: listServerNodes(),
    interactionProfiles: listInteractionProfiles(),
    syncState: getSyncState(),
  };
}

export function buildAgentSystemPrompt(agentId?: string | null, conversationId?: string): string {
  const agent = (agentId ? getAgent(agentId) : null) ?? getAgent(DEFAULT_AGENT_ID);
  const relevantMemories = listMemories()
    .filter((memory) => {
      if (memory.scope === "global") return true;
      if (agent && memory.scope === "agent" && memory.agent_id === agent.id) return true;
      return memory.scope === "conversation" && memory.conversation_id === conversationId;
    })
    .slice(0, 8);

  const identity = agent
    ? [
        `你是 ${agent.name}，角色是：${agent.role}。`,
        agent.description,
        `人格特质：${agent.personality}`,
        `灵魂设定：${agent.soul_prompt}`,
      ].join("\n")
    : "你是 Void AI，一个本地优先、尊重隐私、有帮助的 AI 助手。";

  const memoryBlock = relevantMemories.length
    ? `\n\n长期记忆（只在相关时自然使用，不要逐条复述）：\n${relevantMemories
        .map((memory) => `- ${memory.title}: ${memory.content}`)
        .join("\n")}`
    : "";

  return `${identity}${memoryBlock}\n\n请用清晰、坦诚、温暖的中文回应。需要做出假设时请说明。`;
}

function seedWorkspaceDefaults(): void {
  const db = getDb();
  const now = Date.now();

  if (db.select({ id: agents.id }).from(agents).limit(1).get()) {
    backfillAgentOrchestrationDefaults(now);
    ensureAllAgentRuntimeStates();
    return;
  }

  db.transaction((tx) => {
    tx.insert(agents)
      .values([
        {
          id: DEFAULT_AGENT_ID,
          name: "Void",
          role: "本地优先的个人 AI 伙伴",
          description: "负责日常对话、任务分解、信息整理和跨工作流协调。",
          personality: "温暖、敏锐、主动，有清晰边界感；像一个可靠的长期协作者。",
          soul_prompt:
            "保留连续的自我表达和关系记忆；优先理解用户真正想完成的事情，而不是只回答表层问题。",
          avatar: "V",
          status: "active",
          kind: "main",
          parent_agent_id: null,
          locked: 1,
          enabled: 1,
          tool_policy_json: JSON.stringify(DEFAULT_AGENT_TOOL_POLICY),
          handoff_config_json: JSON.stringify({
            ...DEFAULT_AGENT_HANDOFF_CONFIG,
            mode: "both",
            expectedOutput: "Coordinate child agents and return the final user-facing response.",
          }),
          runtime_config_json: JSON.stringify({ ...DEFAULT_AGENT_RUNTIME_CONFIG, maxTurns: 10 }),
          model_ref: null,
          voice: "calm-cn",
          created_at: now,
          updated_at: now,
        },
        {
          id: "agent-analyst",
          name: "Analyst",
          role: "研究与决策智能体",
          description: "用于资料研判、产品方案、风险评估和多方案比较。",
          personality: "严谨、克制、证据优先，善于把不确定性摊开。",
          soul_prompt: "保持怀疑精神；区分事实、推断和偏好；在高风险领域主动提醒验证。",
          avatar: "A",
          status: "active",
          kind: "child",
          parent_agent_id: DEFAULT_AGENT_ID,
          locked: 0,
          enabled: 1,
          tool_policy_json: JSON.stringify(DEFAULT_AGENT_TOOL_POLICY),
          handoff_config_json: JSON.stringify({
            ...DEFAULT_AGENT_HANDOFF_CONFIG,
            mode: "both",
            accepts: ["research", "analysis", "decision support"],
            expectedOutput: "A concise evidence-led analysis with assumptions and risks separated.",
          }),
          runtime_config_json: JSON.stringify(DEFAULT_AGENT_RUNTIME_CONFIG),
          model_ref: null,
          voice: "focused-cn",
          created_at: now,
          updated_at: now,
        },
        {
          id: "agent-operator",
          name: "Operator",
          role: "执行与自动化智能体",
          description: "用于把目标拆成步骤、执行工具、记录结果和触发工作流。",
          personality: "简洁、果断、注重可验证结果。",
          soul_prompt: "行动前确认权限边界；每次自动化都留下可审计记录。",
          avatar: "O",
          status: "draft",
          kind: "child",
          parent_agent_id: DEFAULT_AGENT_ID,
          locked: 0,
          enabled: 0,
          tool_policy_json: JSON.stringify({
            ...DEFAULT_AGENT_TOOL_POLICY,
            mode: "custom",
            allowedToolIds: ["current_time", "workspace_snapshot", "memory_search"],
          }),
          handoff_config_json: JSON.stringify({
            ...DEFAULT_AGENT_HANDOFF_CONFIG,
            mode: "consult",
            accepts: ["execution planning", "automation boundaries", "audit trail"],
            expectedOutput: "A short execution plan with tool boundaries and verifiable results.",
          }),
          runtime_config_json: JSON.stringify(DEFAULT_AGENT_RUNTIME_CONFIG),
          model_ref: null,
          voice: "direct-cn",
          created_at: now,
          updated_at: now,
        },
      ])
      .run();

    tx.insert(memories)
      .values([
        {
          id: "memory-local-first",
          scope: "global",
          kind: "preference",
          title: "本地优先",
          content: "桌面端必须可以不依赖自部署云服务独立运行；云端只作为可选同步和远程访问层。",
          agent_id: null,
          conversation_id: null,
          salience: 95,
          pinned: 1,
          created_at: now,
          updated_at: now,
        },
        {
          id: "memory-personality",
          scope: "agent",
          kind: "profile",
          title: "人格连续性",
          content: "AI 需要保留对话记忆、关系上下文和稳定的表达风格，不能每次像全新实例。",
          agent_id: DEFAULT_AGENT_ID,
          conversation_id: null,
          salience: 90,
          pinned: 1,
          created_at: now,
          updated_at: now,
        },
        {
          id: "memory-modalities",
          scope: "global",
          kind: "fact",
          title: "多模态交互目标",
          content:
            "交互通道包括 chat、语音、视频、鼠标意图和桌宠形态；桌面布局优先，Web 需要响应移动端。",
          agent_id: null,
          conversation_id: null,
          salience: 86,
          pinned: 0,
          created_at: now,
          updated_at: now,
        },
      ])
      .run();

    tx.insert(workflows)
      .values([
        {
          id: "workflow-daily-brief",
          name: "每日上下文恢复",
          description: "启动时汇总最近会话、重要记忆和待办状态，恢复 AI 的连续感。",
          status: "enabled",
          trigger: "app.startup",
          steps_json: JSON.stringify([
            {
              id: "load",
              type: "memory",
              title: "读取高权重记忆",
              detail: "加载 pinned 和高 salience 记忆",
            },
            {
              id: "summarize",
              type: "prompt",
              title: "生成上下文摘要",
              detail: "压缩成会话可注入系统提示",
            },
            {
              id: "approve",
              type: "approval",
              title: "用户可见审阅",
              detail: "同步前允许用户编辑",
            },
          ]),
          created_at: now,
          updated_at: now,
        },
        {
          id: "workflow-agent-handoff",
          name: "多智能体交接",
          description: "当任务从研究进入执行阶段时，把上下文交给 Operator 并记录 Harness 事件。",
          status: "draft",
          trigger: "manual.intent.handoff",
          steps_json: JSON.stringify([
            {
              id: "scope",
              type: "prompt",
              title: "确认执行边界",
              detail: "识别需要工具和权限的步骤",
            },
            {
              id: "handoff",
              type: "handoff",
              title: "转交 Operator",
              detail: "把摘要和约束传给执行智能体",
            },
            { id: "audit", type: "tool", title: "写入审计记录", detail: "保存工具调用和结果" },
          ]),
          created_at: now,
          updated_at: now,
        },
      ])
      .run();

    tx.insert(workflowRuns)
      .values({
        id: "run-seed-brief",
        workflow_id: "workflow-daily-brief",
        status: "succeeded",
        input_json: JSON.stringify({ source: "seed" }),
        output_json: JSON.stringify({ summary: "初始化默认工作台上下文" }),
        started_at: now - 60_000,
        finished_at: now - 58_000,
      })
      .run();

    tx.insert(harnessEvents)
      .values([
        {
          id: "event-local-server",
          kind: "automation",
          title: "本地 AI 服务通过 loopback 暴露",
          status: "succeeded",
          detail_json: JSON.stringify({ surface: "127.0.0.1", protocol: "Hono + AI SDK stream" }),
          created_at: now,
        },
        {
          id: "event-memory-seed",
          kind: "test",
          title: "长期记忆种子已写入 SQLite",
          status: "succeeded",
          detail_json: JSON.stringify({ count: 3 }),
          created_at: now + 1,
        },
      ])
      .run();

    tx.insert(serverNodes)
      .values([
        {
          id: "server-local-ai",
          name: "Local AI Loopback",
          kind: "local",
          url: "http://127.0.0.1:0",
          status: "online",
          capabilities_json: JSON.stringify(["chat-stream", "agent-context", "memory-injection"]),
          last_seen_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: "server-sync-cloud",
          name: "Optional Sync Server",
          kind: "sync",
          url: "未配置",
          status: "disabled",
          capabilities_json: JSON.stringify(["encrypted-sync", "device-merge", "backup"]),
          last_seen_at: null,
          created_at: now,
          updated_at: now,
        },
      ])
      .run();

    tx.insert(interactionProfiles)
      .values([
        {
          id: "interaction-chat",
          kind: "chat",
          label: "Chat",
          enabled: 1,
          status: "ready",
          config_json: JSON.stringify({ input: "keyboard", output: "stream" }),
          updated_at: now,
        },
        {
          id: "interaction-voice",
          kind: "voice",
          label: "Voice",
          enabled: 0,
          status: "prototype",
          config_json: JSON.stringify({ stt: "browser", tts: "provider-or-local" }),
          updated_at: now,
        },
        {
          id: "interaction-video",
          kind: "video",
          label: "Video",
          enabled: 0,
          status: "prototype",
          config_json: JSON.stringify({ camera: "permission-gated", vision: "model-dependent" }),
          updated_at: now,
        },
        {
          id: "interaction-mouse",
          kind: "mouse",
          label: "Mouse Intent",
          enabled: 0,
          status: "prototype",
          config_json: JSON.stringify({ capture: "desktop-only", privacy: "explicit-opt-in" }),
          updated_at: now,
        },
        {
          id: "interaction-pet",
          kind: "desktop_pet",
          label: "Desktop Pet",
          enabled: 0,
          status: "prototype",
          config_json: JSON.stringify({ renderer: "transparent-window", mood: "memory-aware" }),
          updated_at: now,
        },
      ])
      .run();

    tx.insert(syncState)
      .values({
        id: "primary",
        mode: "local_only",
        endpoint: null,
        device_id: randomUUID(),
        encryption_enabled: 1,
        conflict_strategy: "merge_with_review",
        status: "idle",
        last_synced_at: null,
        updated_at: now,
      })
      .run();
  });
  ensureAllAgentRuntimeStates();
}

function backfillAgentOrchestrationDefaults(now: number): void {
  const db = getDb();
  const existingAgents = db.select().from(agents).all();
  for (const agent of existingAgents) {
    const isVoid = agent.id === DEFAULT_AGENT_ID;
    db.update(agents)
      .set({
        kind: isVoid ? "main" : (agent.kind ?? "child"),
        parent_agent_id: isVoid ? null : (agent.parent_agent_id ?? DEFAULT_AGENT_ID),
        locked: isVoid ? 1 : (agent.locked ?? 0),
        enabled: isVoid ? 1 : normalizeEnabled(agent.enabled ?? 1),
        tool_policy_json: normalizeAgentToolPolicyJsonString(
          agent.tool_policy_json,
          DEFAULT_AGENT_TOOL_POLICY,
        ),
        handoff_config_json: normalizeAgentHandoffConfigJsonString(
          agent.handoff_config_json,
          isVoid ? { ...DEFAULT_AGENT_HANDOFF_CONFIG, mode: "both" } : DEFAULT_AGENT_HANDOFF_CONFIG,
        ),
        runtime_config_json: normalizeAgentRuntimeConfigJsonString(
          agent.runtime_config_json,
          DEFAULT_AGENT_RUNTIME_CONFIG,
        ),
        updated_at: agent.updated_at || now,
      })
      .where(eq(agents.id, agent.id))
      .run();
  }
}
