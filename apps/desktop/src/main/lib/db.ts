import Database from "better-sqlite3";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_ROOT_AGENT_SEED,
  DEFAULT_WORKFLOW_SEEDS,
} from "./runtime-defaults";
import {
  agentPolicies,
  agentInstances,
  agents,
  apiKeys,
  conversations,
  collaborationMessages,
  contextCheckpoints,
  interactionProfiles,
  memories,
  memoryJobs,
  messages,
  modelApiKeys,
  runtimeEvents,
  runtimeRuns,
  runtimeSteps,
  sandboxArtifacts,
  sandboxSessions,
  sandboxSnapshots,
  schema,
  settings,
  syncProfiles,
  toolSecrets,
  toolServers,
  tools,
  workflows,
  type AgentPolicy as DbAgentPolicy,
  type AgentInstance as DbAgentInstance,
  type CollaborationMessage as DbCollaborationMessage,
  type ContextCheckpoint as DbContextCheckpoint,
  type AgentProfile as DbAgentProfile,
  type NewMemoryJob,
  type NewRuntimeEvent,
  type NewRuntimeRun,
  type NewRuntimeStep,
  type NewSandboxArtifact,
  type NewSandboxSession,
  type NewSandboxSnapshot,
  type NewToolRecord,
  type NewToolSecret,
  type NewToolServer,
  type RuntimeEvent as DbRuntimeEvent,
  type RuntimeRun as DbRuntimeRun,
  type RuntimeStep as DbRuntimeStep,
  type SandboxArtifact,
  type SandboxSession,
  type SandboxSnapshot,
  type ToolRecord as DbToolRecord,
  type ToolSecret as DbToolSecret,
  type ToolServer as DbToolServer,
} from "./schema";
import {
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID as SHARED_DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  DEFAULT_DESKTOP_PET_CONFIG,
  DESKTOP_PET_PROFILE_ID,
  mergeDesktopPetConfig,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  normalizeDesktopPetConfig,
  type AgentInput,
  type AgentCollaborationMessage,
  type AgentContextCheckpoint,
  type AgentInstanceRecord,
  type AgentProfile,
  type AgentRuntimeState,
  type AgentRuntimeStatus,
  type Conversation,
  type ConversationAgentState,
  type DesktopPetConfigPatch,
  type DesktopPetSnapshot,
  type InteractionProfile,
  type MemoryKind,
  type MemoryJob,
  type MemoryJobKind,
  type MemoryJobStatus,
  type MemoryOrigin,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStatus,
  type MessagePatch,
  type MessagePatchResult,
  type MessageRow,
  type MessageSnapshot,
  type RunStatus,
  type RuntimeEvent,
  type RuntimeSnapshot,
  type RuntimeStep,
  type RuntimeRun,
  type SyncState,
  type ToolRecord,
  type ToolSecretInput,
  type ToolSecretOwnerType,
  type ToolSecretPublic,
  type ToolServer,
  type ToolServerInput,
  type ToolSkill,
  type ToolSkillInput,
  type ToolSkillStep,
  type ToolsSnapshot,
  type WorkflowDefinition,
  type WorkflowRun,
} from "../../shared/types";
import { resolveDesktopPet } from "./desktop-pet-assets";
import { applyDesktopPetIdleTimeout, resolveDesktopPetActivity } from "./desktop-pet-activity";
import { isRecoverableSchemaInitError } from "./schema-init";
import {
  createWorkflowRunRecord,
  listWorkflowDefinitions,
  listWorkflowRuns,
  toWorkflowDefinition,
  updateWorkflowRunRecord,
} from "./workflow-runs";
import { buildNodeFromLegacyStep } from "./workflow-types";

export type {
  AgentProfile,
  AgentRuntimeState,
  Conversation,
  ConversationAgentState,
  InteractionProfile,
  MemoryJob,
  MemoryRecord,
  MessageRow,
  RuntimeEvent,
  RuntimeRun,
  RuntimeStep,
  SandboxArtifact,
  SandboxSession,
  SandboxSnapshot,
  SyncState,
  ToolRecord,
  ToolServer,
  ToolSkill,
  WorkflowDefinition,
  WorkflowRun,
};

// 重新导出 schema 供其他模块直接引用（统一来源）。
export { schema };

const DB_FILENAME = "void-ai.db";
const DATA_DIRNAME = "data";
const DEFAULT_AGENT_ID = SHARED_DEFAULT_AGENT_ID;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_PROFILE_ID = "sync-local";
const DEFAULT_MEMORY_CONFIDENCE = 70;
const DEFAULT_MEMORY_ORIGIN: MemoryOrigin = "manual";
const DEFAULT_MEMORY_STATUS: MemoryStatus = "active";
const MEMORY_JOB_MAX_ATTEMPTS = 3;

type DbInstance = BetterSQLite3Database<typeof schema>;
type RuntimeStatus = RunStatus;

let rawDb: Database.Database | null = null;
let dbInstance: DbInstance | null = null;

const agentRuntimeStates = new Map<string, AgentRuntimeState>();
const conversationAgentStates = new Map<string, ConversationAgentState>();

function resolveDataDir(): string {
  const userDataDir = process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData");
  const dir = join(userDataDir, DATA_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveMigrationsFolder(): string {
  if (is.dev) {
    const candidates = [
      join(__dirname, "..", "..", "drizzle"),
      join(__dirname, "..", "..", "..", "drizzle"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  }
  return join(process.resourcesPath, "drizzle");
}

export function initDb(): DbInstance {
  if (dbInstance) return dbInstance;

  const dbPath = join(resolveDataDir(), DB_FILENAME);
  try {
    return openAndMigrateDb(dbPath);
  } catch (error) {
    if (!isRecoverableSchemaInitError(error)) throw error;
    resetDatabaseFiles(dbPath, error);
    return openAndMigrateDb(dbPath);
  }
}

function openAndMigrateDb(dbPath: string): DbInstance {
  rawDb = new Database(dbPath);
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.pragma("busy_timeout = 5000");

  dbInstance = drizzle(rawDb, { schema });
  try {
    migrate(dbInstance, { migrationsFolder: resolveMigrationsFolder() });
    cancelStaleRuntimeRuns();
    purgeExpiredDeletedConversations();
    seedDefaults();
  } catch (error) {
    rawDb.close();
    rawDb = null;
    dbInstance = null;
    throw error;
  }
  return dbInstance;
}

function cancelStaleRuntimeRuns(): void {
  const now = Date.now();
  getDb()
    .update(runtimeRuns)
    .set({
      status: "cancelled",
      finished_at: now,
      updated_at: now,
    })
    .where(inArray(runtimeRuns.status, ["queued", "running"]))
    .run();
}

export function getDb(): DbInstance {
  if (!dbInstance) return initDb();
  return dbInstance;
}

function resetDatabaseFiles(dbPath: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn("[db] Greenfield schema init failed; rebuilding local database:", message);
  closeDb();

  const backupDir = join(dirname(dbPath), `backup-before-runtime-schema-${Date.now()}`);
  mkdirSync(backupDir, { recursive: true });

  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(filePath)) continue;
    const targetPath = join(backupDir, basename(filePath));
    moveDatabaseFile(filePath, targetPath);
  }
}

function moveDatabaseFile(sourcePath: string, targetPath: string): void {
  try {
    renameSync(sourcePath, targetPath);
  } catch {
    copyFileSync(sourcePath, targetPath);
    unlinkSync(sourcePath);
  }
}

export function closeDb(): void {
  rawDb?.close();
  rawDb = null;
  dbInstance = null;
  agentRuntimeStates.clear();
  conversationAgentStates.clear();
}

export function createConversation(id: string, title = "New conversation"): Conversation {
  const now = Date.now();
  const row: Conversation = {
    id,
    title,
    created_at: now,
    updated_at: now,
    message_revision: 0,
    deleted_at: null,
    purge_after_at: null,
  };
  getDb().insert(conversations).values(row).run();
  return row;
}

export function listConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNull(conversations.deleted_at))
    .orderBy(desc(conversations.updated_at))
    .all();
}

export function listDeletedConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNotNull(conversations.deleted_at))
    .orderBy(desc(conversations.deleted_at))
    .all();
}

export function getConversation(id: string): Conversation | null {
  return getDb().select().from(conversations).where(eq(conversations.id, id)).get() ?? null;
}

export function touchConversation(id: string, title?: string): void {
  const patch: Partial<Conversation> = { updated_at: Date.now() };
  if (typeof title === "string" && title.trim()) patch.title = title.trim().slice(0, 160);
  getDb().update(conversations).set(patch).where(eq(conversations.id, id)).run();
}

export function deleteConversation(id: string): void {
  const now = Date.now();
  getDb()
    .update(conversations)
    .set({ deleted_at: now, purge_after_at: now + TRASH_RETENTION_MS, updated_at: now })
    .where(eq(conversations.id, id))
    .run();
}

export function restoreConversation(id: string): void {
  getDb()
    .update(conversations)
    .set({ deleted_at: null, purge_after_at: null, updated_at: Date.now() })
    .where(eq(conversations.id, id))
    .run();
}

export function permanentlyDeleteConversation(id: string): void {
  getDb().delete(conversations).where(eq(conversations.id, id)).run();
}

export function permanentlyDeleteConversations(ids: string[]): number {
  let deleted = 0;
  for (const id of ids) {
    const result = getDb().delete(conversations).where(eq(conversations.id, id)).run();
    deleted += result.changes;
  }
  return deleted;
}

export function purgeExpiredDeletedConversations(now = Date.now()): number {
  return getDb()
    .delete(conversations)
    .where(and(isNotNull(conversations.purge_after_at), lt(conversations.purge_after_at, now)))
    .run().changes;
}

export function saveMessage(msg: MessageRow): void {
  const row = messageToDb(msg);
  getDb().transaction((tx) => {
    tx.insert(messages)
      .values(row)
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          conversation_id: row.conversation_id,
          role: row.role,
          content_json: row.content_json,
          metadata_json: row.metadata_json,
          created_at: row.created_at,
        },
      })
      .run();
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, msg.conversation_id))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    tx.update(conversations)
      .set({ message_revision: conversation.revision + 1, updated_at: Date.now() })
      .where(eq(conversations.id, msg.conversation_id))
      .run();
  });
}

export function saveMessagesBatch(rows: MessageRow[]): void {
  const db = getDb();
  db.transaction((tx) => {
    for (const msg of rows) {
      const row = messageToDb(msg);
      tx.insert(messages)
        .values(row)
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            conversation_id: row.conversation_id,
            role: row.role,
            content_json: row.content_json,
            metadata_json: row.metadata_json,
            created_at: row.created_at,
          },
        })
        .run();
    }
    if (rows[0]) {
      const conversation = tx
        .select({ revision: conversations.message_revision })
        .from(conversations)
        .where(eq(conversations.id, rows[0].conversation_id))
        .get();
      if (!conversation) throw new Error("Conversation does not exist.");
      tx.update(conversations)
        .set({ message_revision: conversation.revision + 1, updated_at: Date.now() })
        .where(eq(conversations.id, rows[0].conversation_id))
        .run();
    }
  });
}

export function applyMessagesPatch(patch: MessagePatch): MessagePatchResult {
  const { conversationId, baseRevision, upserts, deleteIds } = patch;
  if (upserts.some((row) => row.conversation_id !== conversationId)) {
    throw new Error("Message patch contains rows from another conversation.");
  }
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error("Message patch base revision is invalid.");
  }

  const db = getDb();
  return db.transaction((tx) => {
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    if (conversation.revision !== baseRevision) {
      return { applied: false, revision: conversation.revision };
    }

    for (const id of new Set(deleteIds.filter(Boolean))) {
      tx.delete(messages)
        .where(and(eq(messages.conversation_id, conversationId), eq(messages.id, id)))
        .run();
    }
    for (const msg of upserts) {
      const row = messageToDb(msg);
      tx.insert(messages)
        .values(row)
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            conversation_id: row.conversation_id,
            role: row.role,
            content_json: row.content_json,
            metadata_json: row.metadata_json,
            created_at: row.created_at,
          },
        })
        .run();
    }
    const revision = baseRevision + 1;
    tx.update(conversations)
      .set({ message_revision: revision, updated_at: Date.now() })
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.message_revision, baseRevision)),
      )
      .run();
    return { applied: true, revision };
  });
}

export function listMessages(conversationId: string): MessageRow[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(messages.created_at)
    .all()
    .map(dbMessageToShared);
}

export function getMessagesSnapshot(conversationId: string): MessageSnapshot {
  const conversation = getDb()
    .select({ revision: conversations.message_revision })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!conversation) throw new Error("Conversation does not exist.");
  return { messages: listMessages(conversationId), revision: conversation.revision };
}

export function getSetting(key: string): string | null {
  return getDb().select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function setApiKey(provider: string, apiKey: string): void {
  const payload = encrypt(apiKey);
  getDb()
    .insert(apiKeys)
    .values({ provider, ciphertext: JSON.stringify(payload), updated_at: Date.now() })
    .onConflictDoUpdate({
      target: apiKeys.provider,
      set: { ciphertext: JSON.stringify(payload), updated_at: Date.now() },
    })
    .run();
}

export function getApiKey(provider: string): string | null {
  const row = getDb().select().from(apiKeys).where(eq(apiKeys.provider, provider)).get();
  if (!row) return null;
  try {
    return decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
    return null;
  }
}

export function deleteApiKey(provider: string): void {
  getDb().delete(apiKeys).where(eq(apiKeys.provider, provider)).run();
}

export function listApiKeyProviders(): string[] {
  return getDb()
    .select()
    .from(apiKeys)
    .all()
    .map((row) => row.provider);
}

export function setModelApiKey(providerId: string, modelId: string, apiKey: string): void {
  const payload = encrypt(apiKey);
  const row = {
    provider_id: providerId,
    model_id: modelId,
    ciphertext: JSON.stringify(payload),
    updated_at: Date.now(),
  };
  getDb()
    .insert(modelApiKeys)
    .values(row)
    .onConflictDoUpdate({
      target: [modelApiKeys.provider_id, modelApiKeys.model_id],
      set: { ciphertext: row.ciphertext, updated_at: row.updated_at },
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
    return decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
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
  return getDb()
    .select()
    .from(modelApiKeys)
    .all()
    .map((row) => `${row.provider_id}/${row.model_id}`);
}

export function listAgents(): AgentProfile[] {
  return getDb().select().from(agents).orderBy(agents.kind, agents.name).all().map(toAgentProfile);
}

export function getAgent(id: string): AgentProfile | null {
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get();
  return row ? toAgentProfile(row) : null;
}

export function createAgent(input: AgentInput): AgentProfile {
  const now = Date.now();
  const normalized = normalizeAgentInput(randomUUID(), input, null, now);
  getDb().insert(agents).values(normalized.agent).run();
  getDb().insert(agentPolicies).values(normalized.policy).run();
  upsertAgentRuntimeState({ agent_id: normalized.agent.id, status: "idle" });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent created",
    status: "succeeded",
    agent_id: normalized.agent.id,
    detail: { agentId: normalized.agent.id, role: normalized.agent.role },
  });
  return toAgentProfile(normalized.agent);
}

export function updateAgent(id: string, input: Partial<AgentInput>): AgentProfile {
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  const now = Date.now();
  const normalized = normalizeAgentInput(id, input, existing, now);
  getDb().update(agents).set(normalized.agent).where(eq(agents.id, id)).run();
  getDb()
    .insert(agentPolicies)
    .values(normalized.policy)
    .onConflictDoUpdate({
      target: agentPolicies.agent_id,
      set: {
        tool_policy_json: normalized.policy.tool_policy_json,
        review_policy_json: normalized.policy.review_policy_json,
        sandbox_policy_json: normalized.policy.sandbox_policy_json,
        routing_policy_json: normalized.policy.routing_policy_json,
        updated_at: normalized.policy.updated_at,
      },
    })
    .run();
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent updated",
    status: "succeeded",
    agent_id: id,
    detail: { agentId: id },
  });
  return getAgent(id)!;
}

export function saveAgent(agent: AgentProfile): void {
  const existing = getDb().select().from(agents).where(eq(agents.id, agent.id)).get() ?? null;
  if (existing) assertAgentEditable(existing);
  const now = Date.now();
  const normalized = normalizeAgentInput(agent.id, agent, existing, now);
  getDb()
    .insert(agents)
    .values(normalized.agent)
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: normalized.agent.name,
        role: normalized.agent.role,
        instructions: normalized.agent.instructions,
        persona: normalized.agent.persona,
        description: normalized.agent.description,
        avatar: normalized.agent.avatar,
        status: normalized.agent.status,
        kind: normalized.agent.kind,
        parent_agent_id: normalized.agent.parent_agent_id,
        locked: normalized.agent.locked,
        enabled: normalized.agent.enabled,
        model_ref: normalized.agent.model_ref,
        voice: normalized.agent.voice,
        updated_at: normalized.agent.updated_at,
      },
    })
    .run();
  getDb()
    .insert(agentPolicies)
    .values(normalized.policy)
    .onConflictDoUpdate({
      target: agentPolicies.agent_id,
      set: {
        tool_policy_json: normalized.policy.tool_policy_json,
        review_policy_json: normalized.policy.review_policy_json,
        sandbox_policy_json: normalized.policy.sandbox_policy_json,
        routing_policy_json: normalized.policy.routing_policy_json,
        updated_at: normalized.policy.updated_at,
      },
    })
    .run();
  upsertAgentRuntimeState({ agent_id: agent.id, status: "idle" });
}

export function archiveAgent(id: string): AgentProfile {
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  getDb()
    .update(agents)
    .set({ status: "archived", enabled: 0, updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  upsertAgentRuntimeState({ agent_id: id, status: "idle", current_run_id: null });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent archived",
    status: "succeeded",
    agent_id: id,
  });
  return getAgent(id)!;
}

export function restoreAgent(id: string): AgentProfile {
  getDb()
    .update(agents)
    .set({ status: "active", enabled: 1, updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  upsertAgentRuntimeState({ agent_id: id, status: "idle" });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent restored",
    status: "succeeded",
    agent_id: id,
  });
  return getAgent(id)!;
}

/** 永久删除智能体：硬删除 agents 表行；不允许删除 root/locked agent。 */
export function deleteAgent(id: string): void {
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  if (existing.kind === "main") throw new Error("Root agent cannot be deleted.");
  // 清理子表外键后再删除主表行
  getDb().delete(agentPolicies).where(eq(agentPolicies.agent_id, id)).run();
  getDb().delete(agents).where(eq(agents.id, id)).run();
  // 同步内存中的运行时状态
  upsertAgentRuntimeState({ agent_id: id, status: "idle", current_run_id: null });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent permanently deleted",
    status: "succeeded",
    agent_id: id,
    detail: { agentId: id, name: existing.name },
  });
}

export function duplicateAgent(id: string): AgentProfile {
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found.");
  const copy = createAgent({
    ...existing,
    name: existing.name + " Copy",
    status: "draft",
    enabled: 0,
  });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent duplicated",
    status: "succeeded",
    agent_id: copy.id,
    detail: { sourceAgentId: id, agentId: copy.id },
  });
  return copy;
}

export function listRuntimeRuns(limit = 50): RuntimeRun[] {
  return getDb()
    .select()
    .from(runtimeRuns)
    .orderBy(desc(runtimeRuns.started_at))
    .limit(limit)
    .all()
    .map(toRuntimeRun);
}

export function createRuntimeRun(input: {
  id?: string;
  conversation_id?: string | null;
  root_agent_id?: string | null;
  final_agent_id?: string | null;
  workflow_id?: string | null;
  status: RuntimeStatus;
  model_ref?: string | null;
  trace_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  error?: string | null;
  usage_json?: string | null;
  metadata_json?: string;
  started_at?: number;
  finished_at?: number | null;
}): RuntimeRun {
  const now = Date.now();
  const row: NewRuntimeRun = {
    id: input.id ?? randomUUID(),
    conversation_id: input.conversation_id ?? null,
    root_agent_id: input.root_agent_id ?? null,
    final_agent_id: input.final_agent_id ?? null,
    workflow_id: input.workflow_id ?? null,
    status: input.status,
    model_ref: input.model_ref ?? null,
    trace_id: input.trace_id ?? null,
    input_summary: input.input_summary ?? null,
    output_summary: input.output_summary ?? null,
    error: input.error ?? null,
    usage_json: input.usage_json ?? null,
    metadata_json: input.metadata_json ?? "{}",
    started_at: input.started_at ?? now,
    finished_at: input.finished_at ?? null,
    updated_at: now,
  };
  getDb().insert(runtimeRuns).values(row).run();
  return toRuntimeRun(row as DbRuntimeRun);
}

export function cancelActiveRuntimeRunsForConversation(conversationId: string): number {
  const now = Date.now();
  const result = getDb()
    .update(runtimeRuns)
    .set({
      status: "cancelled",
      finished_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(runtimeRuns.conversation_id, conversationId),
        inArray(runtimeRuns.status, ["queued", "running", "waiting_approval", "waiting_handoff"]),
      ),
    )
    .run();
  return result.changes;
}

export function updateRuntimeRun(
  id: string,
  patch: Partial<Omit<RuntimeRun, "id" | "started_at">>,
): RuntimeRun | null {
  const existing = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(runtimeRuns)
    .set({
      final_agent_id: patch.final_agent_id ?? existing.final_agent_id,
      status: (patch.status as RuntimeStatus | undefined) ?? existing.status,
      model_ref: patch.model_ref ?? existing.model_ref,
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      trace_id: patch.trace_id === undefined ? existing.trace_id : patch.trace_id,
      input_summary:
        patch.input_summary === undefined ? existing.input_summary : patch.input_summary,
      output_summary:
        patch.output_summary === undefined ? existing.output_summary : patch.output_summary,
      error: patch.error === undefined ? existing.error : patch.error,
      usage_json: patch.usage_json === undefined ? existing.usage_json : patch.usage_json,
      updated_at: Date.now(),
    })
    .where(eq(runtimeRuns.id, id))
    .run();
  const row = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  return row ? toRuntimeRun(row) : null;
}

export function listRuntimeSteps(limit = 200): RuntimeStep[] {
  return getDb()
    .select()
    .from(runtimeSteps)
    .orderBy(desc(runtimeSteps.started_at))
    .limit(limit)
    .all()
    .map(toRuntimeStep);
}

export function createRuntimeStep(input: {
  id?: string;
  run_id: string;
  agent_id?: string | null;
  tool_id?: string | null;
  kind: string;
  status: RuntimeStatus;
  title: string;
  detail?: unknown;
  detail_json?: string;
  started_at?: number;
  finished_at?: number | null;
  error?: string | null;
}): RuntimeStep {
  const row: NewRuntimeStep = {
    id: input.id ?? randomUUID(),
    run_id: input.run_id,
    agent_id: input.agent_id ?? null,
    tool_id: input.tool_id ?? null,
    kind: normalizeRuntimeKind(input.kind),
    status: input.status,
    title: input.title,
    detail_json: input.detail_json ?? JSON.stringify(redactDetail(input.detail ?? {})),
    started_at: input.started_at ?? Date.now(),
    finished_at: input.finished_at ?? null,
    error: input.error ?? null,
  };
  getDb().insert(runtimeSteps).values(row).run();
  return toRuntimeStep(row as DbRuntimeStep);
}

export function updateRuntimeStep(
  id: string,
  patch: Partial<Omit<RuntimeStep, "id" | "run_id" | "started_at">> & { detail?: unknown },
): RuntimeStep | null {
  const existing = getDb().select().from(runtimeSteps).where(eq(runtimeSteps.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(runtimeSteps)
    .set({
      agent_id: patch.agent_id === undefined ? existing.agent_id : patch.agent_id,
      kind: patch.kind ? normalizeRuntimeKind(patch.kind) : existing.kind,
      status: (patch.status as RuntimeStatus | undefined) ?? existing.status,
      title: patch.title ?? existing.title,
      detail_json:
        patch.detail !== undefined
          ? JSON.stringify(redactDetail(patch.detail))
          : (patch.detail_json ?? existing.detail_json),
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      error: patch.error === undefined ? existing.error : patch.error,
    })
    .where(eq(runtimeSteps.id, id))
    .run();
  const row = getDb().select().from(runtimeSteps).where(eq(runtimeSteps.id, id)).get();
  return row ? toRuntimeStep(row) : null;
}

export function listRuntimeEvents(limit = 500): RuntimeEvent[] {
  return getDb()
    .select()
    .from(runtimeEvents)
    .orderBy(desc(runtimeEvents.created_at))
    .limit(limit)
    .all()
    .map(toRuntimeEvent);
}

export function insertRuntimeEvent(input: {
  id?: string;
  run_id?: string | null;
  runId?: string | null;
  step_id?: string | null;
  stepId?: string | null;
  conversation_id?: string | null;
  conversationId?: string | null;
  agent_id?: string | null;
  agentId?: string | null;
  tool_id?: string | null;
  toolId?: string | null;
  owner_type?: string | null;
  ownerType?: string | null;
  owner_id?: string | null;
  ownerId?: string | null;
  kind: string;
  status?: RuntimeStatus;
  severity?: RuntimeEvent["severity"];
  title: string;
  detail?: unknown;
  detail_json?: string;
  duration_ms?: number | null;
  durationMs?: number | null;
  event_type?: RuntimeEvent["event_type"];
  eventType?: RuntimeEvent["event_type"];
  agent_path?: string | null;
  agentPath?: string | null;
  parent_agent_path?: string | null;
  parentAgentPath?: string | null;
  sequence?: number | null;
  created_at?: number;
}): RuntimeEvent {
  const row: NewRuntimeEvent = {
    id: input.id ?? randomUUID(),
    run_id: input.run_id ?? input.runId ?? null,
    step_id: input.step_id ?? input.stepId ?? null,
    conversation_id: input.conversation_id ?? input.conversationId ?? null,
    agent_id: input.agent_id ?? input.agentId ?? null,
    tool_id: input.tool_id ?? input.toolId ?? null,
    owner_type: input.owner_type ?? input.ownerType ?? null,
    owner_id: input.owner_id ?? input.ownerId ?? null,
    kind: normalizeRuntimeKind(input.kind),
    status: input.status ?? "succeeded",
    severity: input.severity ?? (input.kind === "error" ? "error" : "info"),
    title: input.title,
    detail_json: input.detail_json ?? JSON.stringify(redactDetail(input.detail ?? {})),
    duration_ms: input.duration_ms ?? input.durationMs ?? null,
    event_type: input.event_type ?? input.eventType ?? null,
    agent_path: input.agent_path ?? input.agentPath ?? null,
    parent_agent_path: input.parent_agent_path ?? input.parentAgentPath ?? null,
    sequence: input.sequence ?? null,
    created_at: input.created_at ?? Date.now(),
  };
  getDb().insert(runtimeEvents).values(row).run();
  return toRuntimeEvent(row as DbRuntimeEvent);
}

export function saveAgentInstance(record: AgentInstanceRecord): AgentInstanceRecord {
  getDb()
    .insert(agentInstances)
    .values(record)
    .onConflictDoUpdate({
      target: agentInstances.id,
      set: {
        status: record.status,
        task_summary: record.task_summary,
        turn_count: record.turn_count,
        last_message: record.last_message,
        error: record.error,
        started_at: record.started_at,
        finished_at: record.finished_at,
        updated_at: record.updated_at,
      },
    })
    .run();
  return record;
}

export function listAgentInstances(limit = 300): AgentInstanceRecord[] {
  return getDb()
    .select()
    .from(agentInstances)
    .orderBy(desc(agentInstances.updated_at))
    .limit(limit)
    .all()
    .map((row: DbAgentInstance) => row as AgentInstanceRecord);
}

export function saveCollaborationMessage(
  message: AgentCollaborationMessage,
): AgentCollaborationMessage {
  getDb()
    .insert(collaborationMessages)
    .values(message)
    .onConflictDoUpdate({
      target: collaborationMessages.id,
      set: { delivered_at: message.delivered_at, content: message.content },
    })
    .run();
  return message;
}

export function listCollaborationMessages(limit = 500): AgentCollaborationMessage[] {
  return getDb()
    .select()
    .from(collaborationMessages)
    .orderBy(desc(collaborationMessages.created_at))
    .limit(limit)
    .all()
    .map((row: DbCollaborationMessage) => row as AgentCollaborationMessage);
}

export function createContextCheckpoint(
  checkpoint: AgentContextCheckpoint,
): AgentContextCheckpoint {
  getDb().insert(contextCheckpoints).values(checkpoint).run();
  return checkpoint;
}

export function listContextCheckpoints(limit = 200): AgentContextCheckpoint[] {
  return getDb()
    .select()
    .from(contextCheckpoints)
    .orderBy(desc(contextCheckpoints.created_at))
    .limit(limit)
    .all()
    .map((row: DbContextCheckpoint) => row as AgentContextCheckpoint);
}

export function listagentRuntimeStates(): AgentRuntimeState[] {
  ensureAllagentRuntimeStates();
  return [...agentRuntimeStates.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function upsertAgentRuntimeState(
  patch: Partial<AgentRuntimeState> & { agent_id: string; status?: AgentRuntimeStatus },
): AgentRuntimeState {
  const previous = agentRuntimeStates.get(patch.agent_id);
  const row: AgentRuntimeState = {
    agent_id: patch.agent_id,
    status: patch.status ?? previous?.status ?? "idle",
    current_run_id:
      patch.current_run_id === undefined
        ? (previous?.current_run_id ?? null)
        : patch.current_run_id,
    last_handoff_at:
      patch.last_handoff_at === undefined
        ? (previous?.last_handoff_at ?? null)
        : patch.last_handoff_at,
    last_tool_at:
      patch.last_tool_at === undefined ? (previous?.last_tool_at ?? null) : patch.last_tool_at,
    last_learning_at:
      patch.last_learning_at === undefined
        ? (previous?.last_learning_at ?? null)
        : patch.last_learning_at,
    last_error: patch.last_error === undefined ? (previous?.last_error ?? null) : patch.last_error,
    updated_at: Date.now(),
  };
  agentRuntimeStates.set(row.agent_id, row);
  return row;
}

export function listConversationAgentStates(): ConversationAgentState[] {
  return [...conversationAgentStates.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function getConversationAgentState(conversationId: string): ConversationAgentState | null {
  return conversationAgentStates.get(conversationId) ?? null;
}

export function upsertConversationAgentState(
  patch: Partial<ConversationAgentState> & { conversation_id: string },
): ConversationAgentState {
  const previous = conversationAgentStates.get(patch.conversation_id);
  const row: ConversationAgentState = {
    conversation_id: patch.conversation_id,
    active_agent_id:
      patch.active_agent_id === undefined
        ? (previous?.active_agent_id ?? null)
        : patch.active_agent_id,
    current_run_id:
      patch.current_run_id === undefined
        ? (previous?.current_run_id ?? null)
        : patch.current_run_id,
    current_step_id:
      patch.current_step_id === undefined
        ? (previous?.current_step_id ?? null)
        : patch.current_step_id,
    status: patch.status ?? previous?.status ?? "idle",
    summary: patch.summary === undefined ? (previous?.summary ?? null) : patch.summary,
    updated_at: Date.now(),
  };
  conversationAgentStates.set(row.conversation_id, row);
  return row;
}

export function runtimeSnapshot(): Pick<
  RuntimeSnapshot,
  | "runtimeRuns"
  | "runtimeSteps"
  | "agentRuntimeStates"
  | "conversationAgentStates"
  | "sandboxSessions"
  | "sandboxSnapshots"
  | "sandboxArtifacts"
  | "runtimeEvents"
  | "agentInstances"
  | "collaborationMessages"
  | "contextCheckpoints"
> {
  return {
    runtimeRuns: listRuntimeRuns(),
    runtimeSteps: listRuntimeSteps(),
    agentRuntimeStates: listagentRuntimeStates(),
    conversationAgentStates: listConversationAgentStates(),
    sandboxSessions: listSandboxSessions(),
    sandboxSnapshots: listSandboxSnapshots(),
    sandboxArtifacts: listSandboxArtifacts(),
    runtimeEvents: listRuntimeEvents(),
    agentInstances: listAgentInstances(),
    collaborationMessages: listCollaborationMessages(),
    contextCheckpoints: listContextCheckpoints(),
  };
}

export function listMemories(options?: {
  includeInactive?: boolean;
  limit?: number;
}): MemoryRecord[] {
  const query = getDb()
    .select()
    .from(memories)
    .where(options?.includeInactive ? undefined : eq(memories.status, "active"))
    .orderBy(desc(memories.pinned), desc(memories.salience), desc(memories.updated_at));
  return options?.limit && options.limit > 0 ? query.limit(options.limit).all() : query.all();
}

export function saveMemory(memory: MemoryRecord): void {
  const row = normalizeMemoryRecord(memory);
  getDb()
    .insert(memories)
    .values(row)
    .onConflictDoUpdate({
      target: memories.id,
      set: {
        scope: row.scope,
        kind: row.kind,
        title: row.title,
        content: row.content,
        agent_id: row.agent_id,
        conversation_id: row.conversation_id,
        source_run_id: row.source_run_id,
        salience: row.salience,
        pinned: row.pinned,
        confidence: row.confidence,
        origin: row.origin,
        status: row.status,
        evidence_json: row.evidence_json,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        supersedes_id: row.supersedes_id,
        updated_at: row.updated_at,
      },
    })
    .run();

  // 同步更新 Mem0 向量索引；失败不阻断主流程
  import("./mem0-service")
    .then(({ updateMemoryInVectorStore }) => updateMemoryInVectorStore(row))
    .catch((error) => {
      console.warn("[db] saveMemory vector sync failed:", error);
    });
}

export function deleteMemory(id: string): void {
  getDb().delete(memories).where(eq(memories.id, id)).run();

  // 同步删除 Mem0 向量索引；失败不阻断主流程
  import("./mem0-service")
    .then(({ deleteMemoryFromVectorStore }) => deleteMemoryFromVectorStore(id))
    .catch((error) => {
      console.warn("[db] deleteMemory vector sync failed:", error);
    });
}

export function getMemoryById(id: string): MemoryRecord | null {
  return getDb().select().from(memories).where(eq(memories.id, id)).get() ?? null;
}

function normalizeMemoryRecord(memory: MemoryRecord): MemoryRecord {
  const now = Date.now();
  return {
    id: memory.id || randomUUID(),
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    agent_id: memory.agent_id ?? null,
    conversation_id: memory.conversation_id ?? null,
    source_run_id: memory.source_run_id ?? null,
    salience: clampNumber(memory.salience ?? 50, 1, 100),
    pinned: memory.pinned ? 1 : 0,
    confidence: clampNumber(memory.confidence ?? DEFAULT_MEMORY_CONFIDENCE, 1, 100),
    origin: memory.origin ?? DEFAULT_MEMORY_ORIGIN,
    status: memory.status ?? DEFAULT_MEMORY_STATUS,
    evidence_json: normalizeJsonArrayText(memory.evidence_json),
    last_used_at: memory.last_used_at ?? null,
    expires_at: memory.expires_at ?? null,
    supersedes_id: memory.supersedes_id ?? null,
    created_at: memory.created_at ?? now,
    updated_at: now,
  };
}

function clampNumber(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function normalizeJsonArrayText(raw: string | undefined): string {
  if (!raw) return "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? JSON.stringify(parsed.slice(-20)) : "[]";
  } catch {
    return "[]";
  }
}

export function markMemoriesUsed(ids: string[]): number {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const now = Date.now();
  let updated = 0;
  const db = getDb();
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const result = tx
        .update(memories)
        .set({ last_used_at: now, updated_at: now })
        .where(eq(memories.id, id))
        .run();
      updated += result.changes;
    }
  });
  return updated;
}

export function queueMemoryJob(input: {
  kind: MemoryJobKind;
  conversationId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  payload?: unknown;
  scheduledAt?: number;
}): MemoryJob {
  const now = Date.now();
  const scheduledAt = input.scheduledAt ?? now;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const existing = getDb()
    .select()
    .from(memoryJobs)
    .where(
      and(
        eq(memoryJobs.kind, input.kind),
        eq(memoryJobs.status, "queued"),
        input.conversationId === undefined || input.conversationId === null
          ? isNull(memoryJobs.conversation_id)
          : eq(memoryJobs.conversation_id, input.conversationId),
        input.agentId === undefined || input.agentId === null
          ? isNull(memoryJobs.agent_id)
          : eq(memoryJobs.agent_id, input.agentId),
      ),
    )
    .orderBy(asc(memoryJobs.scheduled_at))
    .get();

  if (existing) {
    getDb()
      .update(memoryJobs)
      .set({
        run_id: input.runId ?? existing.run_id,
        payload_json: payloadJson,
        scheduled_at: Math.min(existing.scheduled_at, scheduledAt),
        updated_at: now,
      })
      .where(eq(memoryJobs.id, existing.id))
      .run();
    return getMemoryJobById(existing.id)!;
  }

  const row: NewMemoryJob = {
    id: randomUUID(),
    kind: input.kind,
    status: "queued",
    conversation_id: input.conversationId ?? null,
    agent_id: input.agentId ?? DEFAULT_AGENT_ID,
    run_id: input.runId ?? null,
    payload_json: payloadJson,
    attempts: 0,
    last_error: null,
    scheduled_at: scheduledAt,
    started_at: null,
    finished_at: null,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(memoryJobs).values(row).run();
  return row as MemoryJob;
}

export function claimNextMemoryJob(now = Date.now()): MemoryJob | null {
  const row = getDb()
    .select()
    .from(memoryJobs)
    .where(eq(memoryJobs.status, "queued"))
    .orderBy(asc(memoryJobs.scheduled_at), asc(memoryJobs.created_at))
    .all()
    .find((job) => job.scheduled_at <= now);
  if (!row) return null;
  const startedAt = Date.now();
  getDb()
    .update(memoryJobs)
    .set({
      status: "running",
      attempts: row.attempts + 1,
      started_at: startedAt,
      updated_at: startedAt,
    })
    .where(eq(memoryJobs.id, row.id))
    .run();
  return getMemoryJobById(row.id);
}

export function finishMemoryJob(
  id: string,
  status: Extract<MemoryJobStatus, "succeeded" | "failed" | "cancelled">,
  error?: string | null,
): MemoryJob | null {
  const existing = getMemoryJobById(id);
  if (!existing) return null;
  const now = Date.now();
  const shouldRetry =
    status === "failed" && existing.attempts < MEMORY_JOB_MAX_ATTEMPTS && error != null;
  getDb()
    .update(memoryJobs)
    .set({
      status: shouldRetry ? "queued" : status,
      last_error: error ?? null,
      scheduled_at: shouldRetry
        ? now + Math.min(existing.attempts + 1, 5) * 15_000
        : existing.scheduled_at,
      finished_at: shouldRetry ? null : now,
      updated_at: now,
    })
    .where(eq(memoryJobs.id, id))
    .run();
  return getMemoryJobById(id);
}

export function getMemoryJobById(id: string): MemoryJob | null {
  return getDb().select().from(memoryJobs).where(eq(memoryJobs.id, id)).get() ?? null;
}

export function listMemoryJobs(limit = 100): MemoryJob[] {
  return getDb().select().from(memoryJobs).orderBy(desc(memoryJobs.updated_at)).limit(limit).all();
}

export function deleteMemoriesBatch(ids: string[]): number {
  if (ids.length === 0) return 0;
  const uniqueIds = [...new Set(ids)];
  const db = getDb();
  let deleted = 0;
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const result = tx.delete(memories).where(eq(memories.id, id)).run();
      deleted += result.changes;
    }
  });

  // 事务提交后同步删除向量索引
  import("./mem0-service")
    .then(({ deleteMemoryFromVectorStore }) =>
      Promise.all(uniqueIds.map((id) => deleteMemoryFromVectorStore(id))),
    )
    .catch((error) => {
      console.warn("[db] deleteMemoriesBatch vector sync failed:", error);
    });

  return deleted;
}

export function updateMemoriesBatch(
  ids: string[],
  patch: Partial<Pick<MemoryRecord, "pinned" | "salience" | "kind" | "scope">>,
): number {
  if (ids.length === 0) return 0;
  const setPatch: Partial<Record<string, unknown>> = {};
  if (patch.pinned !== undefined) setPatch.pinned = patch.pinned;
  if (patch.salience !== undefined) setPatch.salience = patch.salience;
  if (patch.kind !== undefined) setPatch.kind = patch.kind;
  if (patch.scope !== undefined) setPatch.scope = patch.scope;
  if (Object.keys(setPatch).length === 0) return 0;
  setPatch.updated_at = Date.now();

  const uniqueIds = [...new Set(ids)];
  const db = getDb();
  let updated = 0;
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const result = tx.update(memories).set(setPatch).where(eq(memories.id, id)).run();
      updated += result.changes;
    }
  });

  // 事务提交后同步更新向量索引（仅 title/content 变更时才需要，但批量 patch 不含这两个字段，
  // 仍调用 update 以刷新元数据/嵌入；实际内容未变时 Mem0 内部效果有限）
  import("./mem0-service")
    .then(async ({ updateMemoryInVectorStore }) => {
      for (const id of uniqueIds) {
        const memory = getMemoryById(id);
        if (memory) await updateMemoryInVectorStore(memory);
      }
    })
    .catch((error) => {
      console.warn("[db] updateMemoriesBatch vector sync failed:", error);
    });

  return updated;
}

export async function searchMemories(filters: {
  query?: string;
  scope?: MemoryScope | null;
  kind?: MemoryKind | null;
  status?: MemoryStatus | null;
  agentId?: string | null;
  conversationId?: string | null;
  pinned?: boolean | null;
  sortBy?: "salience" | "updated" | "created";
  sortOrder?: "asc" | "desc";
  limit?: number;
}): Promise<MemoryRecord[]> {
  const {
    query,
    scope,
    kind,
    status = "active",
    agentId,
    conversationId,
    pinned,
    sortBy = "salience",
    sortOrder = "desc",
    limit,
  } = filters;

  if (query?.trim()) {
    const { searchMemoriesSemantic } = await import("./mem0-service");
    const semantic = await searchMemoriesSemantic(
      query.trim(),
      agentId ?? null,
      conversationId ?? undefined,
      limit ?? 50,
    );
    const filtered = semantic.filter((m) =>
      matchesMemoryFilters(m, { scope, kind, status, agentId, conversationId, pinned }),
    );
    if (filtered.length > 0) return filtered;
  }

  return searchMemoriesSqlite({
    query: query?.trim().toLowerCase(),
    scope,
    kind,
    status,
    agentId,
    conversationId,
    pinned,
    sortBy,
    sortOrder,
    limit,
  });
}

function matchesMemoryFilters(
  memory: MemoryRecord,
  filters: {
    scope?: MemoryScope | null;
    kind?: MemoryKind | null;
    status?: MemoryStatus | null;
    agentId?: string | null;
    conversationId?: string | null;
    pinned?: boolean | null;
  },
  query?: string,
): boolean {
  if (filters.scope && memory.scope !== filters.scope) return false;
  if (filters.kind && memory.kind !== filters.kind) return false;
  if (filters.status && (memory.status ?? "active") !== filters.status) return false;
  if (
    filters.agentId !== undefined &&
    filters.agentId !== null &&
    memory.agent_id !== filters.agentId
  )
    return false;
  if (
    filters.conversationId !== undefined &&
    filters.conversationId !== null &&
    memory.conversation_id !== filters.conversationId
  )
    return false;
  if (
    filters.pinned !== undefined &&
    filters.pinned !== null &&
    (memory.pinned === 1) !== filters.pinned
  )
    return false;
  if (query) {
    const text = `${memory.title} ${memory.content}`.toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

function searchMemoriesSqlite(filters: {
  query?: string;
  scope?: MemoryScope | null;
  kind?: MemoryKind | null;
  status?: MemoryStatus | null;
  agentId?: string | null;
  conversationId?: string | null;
  pinned?: boolean | null;
  sortBy?: "salience" | "updated" | "created";
  sortOrder?: "asc" | "desc";
  limit?: number;
}): MemoryRecord[] {
  const {
    query,
    scope,
    kind,
    status = "active",
    agentId,
    conversationId,
    pinned,
    sortBy = "salience",
    sortOrder = "desc",
    limit,
  } = filters;

  const conditions: (ReturnType<typeof eq> | ReturnType<typeof and>)[] = [];
  if (scope) conditions.push(eq(memories.scope, scope));
  if (kind) conditions.push(eq(memories.kind, kind));
  if (status) conditions.push(eq(memories.status, status));
  if (agentId !== undefined && agentId !== null) conditions.push(eq(memories.agent_id, agentId));
  if (conversationId !== undefined && conversationId !== null)
    conditions.push(eq(memories.conversation_id, conversationId));
  if (pinned !== undefined && pinned !== null) conditions.push(eq(memories.pinned, pinned ? 1 : 0));
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(or(like(memories.title, pattern), like(memories.content, pattern)));
  }

  const sortColumn =
    sortBy === "updated"
      ? memories.updated_at
      : sortBy === "created"
        ? memories.created_at
        : memories.salience;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const queryBuilder = getDb()
    .select()
    .from(memories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memories.pinned), orderFn(sortColumn));

  return limit !== undefined && limit > 0 ? queryBuilder.limit(limit).all() : queryBuilder.all();
}

export function listWorkflows(): WorkflowDefinition[] {
  return listWorkflowDefinitions();
}

export function createWorkflowRun(input: {
  id?: string;
  workflow_id: string;
  runtime_run_id?: string | null;
  status: RuntimeStatus | "waiting_handoff";
  input_json?: string | null;
  output_json?: string | null;
  started_at?: number;
  finished_at?: number | null;
}): WorkflowRun {
  return createWorkflowRunRecord({
    id: input.id,
    workflowId: input.workflow_id,
    runtimeRunId: input.runtime_run_id ?? null,
    status: input.status,
    inputJson: input.input_json ?? null,
    outputJson: input.output_json ?? null,
    startedAt: input.started_at,
    finishedAt: input.finished_at ?? null,
    triggeredBy: "manual",
  });
}

export function updateWorkflowRun(
  id: string,
  patch: Partial<Pick<WorkflowRun, "status" | "output_json" | "finished_at">>,
): WorkflowRun | null {
  return updateWorkflowRunRecord(id, {
    status: patch.status as WorkflowRun["status"] | undefined,
    outputJson: patch.output_json === undefined ? undefined : patch.output_json,
    finishedAt: patch.finished_at === undefined ? undefined : patch.finished_at,
  });
}

/**
 * 暴露给 IPC / server 的"只读"集合，配合 workflow-runs.ts 使用。
 * 旧代码仍可直接 import 这两个函数；新代码优先使用 workflow-runs.ts 的具名导出。
 */
export {
  getWorkflowDefinition,
  listWorkflowDefinitions,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  deleteWorkflowDefinition,
  getWorkflowRun,
  getWorkflowRunDetail,
  listWorkflowStepRuns,
  listWorkflowTransitions,
  listWorkflowRuns,
  createWorkflowRunRecord,
  updateWorkflowRunRecord,
  createWorkflowStepRun,
  updateWorkflowStepRun,
  recordWorkflowTransition,
  upgradeLegacyWorkflows,
} from "./workflow-runs";

export function listToolServers(kind?: "mcp" | "local" | "sandbox"): ToolServer[] {
  const where = kind
    ? and(eq(toolServers.kind, kind), isNull(toolServers.deleted_at))
    : isNull(toolServers.deleted_at);
  const rows = getDb().select().from(toolServers).where(where).all();
  return rows.map(toToolServer);
}

export function listMcpServers(): ToolServer[] {
  return listToolServers("mcp");
}

export function getToolServer(id: string): ToolServer | null {
  const row = getDb()
    .select()
    .from(toolServers)
    .where(and(eq(toolServers.id, id), isNull(toolServers.deleted_at)))
    .get();
  return row ? toToolServer(row) : null;
}

export const getMcpServer = getToolServer;

export function createToolServer(input: ToolServerInput): ToolServer {
  const now = Date.now();
  const row = normalizeToolServerInput(randomUUID(), input, null, now);
  getDb().insert(toolServers).values(row).run();
  insertRuntimeEvent({
    kind: "tool",
    title: "Tool server created",
    status: "succeeded",
    owner_type: "server",
    owner_id: row.id,
    detail: { serverId: row.id, transport: row.transport },
  });
  return toToolServer(row as DbToolServer);
}

export const createMcpServer = createToolServer;

export function updateToolServer(id: string, input: Partial<ToolServerInput>): ToolServer {
  const existing = getRequiredToolServer(id);
  const now = Date.now();
  const row = normalizeToolServerInput(id, input, existing, now);
  getDb().update(toolServers).set(row).where(eq(toolServers.id, id)).run();
  return getToolServer(id)!;
}

export const updateMcpServer = updateToolServer;

export function deleteToolServer(id: string): void {
  const now = Date.now();
  getDb()
    .update(toolServers)
    .set({
      enabled: 0,
      status: "disabled",
      deleted_at: now,
      purge_after_at: now + TRASH_RETENTION_MS,
      updated_at: now,
    })
    .where(eq(toolServers.id, id))
    .run();
}

export const deleteMcpServer = deleteToolServer;

export function listDeletedToolServers(kind?: "mcp" | "local" | "sandbox"): ToolServer[] {
  const where = kind
    ? and(eq(toolServers.kind, kind), isNotNull(toolServers.deleted_at))
    : isNotNull(toolServers.deleted_at);
  return getDb()
    .select()
    .from(toolServers)
    .where(where)
    .orderBy(desc(toolServers.deleted_at))
    .all()
    .map(toToolServer);
}

export function restoreToolServer(id: string): ToolServer {
  getDb()
    .update(toolServers)
    .set({
      deleted_at: null,
      purge_after_at: null,
      updated_at: Date.now(),
    })
    .where(eq(toolServers.id, id))
    .run();
  return getRequiredToolServer(id);
}

export function permanentlyDeleteToolServer(id: string): void {
  getDb().delete(toolServers).where(eq(toolServers.id, id)).run();
  deleteToolSecretsForOwner("server", id);
}

export function permanentlyDeleteToolServers(ids: string[]): number {
  let deleted = 0;
  for (const id of ids) {
    const result = getDb().delete(toolServers).where(eq(toolServers.id, id)).run();
    deleteToolSecretsForOwner("server", id);
    deleted += result.changes;
  }
  return deleted;
}

export function purgeExpiredDeletedToolServers(now = Date.now()): number {
  const expired = getDb()
    .select()
    .from(toolServers)
    .where(and(isNotNull(toolServers.deleted_at), lt(toolServers.purge_after_at, now)))
    .all();
  return permanentlyDeleteToolServers(expired.map((server) => server.id));
}

export function setToolServerEnabled(id: string, enabled: boolean): ToolServer {
  getDb()
    .update(toolServers)
    .set({
      enabled: enabled ? 1 : 0,
      status: enabled ? "unknown" : "disabled",
      updated_at: Date.now(),
    })
    .where(eq(toolServers.id, id))
    .run();
  return getToolServer(id)!;
}

export const setMcpServerEnabled = setToolServerEnabled;

export function updateToolServerStatus(
  id: string,
  patch: Pick<Partial<ToolServer>, "status" | "last_error" | "last_connected_at">,
): ToolServer | null {
  const existing = getToolServer(id);
  if (!existing) return null;
  getDb()
    .update(toolServers)
    .set({
      status: patch.status ?? existing.status,
      last_error: patch.last_error === undefined ? existing.last_error : patch.last_error,
      last_connected_at:
        patch.last_connected_at === undefined
          ? existing.last_connected_at
          : patch.last_connected_at,
      updated_at: Date.now(),
    })
    .where(eq(toolServers.id, id))
    .run();
  return getToolServer(id);
}

export const updateMcpServerStatus = updateToolServerStatus;

export function listToolRecords(kind?: "builtin" | "mcp" | "skill" | "sandbox"): ToolRecord[] {
  const where = kind
    ? and(eq(tools.kind, kind), isNull(tools.deleted_at))
    : isNull(tools.deleted_at);
  const rows = getDb().select().from(tools).where(where).all();
  const activeServerIds = new Set(listToolServers().map((server) => server.id));
  return rows
    .filter(
      (row) => row.kind !== "mcp" || (row.server_id ? activeServerIds.has(row.server_id) : false),
    )
    .map(toToolRecord);
}

export function listMcpTools(serverId?: string): ToolRecord[] {
  if (serverId && !getToolServer(serverId)) return [];
  const rows = serverId
    ? getDb()
        .select()
        .from(tools)
        .where(and(eq(tools.kind, "mcp"), eq(tools.server_id, serverId), isNull(tools.deleted_at)))
        .all()
    : getDb()
        .select()
        .from(tools)
        .where(and(eq(tools.kind, "mcp"), isNull(tools.deleted_at)))
        .all();
  const activeServerIds = new Set(listMcpServers().map((server) => server.id));
  return rows
    .filter((row) => row.server_id && activeServerIds.has(row.server_id))
    .map(toToolRecord);
}

export function getMcpToolByReference(serverId: string, toolName: string): ToolRecord | null {
  if (!getToolServer(serverId)) return null;
  const reference = `mcp:${serverId}:${toolName}`;
  const row = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.reference, reference), isNull(tools.deleted_at)))
    .get();
  return row ? toToolRecord(row) : null;
}

export function upsertMcpToolDefinitions(
  serverId: string,
  definitions: Array<{
    name: string;
    title?: string | null;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>,
): ToolRecord[] {
  const now = Date.now();
  for (const definition of definitions) {
    const name = normalizeRequiredText(definition.name, "tool name", 120);
    const id = toolRowId(serverId, name);
    const reference = `mcp:${serverId}:${name}`;
    const existing = getDb().select().from(tools).where(eq(tools.id, id)).get();
    const row: NewToolRecord = {
      id,
      server_id: serverId,
      name,
      title: definition.title ?? null,
      description: definition.description ?? "",
      kind: "mcp",
      category: "mcp",
      reference,
      enabled: existing?.enabled ?? 1,
      auto_use: existing?.auto_use ?? 0,
      requires_approval: existing?.requires_approval ?? 1,
      input_schema_json: JSON.stringify(definition.inputSchema ?? {}),
      output_schema_json: JSON.stringify(definition.outputSchema ?? {}),
      config_json: existing?.config_json ?? "{}",
      steps_json: "[]",
      workflow_id: null,
      trigger_keywords_json: "[]",
      tags_json: "[]",
      discovered_at: existing?.discovered_at ?? now,
      last_run_at: existing?.last_run_at ?? null,
      updated_at: now,
      deleted_at: null,
      purge_after_at: null,
    };
    getDb()
      .insert(tools)
      .values(row)
      .onConflictDoUpdate({
        target: tools.id,
        set: {
          title: row.title,
          description: row.description,
          input_schema_json: row.input_schema_json,
          output_schema_json: row.output_schema_json,
          updated_at: row.updated_at,
        },
      })
      .run();
  }
  return listMcpTools(serverId);
}

export function updateToolRecord(
  id: string,
  patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
): ToolRecord {
  const existing = getRequiredToolRecord(id);
  getDb()
    .update(tools)
    .set({
      enabled: normalizeBooleanNumber(patch.enabled ?? existing.enabled),
      auto_use: normalizeBooleanNumber(patch.auto_use ?? existing.auto_use),
      requires_approval: normalizeBooleanNumber(
        patch.requires_approval ?? existing.requires_approval,
      ),
      updated_at: Date.now(),
    })
    .where(eq(tools.id, id))
    .run();
  return toToolRecord(getRequiredToolRecord(id));
}

export const updateMcpTool = updateToolRecord;

export function listSkillTools(): ToolSkill[] {
  return getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNull(tools.deleted_at)))
    .orderBy(desc(tools.updated_at))
    .all()
    .map(toToolSkill);
}

export function getSkillTool(id: string): ToolSkill | null {
  const row = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.id, id), eq(tools.kind, "skill"), isNull(tools.deleted_at)))
    .get();
  return row ? toToolSkill(row) : null;
}

export function createSkillTool(input: ToolSkillInput): ToolSkill {
  const now = Date.now();
  const row = normalizeSkillToolInput(randomUUID(), input, null, now);
  getDb().insert(tools).values(row).run();
  ensureSkillWorkflow(row);
  insertRuntimeEvent({
    kind: "tool",
    title: "Skill tool created",
    status: "succeeded",
    tool_id: row.id,
    owner_type: "tool",
    owner_id: row.id,
  });
  return toToolSkill(getRequiredToolRecord(row.id));
}

export function updateSkillTool(id: string, input: Partial<ToolSkillInput>): ToolSkill {
  const existing = getRequiredToolRecord(id);
  const now = Date.now();
  const row = normalizeSkillToolInput(id, input, existing, now);
  getDb().update(tools).set(row).where(eq(tools.id, id)).run();
  ensureSkillWorkflow(row);
  return toToolSkill(getRequiredToolRecord(id));
}

export function deleteSkillTool(id: string): void {
  const now = Date.now();
  getDb()
    .update(tools)
    .set({
      enabled: 0,
      deleted_at: now,
      purge_after_at: now + TRASH_RETENTION_MS,
      updated_at: now,
    })
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
}

export function listDeletedSkillTools(): ToolSkill[] {
  return getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNotNull(tools.deleted_at)))
    .orderBy(desc(tools.deleted_at))
    .all()
    .map(toToolSkill);
}

export function restoreSkillTool(id: string): ToolSkill {
  getDb()
    .update(tools)
    .set({ deleted_at: null, purge_after_at: null, updated_at: Date.now() })
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
  return toToolSkill(getRequiredToolRecord(id));
}

export function permanentlyDeleteSkillTool(id: string): void {
  getDb()
    .delete(tools)
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
  deleteToolSecretsForOwner("tool", id);
}

export function permanentlyDeleteSkillTools(ids: string[]): number {
  let deleted = 0;
  for (const id of ids) {
    const result = getDb()
      .delete(tools)
      .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
      .run();
    deleteToolSecretsForOwner("tool", id);
    deleted += result.changes;
  }
  return deleted;
}

export function purgeExpiredDeletedSkillTools(now = Date.now()): number {
  const expired = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNotNull(tools.deleted_at), lt(tools.purge_after_at, now)))
    .all();
  return permanentlyDeleteSkillTools(expired.map((skill) => skill.id));
}

export function setSkillToolEnabled(id: string, enabled: boolean): ToolSkill {
  getDb()
    .update(tools)
    .set({ enabled: enabled ? 1 : 0, updated_at: Date.now() })
    .where(eq(tools.id, id))
    .run();
  return toToolSkill(getRequiredToolRecord(id));
}

export function markSkillToolRun(id: string, at = Date.now()): void {
  getDb().update(tools).set({ last_run_at: at, updated_at: at }).where(eq(tools.id, id)).run();
}

export function setToolSecret(input: ToolSecretInput): ToolSecretPublic {
  const ownerType = normalizeSecretOwnerType(input.ownerType);
  const key = normalizeSecretKey(input.key);
  const ownerId = normalizeRequiredText(input.ownerId, "owner id", 160);
  const id = toolSecretId(ownerType, ownerId, key);
  const row: NewToolSecret = {
    id,
    owner_type: ownerType,
    owner_id: ownerId,
    key,
    label: input.label?.trim() || key,
    ciphertext: JSON.stringify(encrypt(input.value)),
    updated_at: Date.now(),
  };
  getDb()
    .insert(toolSecrets)
    .values(row)
    .onConflictDoUpdate({
      target: toolSecrets.id,
      set: { label: row.label, ciphertext: row.ciphertext, updated_at: row.updated_at },
    })
    .run();
  return publicToolSecret(row as DbToolSecret);
}

export function listToolSecretsPublic(
  ownerType?: ToolSecretOwnerType,
  ownerId?: string,
): ToolSecretPublic[] {
  const normalizedOwnerType = ownerType ? normalizeSecretOwnerType(ownerType) : null;
  const rows =
    normalizedOwnerType && ownerId
      ? getDb()
          .select()
          .from(toolSecrets)
          .where(
            and(eq(toolSecrets.owner_type, normalizedOwnerType), eq(toolSecrets.owner_id, ownerId)),
          )
          .all()
      : getDb().select().from(toolSecrets).all();
  return rows.map(publicToolSecret);
}

export function deleteToolSecret(id: string): void {
  getDb().delete(toolSecrets).where(eq(toolSecrets.id, id)).run();
}

export function deleteToolSecretsForOwner(ownerType: ToolSecretOwnerType, ownerId: string): void {
  const normalizedOwnerType = normalizeSecretOwnerType(ownerType);
  getDb()
    .delete(toolSecrets)
    .where(and(eq(toolSecrets.owner_type, normalizedOwnerType), eq(toolSecrets.owner_id, ownerId)))
    .run();
}

export function getToolSecretValue(
  ownerType: ToolSecretOwnerType,
  ownerId: string,
  key: string,
): string | null {
  const normalizedOwnerType = normalizeSecretOwnerType(ownerType);
  const row = getDb()
    .select()
    .from(toolSecrets)
    .where(
      and(
        eq(toolSecrets.owner_type, normalizedOwnerType),
        eq(toolSecrets.owner_id, ownerId),
        eq(toolSecrets.key, normalizeSecretKey(key)),
      ),
    )
    .get();
  if (!row) return null;
  try {
    return decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
    return null;
  }
}

export function resolveToolSecretReferences(
  ownerType: ToolSecretOwnerType,
  ownerId: string,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const secretKey = parseSecretReference(value);
      return [key, secretKey ? (getToolSecretValue(ownerType, ownerId, secretKey) ?? "") : value];
    }),
  );
}

export function getToolsSnapshot(): ToolsSnapshot {
  return {
    toolServers: listToolServers(),
    toolRecords: listToolRecords(),
    skills: listSkillTools(),
    secrets: listToolSecretsPublic(),
    workflowRuns: listWorkflowRuns(),
    runtimeEvents: listRuntimeEvents(),
  };
}

let desktopPetIdleSince = Date.now();
let desktopPetHadActivity = false;

export function listInteractionProfiles(): InteractionProfile[] {
  ensureDesktopPetProfile();
  return getDb().select().from(interactionProfiles).orderBy(interactionProfiles.kind).all();
}

export function isDesktopPetEnabled(): boolean {
  return ensureDesktopPetProfile().enabled !== 0;
}

export function getDesktopPetSnapshot(): DesktopPetSnapshot {
  const profile = ensureDesktopPetProfile();
  const config = normalizeDesktopPetConfig(profile.config_json);
  const resolution = resolveDesktopPetActivity(listRuntimeRuns(), config.acknowledgedRunIds);
  const now = Date.now();
  let activity = resolution.activity;
  if (activity.kind === "idle") {
    if (desktopPetHadActivity) desktopPetIdleSince = now;
    desktopPetHadActivity = false;
    activity = applyDesktopPetIdleTimeout(activity, desktopPetIdleSince, now);
  } else {
    desktopPetHadActivity = true;
    desktopPetIdleSince = now;
  }
  const pet = resolveDesktopPet(config.selectedPet);
  return {
    profile,
    enabled: profile.enabled === 1,
    config,
    pet,
    activity,
    pendingActivityCount: resolution.pendingCount,
    assetError:
      pet?.error ??
      (profile.enabled === 1 && (!pet || !pet.available)
        ? "Pet asset is not available yet."
        : null),
  };
}

export function setDesktopPetEnabled(enabled: boolean): DesktopPetSnapshot {
  updateDesktopPetProfile({ enabled: enabled ? 1 : 0 });
  return getDesktopPetSnapshot();
}

export function updateDesktopPetConfig(patch: DesktopPetConfigPatch): DesktopPetSnapshot {
  const profile = ensureDesktopPetProfile();
  const current = normalizeDesktopPetConfig(profile.config_json);
  updateDesktopPetProfile({ config_json: JSON.stringify(mergeDesktopPetConfig(current, patch)) });
  return getDesktopPetSnapshot();
}

export function acknowledgeDesktopPetActivity(runId: string): DesktopPetSnapshot {
  if (!runId.trim()) return getDesktopPetSnapshot();
  const profile = ensureDesktopPetProfile();
  const current = normalizeDesktopPetConfig(profile.config_json);
  const acknowledgedRunIds = [...new Set([...current.acknowledgedRunIds, runId])].slice(-100);
  updateDesktopPetProfile({
    config_json: JSON.stringify(mergeDesktopPetConfig(current, { acknowledgedRunIds })),
  });
  return getDesktopPetSnapshot();
}

export function getSyncState(): SyncState {
  return ensureSyncProfile();
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    agents: listAgents(),
    runtimeRuns: listRuntimeRuns(),
    runtimeSteps: listRuntimeSteps(),
    agentRuntimeStates: listagentRuntimeStates(),
    conversationAgentStates: listConversationAgentStates(),
    sandboxSessions: listSandboxSessions(),
    sandboxSnapshots: listSandboxSnapshots(),
    sandboxArtifacts: listSandboxArtifacts(),
    memories: listMemories(),
    workflows: listWorkflows(),
    workflowRuns: listWorkflowRuns(),
    runtimeEvents: listRuntimeEvents(),
    agentInstances: listAgentInstances(),
    collaborationMessages: listCollaborationMessages(),
    contextCheckpoints: listContextCheckpoints(),
    interactionProfiles: listInteractionProfiles(),
    syncState: getSyncState(),
  };
}

export function updateVoidLearningState(input: {
  status: AgentRuntimeStatus;
  lastLearningAt?: number;
  lastError?: string | null;
}): void {
  upsertAgentRuntimeState({
    agent_id: DEFAULT_AGENT_ID,
    status: input.status,
    last_learning_at: input.lastLearningAt,
    last_error: input.lastError,
  });
}

export async function buildAgentSystemPrompt(
  agentId?: string | null,
  conversationId?: string,
): Promise<string> {
  const agent = getAgent(agentId || DEFAULT_AGENT_ID) ?? getAgent(DEFAULT_AGENT_ID);
  if (!agent) return "You are Paimon, a capable local AI assistant and orchestrator.";

  // 从文件层加载有界冻结快照；首次启动时从 agent.instructions 初始化
  const { prepareInnerContext } = await import("./agent-inner-context");
  const innerContext = await prepareInnerContext({ agent, conversationId: conversationId ?? null });
  const fileBlock = innerContext.promptBlock;
  // 可选：语义搜索补充最近 3 条相关记忆
  const recentMessages = conversationId ? listMessages(conversationId) : [];
  const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");
  let extraMemories = "";
  if (lastUserMsg) {
    const query = extractMessageTextFromContent(lastUserMsg.content).slice(0, 200);
    const { searchMemoriesSemantic } = await import("./mem0-service");
    const hits = await searchMemoriesSemantic(query, agent.id, conversationId, 3);
    if (hits.length > 0) {
      extraMemories =
        "\n\nRecently relevant memories:\n" +
        hits.map((memory) => `- ${memory.title}: ${memory.content}`).join("\n");
    }
  }

  return [
    `You are ${agent.name}.`,
    `Role: ${agent.role}`,
    agent.personality ? `Personality seed: ${agent.personality}` : "",
    agent.soul_prompt ? `SOUL seed: ${agent.soul_prompt}` : "",
    fileBlock,
    extraMemories,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 从消息 content JSON 中提取纯文本（内联以避免与 agent-learning.ts 的循环依赖） */
function extractMessageTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { parts?: Array<{ type?: string; text?: string }> };
    if (!Array.isArray(parsed.parts)) return content;
    return parsed.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  } catch {
    return content;
  }
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
  getDb()
    .insert(sandboxSessions)
    .values(input)
    .onConflictDoUpdate({
      target: sandboxSessions.id,
      set: {
        conversation_id: input.conversation_id,
        run_id: input.run_id,
        agent_id: input.agent_id,
        root_path: input.root_path,
        isolation_mode: input.isolation_mode,
        status: input.status,
        docker_available: input.docker_available,
        updated_at: input.updated_at,
      },
    })
    .run();
  return getDb().select().from(sandboxSessions).where(eq(sandboxSessions.id, input.id)).get()!;
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
  input: Omit<NewSandboxSnapshot, "id" | "created_at"> & { id?: string; created_at?: number },
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
  input: Omit<NewSandboxArtifact, "id" | "created_at"> & { id?: string; created_at?: number },
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

function seedDefaults(): void {
  const now = Date.now();
  if (!getAgent(DEFAULT_AGENT_ID)) {
    const agent: DbAgentProfile = {
      id: DEFAULT_AGENT_ID,
      name: DEFAULT_ROOT_AGENT_SEED.name,
      role: DEFAULT_ROOT_AGENT_SEED.role,
      instructions: DEFAULT_ROOT_AGENT_SEED.soul_prompt,
      persona: DEFAULT_ROOT_AGENT_SEED.personality,
      description: DEFAULT_ROOT_AGENT_SEED.description,
      avatar: DEFAULT_ROOT_AGENT_SEED.avatar,
      status: "active",
      kind: "main",
      parent_agent_id: null,
      locked: 1,
      enabled: 1,
      model_ref: null,
      voice: null,
      created_at: now,
      updated_at: now,
    };
    getDb().insert(agents).values(agent).run();
    getDb().insert(agentPolicies).values(defaultAgentPolicy(DEFAULT_AGENT_ID, now)).run();
  }

  for (const seed of DEFAULT_CHILD_AGENT_SEEDS) {
    const id = seed.id;
    if (!getAgent(id)) {
      const normalized = normalizeAgentInput(id, seed, null, now);
      getDb().insert(agents).values(normalized.agent).run();
      getDb().insert(agentPolicies).values(normalized.policy).run();
    }
  }

  if (listWorkflows().length === 0) {
    getDb()
      .insert(workflows)
      .values(
        DEFAULT_WORKFLOW_SEEDS.map((seed) => ({
          id: seed.id,
          name: seed.name,
          description: seed.description,
          status: seed.status,
          steps_json: JSON.stringify(seed.steps),
          trigger: seed.trigger,
          created_at: now,
          updated_at: now,
        })),
      )
      .run();
  }

  seedBuiltinTools(now);
  ensureDesktopPetProfile();
  ensureSyncProfile();
  ensureAllagentRuntimeStates();
}

function seedBuiltinTools(now: number): void {
  for (const seed of DEFAULT_BUILTIN_TOOL_SEEDS) {
    const existing = getDb().select().from(tools).where(eq(tools.id, seed.id)).get();
    if (existing) continue;
    getDb()
      .insert(tools)
      .values({
        id: seed.id,
        server_id: null,
        name: seed.id,
        title: seed.title,
        description: seed.description,
        kind: seed.category === "sandbox" ? "sandbox" : "builtin",
        category: seed.category,
        reference: seed.id,
        enabled: 1,
        auto_use: seed.defaultAuto,
        requires_approval: seed.requiresApproval,
        input_schema_json: "{}",
        output_schema_json: "{}",
        config_json: "{}",
        steps_json: "[]",
        workflow_id: null,
        trigger_keywords_json: "[]",
        tags_json: "[]",
        discovered_at: now,
        last_run_at: null,
        updated_at: now,
        deleted_at: null,
        purge_after_at: null,
      })
      .run();
  }
}

function messageToDb(msg: MessageRow): {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content_json: string;
  metadata_json: string;
  created_at: number;
} {
  return {
    id: msg.id,
    conversation_id: msg.conversation_id,
    role: msg.role,
    content_json: msg.content_json ?? msg.content,
    metadata_json: msg.metadata_json ?? "{}",
    created_at: msg.created_at,
  };
}

function dbMessageToShared(row: {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content_json: string;
  metadata_json: string;
  created_at: number;
}): MessageRow {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content_json,
    content_json: row.content_json,
    metadata_json: row.metadata_json,
    created_at: row.created_at,
  };
}

function toAgentProfile(row: DbAgentProfile): AgentProfile {
  const policy = ensureAgentPolicy(row.id);
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    personality: row.persona,
    soul_prompt: row.instructions,
    instructions: row.instructions,
    persona: row.persona,
    avatar: row.avatar,
    status: row.status,
    kind: row.kind,
    parent_agent_id: row.parent_agent_id,
    locked: row.locked,
    enabled: row.enabled,
    tool_policy_json: policy.tool_policy_json,
    handoff_config_json: policy.routing_policy_json,
    runtime_config_json: policy.review_policy_json,
    model_ref: row.model_ref,
    voice: row.voice,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureAgentPolicy(agentId: string): DbAgentPolicy {
  const existing = getDb()
    .select()
    .from(agentPolicies)
    .where(eq(agentPolicies.agent_id, agentId))
    .get();
  if (existing) return existing;
  const row = defaultAgentPolicy(agentId, Date.now());
  getDb().insert(agentPolicies).values(row).run();
  return row as DbAgentPolicy;
}

function defaultAgentPolicy(agentId: string, now: number): DbAgentPolicy {
  return {
    agent_id: agentId,
    tool_policy_json: JSON.stringify(DEFAULT_AGENT_TOOL_POLICY),
    review_policy_json: JSON.stringify(DEFAULT_AGENT_RUNTIME_CONFIG),
    sandbox_policy_json: JSON.stringify({ mode: DEFAULT_AGENT_RUNTIME_CONFIG.sandboxPolicy }),
    routing_policy_json: JSON.stringify(DEFAULT_AGENT_HANDOFF_CONFIG),
    updated_at: now,
  };
}

function normalizeAgentInput(
  id: string,
  input: Partial<AgentInput | AgentProfile>,
  existing: DbAgentProfile | null,
  now: number,
): { agent: DbAgentProfile; policy: DbAgentPolicy } {
  const existingProfile = existing ? toAgentProfile(existing) : null;
  const name = normalizeRequiredText(input.name ?? existingProfile?.name ?? "", "name", 80);
  const role = normalizeRequiredText(input.role ?? existingProfile?.role ?? "", "role", 160);
  const description = normalizeText(input.description ?? existingProfile?.description ?? "", 500);
  const personaInput = "persona" in input ? input.persona : undefined;
  const instructionsInput = "instructions" in input ? input.instructions : undefined;
  const persona = normalizeText(
    input.personality ?? personaInput ?? existingProfile?.personality ?? "",
    2_000,
  );
  const instructions = normalizeText(
    input.soul_prompt ?? instructionsInput ?? existingProfile?.soul_prompt ?? "",
    8_000,
  );
  const toolPolicy = normalizeAgentToolPolicy(
    input.tool_policy_json ?? existingProfile?.tool_policy_json,
    DEFAULT_AGENT_TOOL_POLICY,
  );
  const handoffConfig = normalizeAgentHandoffConfig(
    input.handoff_config_json ?? existingProfile?.handoff_config_json,
    DEFAULT_AGENT_HANDOFF_CONFIG,
  );
  const runtimeConfig = normalizeAgentRuntimeConfig(
    input.runtime_config_json ?? existingProfile?.runtime_config_json,
    DEFAULT_AGENT_RUNTIME_CONFIG,
  );
  return {
    agent: {
      id,
      name,
      role,
      instructions,
      persona,
      description,
      avatar: normalizeAvatar(input.avatar ?? existingProfile?.avatar ?? name),
      status: input.status ?? existingProfile?.status ?? "draft",
      kind: existing?.kind ?? (id === DEFAULT_AGENT_ID ? "main" : "child"),
      parent_agent_id:
        existing?.parent_agent_id ?? (id === DEFAULT_AGENT_ID ? null : DEFAULT_AGENT_ID),
      locked: existing?.locked ?? (id === DEFAULT_AGENT_ID ? 1 : 0),
      enabled: normalizeBooleanNumber(input.enabled ?? existingProfile?.enabled ?? 1),
      model_ref: normalizeNullableText(input.model_ref ?? existingProfile?.model_ref ?? null, 200),
      voice: normalizeNullableText(input.voice ?? existingProfile?.voice ?? null, 80),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    },
    policy: {
      agent_id: id,
      tool_policy_json: JSON.stringify(toolPolicy),
      review_policy_json: JSON.stringify(runtimeConfig),
      sandbox_policy_json: JSON.stringify({ mode: runtimeConfig.sandboxPolicy ?? "local" }),
      routing_policy_json: JSON.stringify(handoffConfig),
      updated_at: now,
    },
  };
}

function getRequiredAgentRow(id: string): DbAgentProfile {
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get();
  if (!row) throw new Error("Agent not found.");
  return row;
}

function assertAgentEditable(agent: DbAgentProfile): void {
  if (agent.locked !== 0) throw new Error("This agent is locked.");
}

function toRuntimeRun(row: DbRuntimeRun): RuntimeRun {
  return row as RuntimeRun;
}

function toRuntimeStep(row: DbRuntimeStep): RuntimeStep {
  return row as RuntimeStep;
}

function toRuntimeEvent(row: DbRuntimeEvent): RuntimeEvent {
  return row as RuntimeEvent;
}

function toToolServer(row: DbToolServer): ToolServer {
  return row as ToolServer;
}

function toToolRecord(row: DbToolRecord): ToolRecord {
  return row as ToolRecord;
}

function toToolSkill(row: DbToolRecord): ToolSkill {
  return {
    id: row.id,
    name: row.title ?? row.name,
    description: row.description,
    category: row.category,
    enabled: row.enabled,
    auto_use: row.auto_use,
    requires_approval: row.requires_approval,
    trigger_keywords_json: row.trigger_keywords_json,
    tags_json: row.tags_json,
    config_schema_json: row.input_schema_json,
    config_json: row.config_json,
    steps_json: row.steps_json,
    workflow_id: row.workflow_id,
    last_run_at: row.last_run_at,
    created_at: row.discovered_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    purge_after_at: row.purge_after_at,
  };
}

function normalizeToolServerInput(
  id: string,
  input: Partial<ToolServerInput>,
  existing: ToolServer | null,
  now: number,
): NewToolServer {
  const transport = normalizeMcpTransport(input.transport ?? existing?.transport ?? "stdio");
  return {
    id,
    name: normalizeRequiredText(input.name ?? existing?.name ?? "", "name", 120),
    description: normalizeText(input.description ?? existing?.description ?? "", 500),
    kind: "mcp",
    transport,
    enabled: normalizeBooleanNumber(input.enabled ?? existing?.enabled ?? 1),
    auto_use: normalizeBooleanNumber(input.auto_use ?? existing?.auto_use ?? 0),
    requires_approval: normalizeBooleanNumber(
      input.requires_approval ?? existing?.requires_approval ?? 1,
    ),
    status: input.enabled === false ? "disabled" : (existing?.status ?? "unknown"),
    command: normalizeNullableText(input.command ?? existing?.command ?? null, 500),
    args_json: normalizeJsonArrayString(input.args ?? existing?.args_json ?? []),
    url: normalizeNullableText(input.url ?? existing?.url ?? null, 1_000),
    headers_json: normalizeStringRecordJson(input.headers ?? existing?.headers_json ?? {}),
    env_json: normalizeStringRecordJson(input.env ?? existing?.env_json ?? {}),
    cwd: normalizeNullableText(input.cwd ?? existing?.cwd ?? null, 1_000),
    timeout_seconds: normalizeTimeoutSeconds(
      input.timeout_seconds ?? existing?.timeout_seconds ?? 60,
    ),
    last_error: existing?.last_error ?? null,
    last_connected_at: existing?.last_connected_at ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
}

function normalizeSkillToolInput(
  id: string,
  input: Partial<ToolSkillInput>,
  existing: DbToolRecord | null,
  now: number,
): NewToolRecord {
  const name = normalizeRequiredText(
    input.name ?? existing?.title ?? existing?.name ?? "",
    "name",
    120,
  );
  const category = normalizeRequiredText(
    input.category ?? existing?.category ?? "workflow",
    "category",
    80,
  );
  const workflowId = input.workflow_id ?? existing?.workflow_id ?? skillWorkflowId(id);
  return {
    id,
    server_id: null,
    name: slugPart(name),
    title: name,
    description: normalizeText(input.description ?? existing?.description ?? "", 800),
    kind: "skill",
    category,
    reference: `skill:${id}`,
    enabled: normalizeBooleanNumber(input.enabled ?? existing?.enabled ?? 1),
    auto_use: normalizeBooleanNumber(input.auto_use ?? existing?.auto_use ?? 0),
    requires_approval: normalizeBooleanNumber(
      input.requires_approval ?? existing?.requires_approval ?? 1,
    ),
    input_schema_json: normalizeJsonObjectString(
      input.configSchema ?? existing?.input_schema_json ?? {},
    ),
    output_schema_json: "{}",
    config_json: normalizeJsonObjectString(input.config ?? existing?.config_json ?? {}),
    steps_json: normalizeSkillStepsJson(input.steps ?? existing?.steps_json ?? []),
    workflow_id: workflowId,
    trigger_keywords_json: normalizeJsonArrayString(
      input.triggerKeywords ?? existing?.trigger_keywords_json ?? [],
    ),
    tags_json: normalizeJsonArrayString(input.tags ?? existing?.tags_json ?? []),
    discovered_at: existing?.discovered_at ?? now,
    last_run_at: existing?.last_run_at ?? null,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
}

function ensureSkillWorkflow(skill: NewToolRecord): WorkflowDefinition {
  const id = skill.workflow_id ?? skillWorkflowId(skill.id);
  const existing = getDb().select().from(workflows).where(eq(workflows.id, id)).get();
  if (existing) return toWorkflowDefinition(existing);
  const now = Date.now();
  // 把 skill 的 steps_json (ToolSkillStep) 升级为 WorkflowNode
  const parsedLegacy = safeParseSteps(skill.steps_json ?? "[]");
  const nodes = parsedLegacy.map((s, idx) => buildNodeFromLegacyStep(s, idx));
  const row = {
    id,
    name: skill.title ?? skill.name,
    description: skill.description ?? "",
    status: "enabled" as const,
    nodes_json: JSON.stringify(nodes),
    entry_node_id: nodes[0]?.id ?? "",
    version: 1,
    steps_json: skill.steps_json ?? "[]",
    trigger: `skill:${skill.id}`,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(workflows).values(row).run();
  return toWorkflowDefinition(row);
}

function safeParseSteps(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getRequiredToolServer(id: string): ToolServer {
  const server = getToolServer(id);
  if (!server) throw new Error("Tool server not found.");
  return server;
}

function getRequiredToolRecord(id: string): DbToolRecord {
  const row = getDb().select().from(tools).where(eq(tools.id, id)).get();
  if (!row) throw new Error("Tool not found.");
  return row;
}

function ensureDesktopPetProfile(): InteractionProfile {
  const existing = getDb()
    .select()
    .from(interactionProfiles)
    .where(eq(interactionProfiles.id, DESKTOP_PET_PROFILE_ID))
    .get();
  if (existing) {
    const normalizedConfig = JSON.stringify(normalizeDesktopPetConfig(existing.config_json));
    if (existing.status !== "ready" || existing.config_json !== normalizedConfig) {
      getDb()
        .update(interactionProfiles)
        .set({ status: "ready", config_json: normalizedConfig, updated_at: Date.now() })
        .where(eq(interactionProfiles.id, DESKTOP_PET_PROFILE_ID))
        .run();
      return getDb()
        .select()
        .from(interactionProfiles)
        .where(eq(interactionProfiles.id, DESKTOP_PET_PROFILE_ID))
        .get() as InteractionProfile;
    }
    return existing;
  }
  const row: InteractionProfile = {
    id: DESKTOP_PET_PROFILE_ID,
    kind: "desktop_pet",
    label: "Desktop companion",
    enabled: 0,
    status: "ready",
    config_json: JSON.stringify(DEFAULT_DESKTOP_PET_CONFIG),
    updated_at: Date.now(),
  };
  getDb().insert(interactionProfiles).values(row).run();
  return row;
}

function updateDesktopPetProfile(
  patch: Partial<Pick<InteractionProfile, "enabled" | "status" | "config_json">>,
): InteractionProfile {
  ensureDesktopPetProfile();
  getDb()
    .update(interactionProfiles)
    .set({ ...patch, updated_at: Date.now() })
    .where(eq(interactionProfiles.id, DESKTOP_PET_PROFILE_ID))
    .run();
  return ensureDesktopPetProfile();
}

function ensureSyncProfile(): SyncState {
  const existing = getDb()
    .select()
    .from(syncProfiles)
    .where(eq(syncProfiles.id, DEFAULT_SYNC_PROFILE_ID))
    .get();
  if (existing) return existing as SyncState;
  const row: SyncState = {
    id: DEFAULT_SYNC_PROFILE_ID,
    mode: "local_only",
    endpoint: null,
    device_id: randomUUID(),
    encryption_enabled: 1,
    conflict_strategy: "last_write_wins",
    status: "idle",
    last_synced_at: null,
    updated_at: Date.now(),
  };
  getDb().insert(syncProfiles).values(row).run();
  return row;
}

function ensureAllagentRuntimeStates(): void {
  for (const agent of listAgents()) {
    if (!agentRuntimeStates.has(agent.id)) {
      upsertAgentRuntimeState({ agent_id: agent.id, status: "idle" });
    }
  }
}

function normalizeRuntimeKind(kind: string): NewRuntimeEvent["kind"] {
  if (kind === "model") return "model";
  if (kind === "tool" || kind === "test" || kind === "automation" || kind === "agent")
    return "tool";
  if (kind === "approval") return "approval";
  if (kind === "handoff" || kind === "consult") return "handoff";
  if (kind === "memory" || kind === "learning") return "memory";
  if (kind === "workflow") return "workflow";
  if (kind === "sandbox") return "sandbox";
  if (kind === "guardrail" || kind === "input_guardrail" || kind === "output_guardrail")
    return "guardrail";
  if (kind === "error") return "error";
  return "diagnostic";
}

function redactDetail(detail: unknown): unknown {
  const redactKeys = new Set(["apiKey", "api_key", "authorization", "password", "secret", "token"]);
  if (Array.isArray(detail)) return detail.map(redactDetail);
  if (detail && typeof detail === "object") {
    return Object.fromEntries(
      Object.entries(detail as Record<string, unknown>).map(([key, value]) => [
        key,
        redactKeys.has(key.toLowerCase()) ? "[redacted]" : redactDetail(value),
      ]),
    );
  }
  return detail;
}

function normalizeRequiredText(raw: unknown, label: string, maxLength: number): string {
  const value = stringifyInput(raw).trim().slice(0, maxLength);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function normalizeText(raw: unknown, maxLength: number): string {
  return stringifyInput(raw).trim().slice(0, maxLength);
}

function normalizeNullableText(raw: unknown, maxLength: number): string | null {
  if (raw === null || raw === undefined) return null;
  const value = stringifyInput(raw).trim().slice(0, maxLength);
  return value || null;
}

function normalizeAvatar(raw: unknown): string {
  const value = stringifyInput(raw ?? "A").trim();
  return (value || "A").slice(0, 8);
}

function stringifyInput(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return String(raw);
  }
  return "";
}

function normalizeBooleanNumber(raw: unknown): number {
  return raw === true || raw === 1 || raw === "1" ? 1 : 0;
}

function normalizeTimeoutSeconds(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(600, Math.max(1, Math.round(parsed)));
}

function normalizeJsonObjectString(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      );
    } catch {
      return "{}";
    }
  }
  return JSON.stringify(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
}

function normalizeJsonArrayString(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch {
      return "[]";
    }
  }
  return JSON.stringify(Array.isArray(raw) ? raw : []);
}

function normalizeStringRecordJson(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      return normalizeStringRecordJson(JSON.parse(raw));
    } catch {
      return "{}";
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "{}";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    ),
  );
}

function normalizeSkillStepsJson(raw: unknown): string {
  const items = typeof raw === "string" ? safeParseArray(raw) : Array.isArray(raw) ? raw : [];
  const steps: ToolSkillStep[] = items
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Partial<ToolSkillStep>;
      return {
        id: String(value.id ?? `step-${index + 1}`).slice(0, 80),
        type: normalizeSkillStepType(value.type),
        title: String(value.title ?? "Step").slice(0, 120),
        detail: String(value.detail ?? "").slice(0, 2_000),
      };
    })
    .filter((item): item is ToolSkillStep => item !== null);
  return JSON.stringify(steps);
}

function normalizeSkillStepType(raw: unknown): ToolSkillStep["type"] {
  return raw === "tool" || raw === "approval" || raw === "memory" || raw === "handoff"
    ? raw
    : "prompt";
}

function normalizeMcpTransport(raw: unknown): ToolServer["transport"] {
  return raw === "http" || raw === "sse" ? raw : "stdio";
}

function normalizeSecretOwnerType(raw: unknown): ToolSecretOwnerType {
  return raw === "tool" || raw === "skill" ? "tool" : "server";
}

function normalizeSecretKey(raw: unknown): string {
  return normalizeRequiredText(raw, "secret key", 80).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function publicToolSecret(secret: DbToolSecret): ToolSecretPublic {
  return {
    id: secret.id,
    owner_type: secret.owner_type,
    owner_id: secret.owner_id,
    key: secret.key,
    label: secret.label,
    updated_at: secret.updated_at,
  };
}

function parseSecretReference(value: string): string | null {
  const match = /^\$secret:([A-Za-z0-9_.-]+)$/.exec(value.trim());
  return match?.[1] ?? null;
}

function safeParseArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toolSecretId(ownerType: ToolSecretOwnerType, ownerId: string, key: string): string {
  return `${ownerType}-${slugPart(ownerId)}-${slugPart(key)}`;
}

function toolRowId(serverId: string, name: string): string {
  return `tool-${slugPart(serverId)}-${slugPart(name)}`;
}

function skillWorkflowId(skillId: string): string {
  return `workflow-${slugPart(skillId)}`;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
