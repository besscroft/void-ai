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
  type Conversation,
  type MessageRow,
} from "./schema";

export type { Conversation, MessageRow };

/** 数据库文件名 */
const DB_FILENAME = "void-ai.db";
/** 数据目录名（位于 userData 下） */
const DATA_DIRNAME = "data";

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
