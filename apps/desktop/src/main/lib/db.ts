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
import { eq, desc, asc } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { encrypt, decrypt, type EncryptedPayload } from "./crypto";
import {
  schema,
  conversations,
  messages,
  settings,
  apiKeys,
  agents,
  memories,
  workflows,
  workflowRuns,
  harnessEvents,
  serverNodes,
  interactionProfiles,
  syncState,
  type Conversation,
  type MessageRow,
  type AgentProfile,
  type MemoryRecord,
  type WorkflowDefinition,
  type WorkflowRun,
  type HarnessEvent,
  type ServerNode,
  type InteractionProfile,
  type SyncState,
} from "./schema";

export type {
  Conversation,
  MessageRow,
  AgentProfile,
  MemoryRecord,
  WorkflowDefinition,
  WorkflowRun,
  HarnessEvent,
  ServerNode,
  InteractionProfile,
  SyncState,
};
/** 数据库文件名 */
const DB_FILENAME = "void-ai.db";
/** 数据目录名（位于 userData 下） */
const DATA_DIRNAME = "data";
const DEFAULT_AGENT_ID = "agent-void";

/** drizzle 实例类型（基于 schema 推断，保证类型安全的查询/插入/更新） */
type DbInstance = BetterSQLite3Database<typeof schema>;

let rawDb: Database.Database | null = null;
let dbInstance: DbInstance | null = null;

/**
 * 解析数据目录路径，并在首次调用时创建。
 * 路径：app.getPath('userData')/data
 */
function resolveDataDir(): string {
  const dir = join(app.getPath("userData"), DATA_DIRNAME);
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
    return join(__dirname, "..", "..", "drizzle");
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
  getDb().insert(conversations).values({ id, title, created_at: now, updated_at: now }).run();
  return { id, title, created_at: now, updated_at: now };
}

/** 列出所有会话（按更新时间倒序） */
export function listConversations(): Conversation[] {
  return getDb().select().from(conversations).orderBy(desc(conversations.updated_at)).all();
}

/** 获取单个会话 */
export function getConversation(id: string): Conversation | null {
  return getDb().select().from(conversations).where(eq(conversations.id, id)).get() ?? null;
}

/** 更新会话标题/时间戳 */
export function touchConversation(id: string, title?: string): void {
  const now = Date.now();
  const db = getDb();
  if (title) {
    db.update(conversations).set({ title, updated_at: now }).where(eq(conversations.id, id)).run();
  } else {
    db.update(conversations).set({ updated_at: now }).where(eq(conversations.id, id)).run();
  }
}

/** 删除会话及其所有消息（外键级联） */
export function deleteConversation(id: string): void {
  getDb().delete(conversations).where(eq(conversations.id, id)).run();
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
// 工作台数据：Agents / Memory / Workflows / Harness / Server / Sync
// ============================================================

export function listAgents(): AgentProfile[] {
  return getDb().select().from(agents).orderBy(desc(agents.updated_at)).all();
}

export function getAgent(id: string): AgentProfile | null {
  return getDb().select().from(agents).where(eq(agents.id, id)).get() ?? null;
}

export function saveAgent(agent: AgentProfile): void {
  getDb()
    .insert(agents)
    .values(agent)
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: agent.name,
        role: agent.role,
        description: agent.description,
        personality: agent.personality,
        soul_prompt: agent.soul_prompt,
        avatar: agent.avatar,
        status: agent.status,
        model_ref: agent.model_ref,
        voice: agent.voice,
        updated_at: Date.now(),
      },
    })
    .run();
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

  if (db.select({ id: agents.id }).from(agents).limit(1).get()) return;

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
}
