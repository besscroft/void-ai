import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { generateText } from "ai";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import { getSetting, insertRuntimeEvent, listMemories, queueMemoryJob } from "./db";
import { resolveModel } from "./providers";
import {
  SettingKey,
  type AgentMemoryFileSnapshot,
  type AgentProfile,
  type MemoryRecord,
} from "../../shared/types";

export type MemoryFileKind = "soul" | "user" | "memory";
export type MemoryFileWriteSource = "system" | "user";

export const MEMORY_FILE_LIMITS: Record<MemoryFileKind, number> = {
  soul: 4_000,
  user: 2_000,
  memory: 4_000,
};

interface MemoryFileEnvelopeV2 {
  version: 2;
  payload: EncryptedPayload;
  updatedAt: number;
  manualBaseline?: EncryptedPayload;
  manualEditedAt?: number;
}

interface LegacyMemoryFileEnvelope {
  payload: EncryptedPayload;
  updatedAt?: number;
  userLocked?: boolean;
}

interface MemoryFileState {
  content: string;
  updatedAt: number;
  manualBaseline: string | null;
  manualEditedAt: number | null;
  signature: string;
  source: "primary" | "backup" | "default";
}

const AGENT_MEMORIES_DIRNAME = "agent-memories";
const FILE_NAMES: Record<MemoryFileKind, string> = {
  soul: "SOUL.md.enc",
  user: "USER.md.enc",
  memory: "MEMORY.md.enc",
};
const MEMORY_FILE_KINDS: MemoryFileKind[] = ["soul", "user", "memory"];

const cache = new Map<MemoryFileKind, MemoryFileState>();
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

function backupPath(kind: MemoryFileKind): string {
  return `${filePath(kind)}.bak`;
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

function fileSignature(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return `${stat.mtimeMs}:${stat.size}`;
}

function readStateFromPath(
  kind: MemoryFileKind,
  path: string,
): Omit<MemoryFileState, "signature" | "source"> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("Memory file envelope is invalid.");
  const envelope = raw as MemoryFileEnvelopeV2 & LegacyMemoryFileEnvelope;
  if (!isEncryptedPayload(envelope.payload)) throw new Error("Memory file payload is invalid.");

  const updatedAt =
    typeof envelope.updatedAt === "number" && Number.isFinite(envelope.updatedAt)
      ? envelope.updatedAt
      : Math.trunc(statSync(path).mtimeMs);
  const content = decrypt(envelope.payload).slice(0, MEMORY_FILE_LIMITS[kind]);
  let manualBaseline: string | null = null;
  let manualEditedAt: number | null = null;

  if (envelope.version === 2) {
    if (envelope.manualBaseline != null) {
      if (!isEncryptedPayload(envelope.manualBaseline)) {
        throw new Error("Memory file manual baseline is invalid.");
      }
      manualBaseline = decrypt(envelope.manualBaseline).slice(0, MEMORY_FILE_LIMITS[kind]);
    }
    manualEditedAt =
      typeof envelope.manualEditedAt === "number" && Number.isFinite(envelope.manualEditedAt)
        ? envelope.manualEditedAt
        : null;
  } else if (envelope.userLocked === true) {
    manualBaseline = content;
    manualEditedAt = updatedAt;
  }

  return { content, updatedAt, manualBaseline, manualEditedAt };
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<EncryptedPayload>;
  return [payload.ct, payload.iv, payload.tag, payload.salt].every(
    (part) => typeof part === "string" && part.length > 0,
  );
}

function readCached(kind: MemoryFileKind): MemoryFileState {
  const primary = filePath(kind);
  const primarySignature = fileSignature(primary);
  const cached = cache.get(kind);
  if (cached && cached.source === "primary" && cached.signature === primarySignature) return cached;

  let primaryError: unknown = null;
  if (primarySignature) {
    try {
      const state = {
        ...readStateFromPath(kind, primary),
        signature: primarySignature,
        source: "primary" as const,
      };
      cache.set(kind, state);
      return state;
    } catch (error) {
      primaryError = error;
    }
  }

  const backup = backupPath(kind);
  const backupSignature = fileSignature(backup);
  if (backupSignature) {
    try {
      const recovered = readStateFromPath(kind, backup);
      copyFileSync(backup, primary);
      const state = {
        ...recovered,
        signature: fileSignature(primary) ?? backupSignature,
        source: "primary" as const,
      };
      cache.set(kind, state);
      recordMemoryFileDiagnostic(kind, "recovered-backup", primaryError);
      return state;
    } catch (backupError) {
      recordMemoryFileDiagnostic(kind, "backup-invalid", backupError);
    }
  }

  if (primaryError) recordMemoryFileDiagnostic(kind, "primary-invalid", primaryError);
  const fallback: MemoryFileState = {
    content: defaultContent(kind),
    updatedAt: 0,
    manualBaseline: null,
    manualEditedAt: null,
    signature: `default:${primarySignature ?? "missing"}:${backupSignature ?? "missing"}`,
    source: "default",
  };
  cache.set(kind, fallback);
  return fallback;
}

function writeEnvelope(
  kind: MemoryFileKind,
  content: string,
  options?: { source?: MemoryFileWriteSource; updatedAt?: number },
): void {
  const source = options?.source ?? "system";
  const updatedAt = options?.updatedAt ?? Date.now();
  const current = readCached(kind);
  const manualBaseline = source === "user" ? content : current.manualBaseline;
  const manualEditedAt = source === "user" ? updatedAt : current.manualEditedAt;
  const envelope: MemoryFileEnvelopeV2 = {
    version: 2,
    payload: encrypt(content),
    updatedAt,
    ...(manualBaseline ? { manualBaseline: encrypt(manualBaseline) } : {}),
    ...(manualEditedAt != null ? { manualEditedAt } : {}),
  };

  const path = filePath(kind);
  const backup = backupPath(kind);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });

  let movedPrimary = false;
  try {
    if (existsSync(backup)) unlinkSync(backup);
    if (existsSync(path)) {
      renameSync(path, backup);
      movedPrimary = true;
    }
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (movedPrimary && !existsSync(path) && existsSync(backup)) renameSync(backup, path);
    throw error;
  }

  cache.set(kind, {
    content,
    updatedAt,
    manualBaseline,
    manualEditedAt,
    signature: fileSignature(path) ?? `${updatedAt}:${content.length}`,
    source: "primary",
  });
}

export function readMemoryFile(kind: MemoryFileKind): string {
  return readCached(kind).content;
}

export function writeMemoryFile(
  kind: MemoryFileKind,
  content: string,
  options?: { source?: MemoryFileWriteSource },
): void {
  const clipped = content.slice(0, MEMORY_FILE_LIMITS[kind]);
  writeEnvelope(kind, clipped, { source: options?.source });
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
  };
}

export function buildMemoryFilePromptBlock(): string {
  return MEMORY_FILE_KINDS.map((kind) => readMemoryFile(kind).trim())
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
    source: "system",
    updatedAt: now,
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

  if (!model) return;

  const records = listMemories({ includeInactive: false, limit: 80 })
    .map(
      (record) =>
        `- [${record.kind}; confidence=${record.confidence ?? 70}] ${record.title}: ${record.content}`,
    )
    .join("\n");
  const prompt = buildConsolidationPrompt({
    soul: current.soul.content,
    user: current.user.content,
    memory: current.memory.content,
    manualBaselines: {
      soul: current.soul.manualBaseline,
      user: current.user.manualBaseline,
      memory: current.memory.manualBaseline,
    },
    records,
  });

  try {
    const result = await generateText({
      model: model.model,
      system:
        "You curate bounded memory files for an AI agent. Output ONLY the three files separated by exact headers ===SOUL===, ===USER===, ===MEMORY===. Keep stable identity in SOUL, user preferences/profile in USER, and project facts/lessons in MEMORY. Preserve every user-authored baseline statement, remove only automatic duplicates, and keep each file under its limit.",
      prompt,
      temperature: 0.3,
      maxOutputTokens: Math.min(model.maxOutputTokens, 4_000),
      providerOptions: model.providerOptions,
    });
    const parsed = parseConsolidationOutput(result.text);
    if (!parsed || !manualBaselinesArePreserved(parsed, current)) {
      recordMemoryFileDiagnostic(null, "consolidation-rejected", "Invalid or lossy model output.");
      return;
    }

    for (const kind of MEMORY_FILE_KINDS) {
      writeMemoryFile(kind, parsed[kind], { source: "system" });
    }
  } catch (error) {
    recordMemoryFileDiagnostic(null, "consolidation-failed", error);
  }
}

export async function dreamMemoryFiles(_reason = "scheduled"): Promise<void> {
  await consolidateMemoryFiles();
}

function buildConsolidationPrompt(input: {
  soul: string;
  user: string;
  memory: string;
  manualBaselines: Record<MemoryFileKind, string | null>;
  records: string;
}): string {
  return [
    "Consolidate the bounded memory files.",
    "Character limits: SOUL 4000, USER 2000, MEMORY 4000.",
    "Update SOUL only for stable identity/tone/value changes with repeated evidence.",
    "Current user instructions and the user-authored baselines have higher priority than automatic memory.",
    "Preserve every non-heading line from a user-authored baseline verbatim in its matching output file.",
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
    "User-authored SOUL baseline:",
    input.manualBaselines.soul ?? "(none)",
    "",
    "User-authored USER baseline:",
    input.manualBaselines.user ?? "(none)",
    "",
    "User-authored MEMORY baseline:",
    input.manualBaselines.memory ?? "(none)",
    "",
    "Structured memory records:",
    input.records,
  ].join("\n");
}

export function parseConsolidationOutput(text: string): Record<MemoryFileKind, string> | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const match = normalized.match(
    /^===SOUL===\n([\s\S]+?)\n===USER===\n([\s\S]+?)\n===MEMORY===\n([\s\S]+)$/,
  );
  if (!match) return null;
  const parsed: Record<MemoryFileKind, string> = {
    soul: match[1].trim(),
    user: match[2].trim(),
    memory: match[3].trim(),
  };
  for (const kind of MEMORY_FILE_KINDS) {
    if (!parsed[kind] || parsed[kind].length > MEMORY_FILE_LIMITS[kind]) return null;
  }
  return parsed;
}

function manualBaselinesArePreserved(
  parsed: Record<MemoryFileKind, string>,
  current: Record<MemoryFileKind, MemoryFileState>,
): boolean {
  return MEMORY_FILE_KINDS.every((kind) => {
    const statements = manualBaselineStatements(current[kind].manualBaseline);
    const output = normalizeStatement(parsed[kind]);
    return statements.every((statement) => output.includes(statement));
  });
}

function manualBaselineStatements(baseline: string | null): string[] {
  if (!baseline) return [];
  return baseline
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(normalizeStatement);
}

function normalizeStatement(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function ensureMemoryFiles(agent: AgentProfile): void {
  for (const kind of MEMORY_FILE_KINDS) {
    const state = readCached(kind);
    if (state.source !== "default") continue;
    const initial =
      kind === "soul" && agent.instructions?.trim()
        ? `# SOUL\n\n${agent.instructions.trim()}`
        : defaultContent(kind);
    writeMemoryFile(kind, initial, { source: "system" });
  }
}

export function scheduleMemoryFileConsolidation(): void {
  if (consolidationTimer) return;
  consolidationTimer = setInterval(
    () => {
      for (const kind of MEMORY_FILE_KINDS) {
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

function recordMemoryFileDiagnostic(
  kind: MemoryFileKind | null,
  action: string,
  error: unknown,
): void {
  const message = formatDiagnosticError(error);
  console.warn(`[agent-memory-files] ${action}${kind ? ` (${kind})` : ""}:`, message ?? "");
  try {
    insertRuntimeEvent({
      kind: "memory",
      title: `Memory file ${action}`,
      status: action.includes("recovered") ? "succeeded" : "failed",
      detail: { action, fileKind: kind, error: message },
    });
  } catch {
    // Diagnostics must never block memory recovery or chat startup.
  }
}

function formatDiagnosticError(error: unknown): string | null {
  if (error == null) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown memory file error.";
  }
}

function tryResolveSelectedModel(): ReturnType<typeof resolveModel> | null {
  try {
    const modelRef = getSetting(SettingKey.SelectedModel);
    return modelRef ? resolveModel(modelRef) : null;
  } catch {
    return null;
  }
}
