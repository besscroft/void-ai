import { randomUUID } from "node:crypto";
import { DEFAULT_AGENT_ID, type MemoryRecord } from "../../shared/types";
import { insertRuntimeEvent, listMessages, saveMemory, updateVoidLearningState } from "./db";
import { addMemoriesFromConversation } from "./mem0-service";

const DEBOUNCE_MS = 1_200;
const MAX_INPUT_CHARS = 8_000;
const MAX_MEMORIES_PER_RUN = 3;

let queuedConversationId: string | null = null;
let timer: NodeJS.Timeout | null = null;
let worker: Promise<void> = Promise.resolve();

export function queueAgentLearning(conversationId: string): void {
  queuedConversationId = conversationId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const nextConversationId = queuedConversationId;
    queuedConversationId = null;
    timer = null;
    if (!nextConversationId) return;
    worker = worker.catch(() => undefined).then(() => runLearning(nextConversationId));
  }, DEBOUNCE_MS);
}

async function runLearning(conversationId: string): Promise<void> {
  const started = Date.now();
  updateVoidLearningState({ status: "learning" });
  insertRuntimeEvent({
    kind: "learning",
    title: "Void learning queued",
    status: "running",
    detail: { conversationId },
  });

  try {
    const messages = listMessages(conversationId);

    // 准备 Mem0 格式的消息（取最近 12 条，提取文本内容）
    const mem0Messages = messages
      .slice(-12)
      .map((m) => ({
        role: m.role,
        content: extractMessageText(m.content),
      }))
      .filter((m) => m.content.length > 0);

    // 尝试 Mem0 LLM 抽取并直接持久化
    let records: MemoryRecord[] = [];
    let source = "regex";
    if (mem0Messages.length > 0) {
      const { records: extracted } = await addMemoriesFromConversation(
        mem0Messages,
        DEFAULT_AGENT_ID,
        conversationId,
        true,
      );
      records = extracted;
      if (records.length > 0) source = "mem0";
    }

    // 降级：Mem0 不可用时回退到正则抽取
    if (records.length === 0) {
      records = extractMemoryCandidates(messages)
        .slice(0, MAX_MEMORIES_PER_RUN)
        .map((content) => buildMemoryRecord(content, conversationId));
      for (const record of records) {
        saveMemory(record);
      }
    }

    // 异步整理到文件层（不阻塞）
    if (records.length > 0) {
      import("./agent-memory-files")
        .then(({ incorporateNewMemories }) => incorporateNewMemories(records))
        .catch((err) => console.warn("[agent-learning] incorporate failed:", err));
    }

    updateVoidLearningState({ status: "idle", lastLearningAt: Date.now() });

    insertRuntimeEvent({
      kind: "learning",
      title: "Void learning completed",
      status: "succeeded",
      detail: {
        conversationId,
        savedCount: records.length,
        durationMs: Date.now() - started,
        source,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateVoidLearningState({ status: "failed", lastLearningAt: Date.now(), lastError: message });
    insertRuntimeEvent({
      kind: "learning",
      title: "Void learning failed",
      status: "failed",
      detail: { conversationId, error: message, durationMs: Date.now() - started },
    });
  }
}

function extractMemoryCandidates(messages: ReturnType<typeof listMessages>): string[] {
  const transcript = messages
    .filter((message) => message.role === "user")
    .slice(-12)
    .map((message) => extractMessageText(message.content))
    .join("\n")
    .slice(-MAX_INPUT_CHARS);
  const lines = transcript
    .split(/[\n。?!！？,，]+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 240);

  const durablePatterns = [
    /\bI (prefer|like|want|need|work|use|am|usually|always)\b/i,
    /\bmy (goal|preference|workflow|project|style|team|job)\b/i,
    /\b(I|my)\b/i,
  ];
  return [...new Set(lines.filter((line) => durablePatterns.some((pattern) => pattern.test(line))))]
    .filter(isSafeDurableMemory)
    .map((line) => line.slice(0, 240));
}

function isSafeDurableMemory(text: string): boolean {
  const lower = text.toLowerCase();
  const sensitiveHints = [
    "password",
    "api key",
    "token",
    "secret",
    "ssn",
    "identity",
    "密码",
    "密钥",
    "令牌",
  ];
  return !sensitiveHints.some((hint) => lower.includes(hint));
}

function buildMemoryRecord(content: string, sourceConversationId: string): MemoryRecord {
  const now = Date.now();
  return {
    id: randomUUID(),
    scope: "agent",
    kind: "profile",
    title: titleFromContent(content),
    content,
    agent_id: DEFAULT_AGENT_ID,
    conversation_id: sourceConversationId,
    source_run_id: null,
    salience: 70,
    pinned: 0,
    created_at: now,
    updated_at: now,
  };
}

function titleFromContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 36 ? compact.slice(0, 33) + "..." : compact;
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
