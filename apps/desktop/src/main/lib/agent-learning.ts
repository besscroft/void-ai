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

    // 尝试 Mem0 LLM 抽取（向量嵌入 + 存入内存索引 + 双写 SQLite）
    let count = 0;
    if (mem0Messages.length > 0) {
      count = await addMemoriesFromConversation(mem0Messages, DEFAULT_AGENT_ID, conversationId);
    }

    // 降级：Mem0 不可用时回退到正则抽取
    if (count === 0) {
      const candidates = extractMemoryCandidates(messages)
        .slice(0, MAX_MEMORIES_PER_RUN)
        .map((content) => buildMemory(content));
      for (const memory of candidates) saveMemory(memory);
      count = candidates.length;

      // 正则降级路径仍需 append 到 soul_prompt（Mem0 路径通过语义搜索注入，无需 append）
      updateVoidLearningState({
        status: "idle",
        lastLearningAt: Date.now(),
        soulPromptAppend: candidates.map((memory) => memory.content).join(" "),
      });
    } else {
      // Mem0 路径：记忆已写入 SQLite + 向量索引，buildAgentSystemPrompt 会语义检索
      updateVoidLearningState({
        status: "idle",
        lastLearningAt: Date.now(),
      });
    }

    insertRuntimeEvent({
      kind: "learning",
      title: "Void learning completed",
      status: "succeeded",
      detail: {
        conversationId,
        count,
        durationMs: Date.now() - started,
        source: count > 0 && mem0Messages.length > 0 ? "mem0" : "regex",
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
    .split(/[\n銆?!?锛侊紵]+/)
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
    "瀵嗙爜",
    "瀵嗛挜",
    "浠ょ墝",
  ];
  return !sensitiveHints.some((hint) => lower.includes(hint));
}

function buildMemory(content: string): MemoryRecord {
  const now = Date.now();
  return {
    id: randomUUID(),
    scope: "agent",
    kind: "profile",
    title: titleFromContent(content),
    content,
    agent_id: DEFAULT_AGENT_ID,
    conversation_id: null,
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
