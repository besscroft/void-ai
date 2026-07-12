import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { generateText } from "ai";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import { getSetting, listMemories, queueMemoryJob } from "./db";
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

export const MEMORY_FILE_LIMITS: Record<MemoryFileKind, number> = {
  soul: 4_000,
  user: 2_000,
  memory: 4_000,
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

const cache = new Map<
  MemoryFileKind,
  { content: string; updatedAt: number; userLocked: boolean }
>();
let consolidationTimer: NodeJS.Timeout | null = null;

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
  if (kind === "soul") {
    return [
      "# SOUL",
      "",
      "You are Paimon, a capable local-first AI partner and orchestrator. Be warm, proactive, careful, and useful.",
    ].join("\n");
  }
  if (kind === "user") return "# USER\n\nNo stable user profile yet.";
  return "# MEMORY\n\nNo long-term working memories yet.";
}

function readEnvelope(kind: MemoryFileKind): MemoryFileEnvelope | null {
  const path = filePath(kind);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MemoryFileEnvelope;
    return parsed?.payload ? parsed : null;
  } catch {
    return null;
  }
}

function readCached(kind: MemoryFileKind): {
  content: string;
  updatedAt: number;
  userLocked: boolean;
} {
  const envelope = readEnvelope(kind);
  if (!envelope) return { content: defaultContent(kind), updatedAt: 0, userLocked: false };
  const cached = cache.get(kind);
  if (cached && cached.updatedAt === envelope.updatedAt) return cached;
  const state = {
    content: decrypt(envelope.payload),
    updatedAt: envelope.updatedAt,
    userLocked: envelope.userLocked,
  };
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
  const path = filePath(kind);
  if (existsSync(path)) {
    try {
      renameSync(path, `${path}.bak`);
    } catch {
      // Best effort backup; continue with the current write.
    }
  }
  const envelope: MemoryFileEnvelope = {
    payload: encrypt(content),
    updatedAt,
    userLocked,
  };
  writeFileSync(path, JSON.stringify(envelope), "utf8");
  cache.set(kind, { content, updatedAt, userLocked });
}

export function readMemoryFile(kind: MemoryFileKind): string {
  return readCached(kind).content;
}

export function writeMemoryFile(
  kind: MemoryFileKind,
  content: string,
  options?: { userLocked?: boolean },
): void {
  writeEnvelope(kind, content.slice(0, MEMORY_FILE_LIMITS[kind]), {
    userLocked: options?.userLocked,
  });
}

export function reloadMemoryFile(kind: MemoryFileKind): AgentMemoryFileSnapshot {
  cache.delete(kind);
  return getMemoryFileSnapshot(kind);
}

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

export function buildMemoryFilePromptBlock(): string {
  return [
    readMemoryFile("soul").trim(),
    readMemoryFile("user").trim(),
    readMemoryFile("memory").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function incorporateNewMemories(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  const userLines: string[] = [];
  const memoryLines: string[] = [];
  const now = Date.now();

  for (const record of records) {
    const line = `- ${record.title}: ${record.content}`;
    if (record.kind === "profile" || record.kind === "preference") userLines.push(line);
    else memoryLines.push(line);
  }

  if (userLines.length > 0) appendToFile("user", userLines, now);
  if (memoryLines.length > 0) appendToFile("memory", memoryLines, now);

  const shouldDream = (["user", "memory"] as MemoryFileKind[]).some(
    (kind) => readCached(kind).content.length >= MEMORY_FILE_LIMITS[kind] * 0.9,
  );
  if (shouldDream) {
    queueMemoryJob({
      kind: "dream",
      agentId: null,
      payload: { reason: "memory-file-near-limit" },
      scheduledAt: Date.now() + 2_000,
    });
  }
}

function appendToFile(kind: MemoryFileKind, lines: string[], now: number): void {
  const state = readCached(kind);
  const header = kind === "user" ? "# USER" : "# MEMORY";
  const body = state.content.startsWith(header)
    ? state.content.slice(header.length).trim()
    : state.content.trim();
  const appendedBody = body ? `${body}\n${lines.join("\n")}` : lines.join("\n");
  const next = `${header}\n\n${appendedBody}`;
  writeEnvelope(kind, truncateWithEllipsis(next, MEMORY_FILE_LIMITS[kind]), {
    updatedAt: now,
    userLocked: state.userLocked,
  });
}

function truncateWithEllipsis(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 3)) + "...";
}

export async function consolidateMemoryFiles(): Promise<void> {
  const model = tryResolveSelectedModel();
  const current = {
    soul: readCached("soul"),
    user: readCached("user"),
    memory: readCached("memory"),
  };

  if (!model) {
    for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
      const state = readCached(kind);
      if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
        writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
      }
    }
    return;
  }

  const records = listMemories({ includeInactive: false, limit: 80 })
    .map(
      (record) =>
        `- [${record.kind}; confidence=${record.confidence ?? 70}] ${record.title}: ${record.content}`,
    )
    .join("\n");
  const lockedKinds = (["soul", "user", "memory"] as MemoryFileKind[]).filter(
    (kind) => readCached(kind).userLocked,
  );
  const prompt = buildConsolidationPrompt({
    soul: current.soul.content,
    user: current.user.content,
    memory: current.memory.content,
    records,
    lockedNote:
      lockedKinds.length > 0
        ? `Locked files: ${lockedKinds.join(", ")}. Preserve them conservatively.`
        : "",
  });

  try {
    const result = await generateText({
      model: model.model,
      system:
        "You curate bounded memory files for an AI agent. Output ONLY the three files separated by exact headers ===SOUL===, ===USER===, ===MEMORY===. Keep stable identity in SOUL, user preferences/profile in USER, and project facts/lessons in MEMORY. Remove duplicates and keep each file under its limit.",
      prompt,
      temperature: 0.3,
      maxOutputTokens: Math.min(model.maxOutputTokens, 4_000),
      providerOptions: model.providerOptions,
    });
    const parsed = parseConsolidationOutput(result.text);
    if (!parsed) return;

    for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
      if (lockedKinds.includes(kind)) {
        const state = readCached(kind);
        if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
          writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
        }
        continue;
      }
      writeMemoryFile(kind, parsed[kind] || defaultContent(kind));
    }
  } catch (error) {
    console.warn("[agent-memory-files] consolidate failed:", error);
    for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
      const state = readCached(kind);
      if (state.content.length > MEMORY_FILE_LIMITS[kind]) {
        writeMemoryFile(kind, truncateWithEllipsis(state.content, MEMORY_FILE_LIMITS[kind]));
      }
    }
  }
}

export async function dreamMemoryFiles(_reason = "scheduled"): Promise<void> {
  await consolidateMemoryFiles();
}

function buildConsolidationPrompt(input: {
  soul: string;
  user: string;
  memory: string;
  records: string;
  lockedNote: string;
}): string {
  return [
    "Consolidate the bounded memory files.",
    "Character limits: SOUL 4000, USER 2000, MEMORY 4000.",
    "Update SOUL only for stable identity/tone/value changes with repeated evidence.",
    "Keep current user instructions higher priority than memory.",
    input.lockedNote,
    "",
    "Format:",
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
    "Current SOUL:",
    input.soul,
    "",
    "Current USER:",
    input.user,
    "",
    "Current MEMORY:",
    input.memory,
    "",
    "Structured memory records:",
    input.records,
  ].join("\n");
}

function parseConsolidationOutput(text: string): Record<MemoryFileKind, string> | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const soulMatch = normalized.match(/===SOUL===\n([\s\S]*?)(?:\n===USER===|\n===MEMORY===|$)/);
  const userMatch = normalized.match(/===USER===\n([\s\S]*?)(?:\n===MEMORY===|$)/);
  const memoryMatch = normalized.match(/===MEMORY===\n([\s\S]*?)$/);
  if (!soulMatch && !userMatch && !memoryMatch) return null;
  return {
    soul: (soulMatch?.[1] ?? defaultContent("soul")).trim().slice(0, MEMORY_FILE_LIMITS.soul),
    user: (userMatch?.[1] ?? defaultContent("user")).trim().slice(0, MEMORY_FILE_LIMITS.user),
    memory: (memoryMatch?.[1] ?? defaultContent("memory"))
      .trim()
      .slice(0, MEMORY_FILE_LIMITS.memory),
  };
}

export function ensureMemoryFiles(agent: AgentProfile): void {
  if (!existsSync(filePath("soul"))) {
    const soulContent = agent.instructions?.trim()
      ? `# SOUL\n\n${agent.instructions.trim()}`
      : defaultContent("soul");
    writeMemoryFile("soul", soulContent);
  }
  for (const kind of ["user", "memory"] as MemoryFileKind[]) {
    if (!existsSync(filePath(kind))) writeMemoryFile(kind, defaultContent(kind));
  }
}

export function scheduleMemoryFileConsolidation(): void {
  if (consolidationTimer) return;
  consolidationTimer = setInterval(
    () => {
      for (const kind of ["soul", "user", "memory"] as MemoryFileKind[]) {
        if (readCached(kind).content.length >= MEMORY_FILE_LIMITS[kind] * 0.8) {
          queueMemoryJob({
            kind: "dream",
            agentId: null,
            payload: { reason: "scheduled-file-pressure" },
            scheduledAt: Date.now(),
          });
          break;
        }
      }
    },
    30 * 60 * 1000,
  );
}

export function clearMemoryFileConsolidation(): void {
  if (!consolidationTimer) return;
  clearInterval(consolidationTimer);
  consolidationTimer = null;
}

function tryResolveSelectedModel(): ReturnType<typeof resolveModel> | null {
  try {
    const modelRef = getSetting(SettingKey.SelectedModel);
    return modelRef ? resolveModel(modelRef) : null;
  } catch {
    return null;
  }
}
