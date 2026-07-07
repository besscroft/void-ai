import { randomUUID } from "node:crypto";
import { DEFAULT_AGENT_ID, type MemoryRecord } from "../../shared/types";
import { insertHarnessEvent, listMessages, saveMemory, updateVoidLearningState } from "./db";

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
  insertHarnessEvent({
    kind: "learning",
    title: "Void learning queued",
    status: "running",
    detail: { conversationId },
  });

  try {
    const messages = listMessages(conversationId);
    const candidates = extractMemoryCandidates(messages)
      .slice(0, MAX_MEMORIES_PER_RUN)
      .map((content) => buildMemory(content));

    for (const memory of candidates) saveMemory(memory);

    updateVoidLearningState({
      status: "idle",
      lastLearningAt: Date.now(),
      soulPromptAppend: candidates.map((memory) => memory.content).join(" "),
    });
    insertHarnessEvent({
      kind: "learning",
      title: "Void learning completed",
      status: "succeeded",
      detail: {
        conversationId,
        count: candidates.length,
        durationMs: Date.now() - started,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateVoidLearningState({ status: "failed", lastLearningAt: Date.now(), lastError: message });
    insertHarnessEvent({
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
    .split(/[\n。.!?！？]+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 240);

  const durablePatterns = [
    /\bI (prefer|like|want|need|work|use|am|usually|always)\b/i,
    /\bmy (goal|preference|workflow|project|style|team|job)\b/i,
    /我(喜欢|希望|需要|倾向|习惯|正在|是|常用|偏好)/,
    /我的(目标|偏好|工作流|项目|风格|团队|职业|习惯)/,
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
    "身份证",
    "密码",
    "密钥",
    "令牌",
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
