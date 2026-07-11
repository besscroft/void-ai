/**
 * 智能体记忆文件层
 *
 * 维护三个有界加密的 Markdown 文件，作为系统提示词的「冻结快照」：
 * - SOUL.md：Agent 身份、语气、价值观、沟通默认值
 * - USER.md：用户画像、偏好、沟通风格、反感
 * - MEMORY.md：环境事实、项目约定、经验教训、已完成工作
 *
 * 文件使用 AES-256-GCM 加密，完全本地存储。SQLite `memories` 表作为全量
 * 结构化仓库，本文件层定期从 SQLite 和新增记忆中整理出有界提示词。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { generateText } from "ai";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import { getSetting, listMemories, saveMemory } from "./db";
import { resolveModel } from "./providers";
import { SettingKey, type AgentProfile, type MemoryRecord } from "../../shared/types";

export type MemoryFileKind = "soul" | "user" | "memory";

export interface AgentMemoryFileSnapshot {
  kind: MemoryFileKind;
  content: string;
  charLimit: number;
  charCount: number;
  updatedAt: number;
  userLocked: boolean;
}

/** 文件字符上限常量 */
export const MEMORY_FILE_LIMITS: Record<MemoryFileKind, number> = {
  soul: 4000,
  user: 2000,
  memory: 4000,
};

interface MemoryFileEnvelope {
  payload: EncryptedPayload;
  updatedAt: number;
  userLocked: boolean;
}

const AGENT_MEMORIES_DIRNAME = "agent-memories";
const FILE_NAMES: Record<MemoryFileKind, string> = {
  soul: "SOUL.md.enc",
  user: "USER.md.enc",
  memory: "MEMORY.md.enc",
};

/** 内存缓存，避免高频读取同一文件时反复解密 */
const cache = new Map<
  MemoryFileKind,
  { content: string; updatedAt: number; userLocked: boolean }
>();

function resolveAgentMemoriesDir(): string {
  const userDataDir = process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData");
  const dir = join(userDataDir, "data", AGENT_MEMORIES_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(kind: MemoryFileKind): string {
  return join(resolveAgentMemoriesDir(), FILE_NAMES[kind]);
}

function defaultContent(kind: MemoryFileKind): string {
  switch (kind) {
    case "soul":
      return "# SOUL\n\nYou are Void, a helpful local AI assistant.";
    case "user":
      return "# USER\n\nNo user profile yet.";
    case "memory":
      return "# MEMORY\n\nNo long-term memories yet.";
  }
}

function readEnvelope(kind: MemoryFileKind): MemoryFileEnvelope | null {
  const path = filePath(kind);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as MemoryFileEnvelope;
    if (!parsed?.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCached(kind: MemoryFileKind): {
  content: string;
  updatedAt: number;
  userLocked: boolean;
} {
  const cached = cache.get(kind);
  const envelope = readEnvelope(kind);
  if (!envelope) {
    return { content: defaultContent(kind), updatedAt: 0, userLocked: false };
  }
  if (cached && cached.updatedAt === envelope.updatedAt) {
    return cached;
  }
  const content = decrypt(envelope.payload);
  const state = { content, updatedAt: envelope.updatedAt, userLocked: envelope.userLocked };
  cache.set(kind, state);
  return state;
}

function writeEnvelope(
  kind: MemoryFileKind,
  content: string,
  options?: { userLocked?: boolean; updatedAt?: number },
): void {
  const updatedAt = options?.updatedAt ?? Date.now();
  const userLocked = options?.userLocked ?? readCached(kind).userLocked;
  const envelope: MemoryFileEnvelope = {
    payload: encrypt(content),
    updatedAt,
    userLocked,
  };
  const path = filePath(kind);
  // 写入前保留旧版本作为 .bak，便于整理失败时恢复
  if (existsSync(path)) {
    try {
      renameSync(path, `${path}.bak`);
    } catch {
      // 备份失败继续写入
    }
  }
  writeFileSync(path, JSON.stringify(envelope), "utf8");
  cache.set(kind, { content, updatedAt, userLocked });
}

/** 获取或创建加密记忆文件（解密后返回明文） */
export function readMemoryFile(kind: MemoryFileKind): string {
  return readCached(kind).content;
}

/** 加密并写入记忆文件 */
export function writeMemoryFile(
  kind: MemoryFileKind,
  content: string,
  options?: { userLocked?: boolean },
): void {
  const charLimit = MEMORY_FILE_LIMITS[kind];
  const trimmed = content.slice(0, charLimit);
  writeEnvelope(kind, trimmed, { userLocked: options?.userLocked });
}

/** 强制重新从磁盘读取指定文件（清除内存缓存） */
export function reloadMemoryFile(kind: MemoryFileKind): AgentMemoryFileSnapshot {
  cache.delete(kind);
  return getMemoryFileSnapshot(kind);
}

/** 获取单个文件快照（含字符统计与锁定状态） */
export function getMemoryFileSnapshot(kind: MemoryFileKind): AgentMemoryFileSnapshot {
  const state = readCached(kind);
  return {
    kind,
    content: state.content,
    charLimit: MEMORY_FILE_LIMITS[kind],
    charCount: state.content.length,
    updatedAt: state.updatedAt,
    userLocked: state.userLocked,
  };
}

/** 返回格式化的系统提示词块 */
export function buildMemoryFilePromptBlock(): string {
  const soul = readMemoryFile("soul");
  const user = readMemoryFile("user");
  const memory = readMemoryFile("memory");
  const parts: string[] = [];
  if (soul.trim()) parts.push(soul);
  if (user.trim()) parts.push(user);
  if (memory.trim()) parts.push(memory);
  return parts.join("\n\n");
}

/** 轻量追加整理：把新增记忆合并到对应文件 */
export async function incorporateNewMemories(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;

  const userLines: string[] = [];
  const memoryLines: string[] = [];
  const now = Date.now();

  for (const record of records) {
    const line = `- ${record.title}: ${record.content}`;
    if (record.kind === "profile" || record.kind === "preference") {
      userLines.push(line);
    } else {
      memoryLines.push(line);
    }
  }

  if (userLines.length > 0) {
    appendToFile("user", userLines, now);
  }
  if (memoryLines.length > 0) {
    appendToFile("memory", memoryLines, now);
  }

  // 任一文件超过上限时触发深度整理
  const shouldConsolidate = (["user", "memory"] as MemoryFileKind[]).some(
    (kind) => readCached(kind).content.length >= MEMORY_FILE_LIMITS[kind] * 0.9,
  );
  if (shouldConsolidate) {
    await consolidateMemoryFiles();
  }
}

function appendToFile(kind: MemoryFileKind, lines: string[], now: number): void {
  const state = readCached(kind);
  if (state.userLocked) {
    // 用户锁定文件只做保守合并：追加到文件末尾，不删除旧内容
    const appended = state.content + "\n\n" + lines.join("\n");
    writeEnvelope(kind, truncateWithEllipsis(appended, MEMORY_FILE_LIMITS[kind]), {
      updatedAt: now,
    });
    return;
  }
  const header = kind === "user" ? "# USER" : "# MEMORY";
  const body = state.content.startsWith(header)
    ? state.content.slice(header.length).trim()
    : state.content.trim();
  const newBody = body ? `${body}\n${lines.join("\n")}` : lines.join("\n");
  writeEnvelope(kind, `${header}\n\n${newBody}`, { updatedAt: now });
}

function truncateWithEllipsis(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 3)) + "...";
}

/**
 * 根据 SQLite 记忆条目整理文件层。
 * 调用 LLM 合并、去重、压缩，并评估 SOUL.md 是否需要更新。
 */
export async function consolidateMemoryFiles(): Promise<void> {
  const model = tryResolveSelectedModel();
  const soul = readCached("soul");
  const user = readCached("user");
  const memory = readCached("memory");

  if (!model) {
    // 无模型时只做简单截断，保留最近内容
    for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
      const state = readCached(kind);
      if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
        writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
      }
    }
    return;
  }

  const recentRecords = listMemories().slice(0, 50);
  const recordsText = recentRecords.map((r) => `- [${r.kind}] ${r.title}: ${r.content}`).join("\n");

  const lockedKinds = new Set<MemoryFileKind>();
  for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
    if (readCached(kind).userLocked) lockedKinds.add(kind);
  }

  const lockedNote =
    lockedKinds.size > 0
      ? `以下文件被用户锁定，只能保守合并/去重，禁止大幅改写或删除：${[...lockedKinds].join(", ")}`
      : "";

  const prompt = buildConsolidationPrompt({
    soul: soul.content,
    user: user.content,
    memory: memory.content,
    records: recordsText,
    lockedNote,
  });

  try {
    const result = await generateText({
      model: model.model,
      system:
        "You are a memory curator for an AI assistant. Your job is to maintain three bounded markdown files used as system prompt context. Output ONLY the three files separated by exact headers `===SOUL===`, `===USER===`, `===MEMORY===`. Each file must stay under its character limit. Be concise, remove duplicates, and preserve facts.",
      prompt,
      temperature: 0.3,
      maxOutputTokens: Math.min(model.maxOutputTokens, 4_000),
      providerOptions: model.providerOptions,
    });

    const parsed = parseConsolidationOutput(result.text);
    if (parsed) {
      for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
        if (lockedKinds.has(kind)) {
          // 锁定文件仅做保守截断，不采用 LLM 重写结果
          const state = readCached(kind);
          if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
            writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
          }
          continue;
        }
        const content = parsed[kind] || defaultContent(kind);
        writeMemoryFile(kind, content);
      }
    }
  } catch (error) {
    console.warn("[agent-memory-files] consolidate failed:", error);
    // 失败时保留旧文件，仅做截断
    for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
      const state = readCached(kind);
      if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
        writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
      }
    }
  }
}

function buildConsolidationPrompt(input: {
  soul: string;
  user: string;
  memory: string;
  records: string;
  lockedNote: string;
}): string {
  return [
    "Consolidate the following three memory files. Keep each file under its character limit.",
    "",
    "Character limits:",
    "- SOUL: 4000",
    "- USER: 2000",
    "- MEMORY: 4000",
    "",
    input.lockedNote,
    "",
    "Format your response exactly like this:",
    "===SOUL===",
    "# SOUL",
    "...",
    "===USER===",
    "# USER",
    "...",
    "===MEMORY===",
    "# MEMORY",
    "...",
    "",
    "Current SOUL file:",
    "```",
    input.soul,
    "```",
    "",
    "Current USER file:",
    "```",
    input.user,
    "```",
    "",
    "Current MEMORY file:",
    "```",
    input.memory,
    "```",
    "",
    "Recent memory records from the database:",
    "```",
    input.records,
    "```",
    "",
    "Update SOUL only if stable changes to identity, tone, or values have emerged. Otherwise keep it unchanged.",
  ].join("\n");
}

function parseConsolidationOutput(text: string): Record<MemoryFileKind, string> | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const soulMatch = normalized.match(/===SOUL===\n([\s\S]*?)(?:\n===USER===|\n===MEMORY===|$)/);
  const userMatch = normalized.match(/===USER===\n([\s\S]*?)(?:\n===MEMORY===|$)/);
  const memoryMatch = normalized.match(/===MEMORY===\n([\s\S]*?)$/);
  if (!soulMatch && !userMatch && !memoryMatch) return null;
  return {
    soul: (soulMatch?.[1] ?? defaultContent("soul")).trim(),
    user: (userMatch?.[1] ?? defaultContent("user")).trim(),
    memory: (memoryMatch?.[1] ?? defaultContent("memory")).trim(),
  };
}

/** 首次启动时从 agent.instructions 等初始化 SOUL.md */
export function ensureMemoryFiles(agent: AgentProfile): void {
  const soulPath = filePath("soul");
  if (!existsSync(soulPath)) {
    const soulContent = agent.instructions?.trim()
      ? `# SOUL\n\n${agent.instructions.trim()}`
      : defaultContent("soul");
    writeMemoryFile("soul", soulContent);
  }
  for (const kind of ["user", "memory"] as MemoryFileKind[]) {
    if (!existsSync(filePath(kind))) {
      writeMemoryFile(kind, defaultContent(kind));
    }
  }
}

let consolidationTimer: NodeJS.Timeout | null = null;

/** 注册每 30 分钟一次的后台整理调度 */
export function scheduleMemoryFileConsolidation(): void {
  if (consolidationTimer) return;
  consolidationTimer = setInterval(
    async () => {
      for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
        const state = readCached(kind);
        if (state.content.length >= MEMORY_FILE_LIMITS[kind] * 0.8) {
          await consolidateMemoryFiles();
          break;
        }
      }
    },
    30 * 60 * 1000,
  );
}

/** 清理后台整理调度（主要用于测试） */
export function clearMemoryFileConsolidation(): void {
  if (consolidationTimer) {
    clearInterval(consolidationTimer);
    consolidationTimer = null;
  }
}

function tryResolveSelectedModel(): ReturnType<typeof resolveModel> | null {
  try {
    const modelRef = getSetting(SettingKey.SelectedModel);
    if (!modelRef) return null;
    return resolveModel(modelRef);
  } catch {
    return null;
  }
}

/** 将用户手动编辑的文件内容同步为一条结构化记忆，保持数据库与文件层一致 */
export function syncMemoryFileToDatabase(kind: MemoryFileKind, content: string): void {
  const title =
    kind === "soul" ? "SOUL profile" : kind === "user" ? "USER profile" : "MEMORY snapshot";
  saveMemory({
    id: `file-${kind}`,
    scope: "agent",
    kind: kind === "soul" ? "profile" : kind === "user" ? "preference" : "fact",
    title,
    content: content.slice(0, 4000),
    agent_id: null,
    conversation_id: null,
    source_run_id: null,
    salience: 90,
    pinned: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}
