import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_ID,
  type MemoryPendingSuggestion,
  type MemoryRecord,
} from "../../shared/types";
import { insertRuntimeEvent, listMessages, saveMemory, updateVoidLearningState } from "./db";
import { addMemoriesFromConversation } from "./mem0-service";

const DEBOUNCE_MS = 1_200;
const MAX_INPUT_CHARS = 8_000;
const MAX_MEMORIES_PER_RUN = 3;

let queuedConversationId: string | null = null;
let timer: NodeJS.Timeout | null = null;
let worker: Promise<void> = Promise.resolve();

/** 进程级待确认记忆队列（不持久化，重启后清空） */
const pendingMemories: MemoryPendingSuggestion[] = [];

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

/** 获取当前待确认记忆列表（副本） */
export function listPendingMemories(): MemoryPendingSuggestion[] {
  return pendingMemories.slice();
}

/** 确认单条待确认记忆：写入 SQLite 并从队列移除 */
export function confirmPendingMemory(id: string): void {
  const index = pendingMemories.findIndex((m) => m.id === id);
  if (index === -1) return;
  const suggestion = pendingMemories[index];
  const now = Date.now();
  const memory: MemoryRecord = {
    id: suggestion.id,
    scope: suggestion.scope,
    kind: suggestion.kind,
    title: suggestion.title,
    content: suggestion.content,
    agent_id: suggestion.sourceAgentId,
    conversation_id: null,
    source_run_id: null,
    salience: suggestion.salience,
    pinned: 0,
    created_at: now,
    updated_at: now,
  };
  saveMemory(memory);
  pendingMemories.splice(index, 1);
}

/** 拒绝单条待确认记忆：直接从队列移除 */
export function rejectPendingMemory(id: string): void {
  const index = pendingMemories.findIndex((m) => m.id === id);
  if (index !== -1) pendingMemories.splice(index, 1);
}

/** 确认全部待确认记忆，返回确认数量 */
export function confirmAllPendingMemories(): number {
  const items = pendingMemories.splice(0, pendingMemories.length);
  for (const suggestion of items) {
    const now = Date.now();
    saveMemory({
      id: suggestion.id,
      scope: suggestion.scope,
      kind: suggestion.kind,
      title: suggestion.title,
      content: suggestion.content,
      agent_id: suggestion.sourceAgentId,
      conversation_id: null,
      source_run_id: null,
      salience: suggestion.salience,
      pinned: 0,
      created_at: now,
      updated_at: now,
    });
  }
  return items.length;
}

/** 拒绝全部待确认记忆，返回移除数量 */
export function rejectAllPendingMemories(): number {
  const count = pendingMemories.length;
  pendingMemories.length = 0;
  return count;
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

    // 尝试 Mem0 LLM 抽取，persist=false 先入队待确认
    let candidates: MemoryPendingSuggestion[] = [];
    let source = "regex";
    if (mem0Messages.length > 0) {
      const { records } = await addMemoriesFromConversation(
        mem0Messages,
        DEFAULT_AGENT_ID,
        conversationId,
        false,
      );
      candidates = records.map((record) => recordToPending(record, conversationId));
      if (candidates.length > 0) source = "mem0";
    }

    // 降级：Mem0 不可用时回退到正则抽取
    if (candidates.length === 0) {
      candidates = extractMemoryCandidates(messages)
        .slice(0, MAX_MEMORIES_PER_RUN)
        .map((content) => buildMemory(content, conversationId));
    }

    // 入队待确认，不直接保存
    for (const candidate of candidates) {
      if (!pendingMemories.some((m) => m.id === candidate.id)) {
        pendingMemories.push(candidate);
      }
    }

    // 正则降级路径仍需 append 到 soul_prompt（Mem0 路径通过语义搜索注入，无需 append）
    if (source === "regex" && candidates.length > 0) {
      updateVoidLearningState({
        status: "idle",
        lastLearningAt: Date.now(),
        soulPromptAppend: candidates.map((memory) => memory.content).join(" "),
      });
    } else {
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
        count: candidates.length,
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

function recordToPending(
  record: MemoryRecord,
  sourceConversationId: string,
): MemoryPendingSuggestion {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    scope: record.scope,
    kind: record.kind,
    salience: record.salience,
    suggestedAt: Date.now(),
    sourceConversationId,
    sourceAgentId: record.agent_id,
  };
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

function buildMemory(content: string, sourceConversationId: string): MemoryPendingSuggestion {
  const now = Date.now();
  return {
    id: randomUUID(),
    scope: "agent",
    kind: "profile",
    title: titleFromContent(content),
    content,
    salience: 70,
    suggestedAt: now,
    sourceConversationId,
    sourceAgentId: DEFAULT_AGENT_ID,
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
