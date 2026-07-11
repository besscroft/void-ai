import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_ID,
  type MemoryJob,
  type MemoryKind,
  type MemoryRecord,
} from "../../shared/types";
import {
  claimNextMemoryJob,
  finishMemoryJob,
  insertRuntimeEvent,
  listMemories,
  listMessages,
  queueMemoryJob,
  saveMemory,
  updateVoidLearningState,
} from "./db";
import { addMemoriesFromConversation } from "./mem0-service";
import { dreamMemoryFiles } from "./agent-memory-files";

const LEARNING_DELAY_MS = 1_200;
const WORKER_INTERVAL_MS = 60_000;
const MAX_INPUT_CHARS = 8_000;
const MAX_RULE_MEMORIES_PER_RUN = 4;
const MAX_EVIDENCE_ITEMS = 12;

let workerTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let workerActive = false;

export function queueAgentLearning(conversationId: string): void {
  queueMemoryJob({
    kind: "learn",
    conversationId,
    agentId: DEFAULT_AGENT_ID,
    payload: { reason: "chat-finished" },
    scheduledAt: Date.now() + LEARNING_DELAY_MS,
  });
  scheduleMemoryWorker(LEARNING_DELAY_MS);
}

export function startMemoryWorker(): void {
  if (intervalTimer) return;
  queueMemoryJob({
    kind: "rehydrate",
    agentId: DEFAULT_AGENT_ID,
    payload: { reason: "startup" },
    scheduledAt: Date.now() + 5_000,
  });
  queueMemoryJob({
    kind: "dream",
    agentId: DEFAULT_AGENT_ID,
    payload: { reason: "startup" },
    scheduledAt: Date.now() + 15_000,
  });
  scheduleMemoryWorker(100);
  intervalTimer = setInterval(() => scheduleMemoryWorker(0), WORKER_INTERVAL_MS);
}

export function clearMemoryWorker(): void {
  if (workerTimer) clearTimeout(workerTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  workerTimer = null;
  intervalTimer = null;
  workerActive = false;
}

export async function runMemoryWorkerOnce(): Promise<boolean> {
  if (workerActive) return false;
  workerActive = true;
  let hadJob = false;
  try {
    const job = claimNextMemoryJob();
    if (!job) return false;
    hadJob = true;
    try {
      if (job.kind === "learn") await runLearningJob(job);
      else if (job.kind === "dream") await runDreamJob(job);
      else if (job.kind === "rehydrate") await runRehydrateJob(job);
      finishMemoryJob(job.id, "succeeded");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishMemoryJob(job.id, "failed", message);
      insertRuntimeEvent({
        kind: "memory",
        title: "Memory job failed",
        status: "failed",
        detail: { jobId: job.id, kind: job.kind, error: message },
      });
      return true;
    }
  } finally {
    workerActive = false;
    if (hadJob) scheduleMemoryWorker(0);
  }
}

function scheduleMemoryWorker(delayMs: number): void {
  if (workerTimer) return;
  workerTimer = setTimeout(
    () => {
      workerTimer = null;
      void runMemoryWorkerOnce();
    },
    Math.max(0, delayMs),
  );
}

async function runLearningJob(job: MemoryJob): Promise<void> {
  const conversationId = job.conversation_id;
  if (!conversationId) return;
  const started = Date.now();
  updateVoidLearningState({ status: "learning" });
  insertRuntimeEvent({
    kind: "memory",
    title: "Silent memory learning started",
    status: "running",
    detail: { action: "learn", jobId: job.id, conversationId },
  });

  try {
    const messages = listMessages(conversationId);
    const forgetCount = applyForgetIntents(messages);
    const mem0Messages = messages
      .slice(-12)
      .map((message) => ({ role: message.role, content: extractMessageText(message.content) }))
      .filter((message) => message.content.length > 0);

    let source = "rules";
    let candidates: MemoryRecord[] = [];
    if (mem0Messages.length > 0) {
      const extracted = await addMemoriesFromConversation(
        mem0Messages,
        DEFAULT_AGENT_ID,
        conversationId,
        false,
      );
      candidates = extracted.records.map((record) =>
        normalizeLearningRecord(record.content, conversationId, job.run_id, "mem0"),
      );
      if (candidates.length > 0) source = "mem0";
    }

    if (candidates.length === 0) {
      candidates = extractMemoryCandidates(messages)
        .slice(0, MAX_RULE_MEMORIES_PER_RUN)
        .map((content) => normalizeLearningRecord(content, conversationId, job.run_id, "rules"));
    }

    const saved = candidates
      .filter((candidate) => isSafeDurableMemory(candidate.content))
      .filter((candidate) => !isLowValueEphemeral(candidate.content))
      .map((candidate) => upsertLearningMemory(candidate))
      .filter((memory): memory is MemoryRecord => memory != null);

    if (saved.length > 0) {
      await import("./agent-memory-files")
        .then(({ incorporateNewMemories }) => incorporateNewMemories(saved))
        .catch((error) => console.warn("[agent-learning] incorporate failed:", error));
    }
    if (saved.length >= 3 || forgetCount > 0) {
      queueMemoryJob({
        kind: "dream",
        agentId: DEFAULT_AGENT_ID,
        payload: { reason: "learning-batch", savedCount: saved.length, forgetCount },
        scheduledAt: Date.now() + 10_000,
      });
    }

    updateVoidLearningState({ status: "idle", lastLearningAt: Date.now(), lastError: null });
    insertRuntimeEvent({
      kind: "memory",
      title: "Silent memory learning completed",
      status: "succeeded",
      detail: {
        action: "learn",
        jobId: job.id,
        conversationId,
        savedCount: saved.length,
        forgetCount,
        source,
        durationMs: Date.now() - started,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateVoidLearningState({ status: "failed", lastLearningAt: Date.now(), lastError: message });
    throw error;
  }
}

async function runDreamJob(job: MemoryJob): Promise<void> {
  const payload = parsePayload(job.payload_json);
  const reason = typeof payload.reason === "string" ? payload.reason : "scheduled";
  insertRuntimeEvent({
    kind: "memory",
    title: "Memory dreaming started",
    status: "running",
    detail: { action: "dream", jobId: job.id, reason },
  });
  await dreamMemoryFiles(reason);
  queueMemoryJob({
    kind: "rehydrate",
    agentId: DEFAULT_AGENT_ID,
    payload: { reason: "after-dream", sourceJobId: job.id },
    scheduledAt: Date.now() + 1_000,
  });
  insertRuntimeEvent({
    kind: "memory",
    title: "Memory dreaming completed",
    status: "succeeded",
    detail: { action: "dream", jobId: job.id, reason },
  });
}

async function runRehydrateJob(job: MemoryJob): Promise<void> {
  const { rehydrateMemoryVectorStore } = await import("./mem0-service");
  await rehydrateMemoryVectorStore();
  insertRuntimeEvent({
    kind: "memory",
    title: "Memory vector index rehydrated",
    status: "succeeded",
    detail: { action: "rehydrate", jobId: job.id },
  });
}

function normalizeLearningRecord(
  content: string,
  sourceConversationId: string,
  sourceRunId: string | null,
  source: "mem0" | "rules",
): MemoryRecord {
  const now = Date.now();
  const inferred = inferMemoryKind(content);
  return {
    id: randomUUID(),
    scope: "agent",
    kind: inferred.kind,
    title: titleFromContent(content),
    content: content.trim().slice(0, 1_200),
    agent_id: DEFAULT_AGENT_ID,
    conversation_id: null,
    source_run_id: sourceRunId,
    salience: inferred.salience,
    pinned: 0,
    confidence: source === "mem0" ? inferred.confidence : Math.min(75, inferred.confidence),
    origin: "auto",
    status: "active",
    evidence_json: JSON.stringify([{ source, conversationId: sourceConversationId, at: now }]),
    last_used_at: null,
    expires_at: inferred.kind === "episode" ? now + 90 * 24 * 60 * 60 * 1000 : null,
    supersedes_id: null,
    created_at: now,
    updated_at: now,
  };
}

function upsertLearningMemory(candidate: MemoryRecord): MemoryRecord | null {
  const content = candidate.content.trim();
  if (!content) return null;
  const existing = findDuplicateMemory(candidate);
  if (!existing) {
    saveMemory(candidate);
    return candidate;
  }

  const merged: MemoryRecord = {
    ...existing,
    title: chooseBetterTitle(existing.title, candidate.title),
    content: chooseBetterContent(existing.content, candidate.content),
    salience: Math.max(existing.salience, candidate.salience),
    confidence: Math.min(100, Math.max(existing.confidence ?? 70, candidate.confidence ?? 70) + 3),
    evidence_json: appendEvidence(existing.evidence_json, candidate.evidence_json),
    status: "active",
    updated_at: Date.now(),
  };
  saveMemory(merged);
  return merged;
}

function findDuplicateMemory(candidate: MemoryRecord): MemoryRecord | null {
  const normalized = normalizeForMatch(candidate.content);
  const titleKey = normalizeForMatch(candidate.title);
  const memories = listMemories({ includeInactive: false });
  return (
    memories.find((memory) => {
      if (memory.id.startsWith("file-")) return false;
      if (memory.agent_id && candidate.agent_id && memory.agent_id !== candidate.agent_id) {
        return false;
      }
      const other = normalizeForMatch(memory.content);
      if (other === normalized) return true;
      if (normalizeForMatch(memory.title) === titleKey) return true;
      return jaccard(other, normalized) >= 0.82;
    }) ?? null
  );
}

function applyForgetIntents(messages: ReturnType<typeof listMessages>): number {
  const lastUserText = [...messages]
    .reverse()
    .filter((message) => message.role === "user")
    .map((message) => extractMessageText(message.content))
    .find(Boolean);
  if (!lastUserText || !looksLikeForgetIntent(lastUserText)) return 0;

  const now = Date.now();
  const all = /all (memories|memory)|everything|全部|所有|清空/i.test(lastUserText);
  const term = extractForgetTerm(lastUserText);
  const targets = listMemories({ includeInactive: false }).filter((memory) => {
    if (memory.id.startsWith("file-")) return false;
    if (all) return memory.origin === "auto" || memory.agent_id === DEFAULT_AGENT_ID;
    if (!term) return false;
    const haystack = `${memory.title} ${memory.content}`.toLowerCase();
    return haystack.includes(term.toLowerCase());
  });

  for (const memory of targets) {
    saveMemory({
      ...memory,
      status: "deleted",
      evidence_json: appendEvidence(
        memory.evidence_json,
        JSON.stringify([{ source: "forget-intent", text: lastUserText.slice(0, 240), at: now }]),
      ),
      updated_at: now,
    });
  }
  return targets.length;
}

function extractMemoryCandidates(messages: ReturnType<typeof listMessages>): string[] {
  const transcript = messages
    .filter((message) => message.role === "user")
    .slice(-12)
    .map((message) => extractMessageText(message.content))
    .join("\n")
    .slice(-MAX_INPUT_CHARS);
  const lines = transcript
    .split(/[\n。！？!?;；]+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 280);

  const durablePatterns = [
    /\bI (prefer|like|want|need|work|use|am|usually|always|often)\b/i,
    /\bmy (goal|preference|workflow|project|style|team|job|role|name)\b/i,
    /\bremember that\b/i,
    /我(喜欢|希望|需要|通常|经常|正在|是|叫|偏好|使用)/,
    /(我的|我目前的)(项目|目标|工作流|偏好|团队|角色|名字)/,
  ];
  return [
    ...new Set(lines.filter((line) => durablePatterns.some((pattern) => pattern.test(line)))),
  ];
}

function isSafeDurableMemory(text: string): boolean {
  const lower = text.toLowerCase();
  const sensitiveHints = [
    "password",
    "api key",
    "apikey",
    "token",
    "secret",
    "private key",
    "ssn",
    "credit card",
    "密码",
    "密钥",
    "令牌",
    "私钥",
    "身份证",
    "银行卡",
  ];
  return !sensitiveHints.some((hint) => lower.includes(hint));
}

function isLowValueEphemeral(text: string): boolean {
  const lower = text.toLowerCase();
  if (/^(ok|okay|thanks|thank you|好的|谢谢|嗯|哦)[.!。！]*$/i.test(text.trim())) return true;
  const ephemeralHints = [
    "just now",
    "right now only",
    "don't remember",
    "do not remember",
    "不要记",
    "别记住",
    "不用记",
  ];
  return ephemeralHints.some((hint) => lower.includes(hint));
}

function looksLikeForgetIntent(text: string): boolean {
  return /forget|do not remember|don't remember|delete .*memor|remove .*memor|忘记|不要记|别记住|删除.*记忆|清空.*记忆/i.test(
    text,
  );
}

function extractForgetTerm(text: string): string | null {
  const patterns = [
    /forget(?: about)?\s+(.+)/i,
    /delete .*memory .*?(?:about|for)\s+(.+)/i,
    /remove .*memory .*?(?:about|for)\s+(.+)/i,
    /忘记(.+)/,
    /不要记(?:住)?(.+)/,
    /删除.*记忆.*?(.+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && match.length >= 2) return match.slice(0, 80);
  }
  return null;
}

function inferMemoryKind(text: string): { kind: MemoryKind; salience: number; confidence: number } {
  const lower = text.toLowerCase();
  if (/\bmy name\b|\buser'?s name\b|我叫|我的名字/.test(lower)) {
    return { kind: "profile", salience: 92, confidence: 88 };
  }
  if (
    /\bi (prefer|like|want|need|dislike|hate|usually|always)\b|我(喜欢|希望|需要|偏好|讨厌|通常|总是)/i.test(
      text,
    )
  ) {
    return { kind: "preference", salience: 86, confidence: 82 };
  }
  if (/\bhow to\b|\bsteps to\b|流程|步骤|方法|工作流/i.test(text)) {
    return { kind: "skill", salience: 78, confidence: 76 };
  }
  if (/\byesterday\b|\blast week\b|\brecently\b|\btoday\b|昨天|上周|最近|今天/i.test(text)) {
    return { kind: "episode", salience: 62, confidence: 70 };
  }
  return { kind: "fact", salience: 72, confidence: 72 };
}

function appendEvidence(existing: string | undefined, incoming: string | undefined): string {
  const left = parseEvidence(existing);
  const right = parseEvidence(incoming);
  return JSON.stringify([...left, ...right].slice(-MAX_EVIDENCE_ITEMS));
}

function parseEvidence(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function chooseBetterTitle(a: string, b: string): string {
  return a.length <= b.length ? a : b;
}

function chooseBetterContent(a: string, b: string): string {
  if (b.length > a.length && b.length <= 1_200) return b;
  return a;
}

function titleFromContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? compact.slice(0, 45) + "..." : compact;
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / (left.size + right.size - overlap);
}

function extractMessageText(content: string): string {
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

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
