/**
 * Mem0 OSS 记忆层服务
 *
 * 封装 Mem0 自托管开源版的核心操作：实例管理、语义搜索、记忆抽取、重水合。
 * 采用"内存向量索引 + SQLite 镜像"双写策略，应用启动时从 SQLite 重水合到内存索引。
 * 无 OpenAI API Key 时自动降级到全量查询，保证可用性。
 */

import { Memory } from "mem0ai/oss";
import { app } from "electron";
import { join } from "node:path";
import { getApiKey, listMemories, saveMemory } from "./db";
import { DEFAULT_AGENT_ID, type MemoryRecord } from "../../shared/types";

/** Mem0 实例单例（null 表示降级模式或尚未初始化） */
let memoryInstance: Memory | null = null;

/** 是否已完成从 SQLite 到内存向量索引的重水合 */
let rehydrated = false;

/**
 * 获取 Mem0 实例，无 OpenAI Key 时返回 null（降级模式）。
 * 首次调用时初始化实例并从 SQLite 重水合历史记忆。
 */
export async function getMemory(): Promise<Memory | null> {
  if (memoryInstance) return memoryInstance;

  const apiKey = getApiKey("openai");
  if (!apiKey) return null;

  // Mem0 history 使用独立 db 文件，与主库 void-ai.db 隔离
  const historyDbPath = join(
    process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData"),
    "data",
    "mem0-history.db",
  );

  memoryInstance = new Memory({
    llm: { provider: "openai", config: { apiKey, model: "gpt-5-mini" } },
    embedder: { provider: "openai", config: { apiKey, model: "text-embedding-3-small" } },
    vectorStore: {
      provider: "memory",
      config: { collectionName: "void-memories", dimension: 1536 },
    },
    historyDbPath,
  });

  if (!rehydrated) {
    await rehydrateFromSQLite();
    rehydrated = true;
  }

  return memoryInstance;
}

/**
 * 启动时从 SQLite 重水合到 Mem0 内存向量索引。
 *
 * 内存向量存储在进程重启后丢失，需要从 SQLite 持久化数据重建。
 * 使用 infer: false 跳过 LLM 抽取，直接存储已有记忆的嵌入。
 */
async function rehydrateFromSQLite(): Promise<void> {
  if (!memoryInstance) return;
  const existing = listMemories();
  for (const mem of existing) {
    try {
      await memoryInstance.add([{ role: "user", content: `${mem.title}: ${mem.content}` }], {
        userId: mem.agent_id ?? "global",
        runId: mem.conversation_id ?? undefined,
        metadata: { sqliteId: mem.id, scope: mem.scope, kind: mem.kind },
        infer: false,
      });
    } catch (error) {
      // 单条重水合失败不应阻断整体流程
      console.warn("[mem0-service] rehydrate skip memory:", mem.id, error);
    }
  }
}

/**
 * 语义搜索记忆。
 * Mem0 不可用时降级到全量过滤（按 scope/agent_id/conversation_id 匹配）。
 */
export async function searchMemoriesSemantic(
  query: string,
  agentId?: string | null,
  conversationId?: string,
  limit = 8,
): Promise<MemoryRecord[]> {
  const memory = await getMemory();
  if (!memory) {
    // 降级：无 API Key，回退到全量过滤
    return listMemories()
      .filter(
        (m) =>
          m.scope === "global" ||
          m.agent_id === agentId ||
          (conversationId != null && m.conversation_id === conversationId),
      )
      .slice(0, limit);
  }

  const results = await memory.search(query, {
    filters: agentId ? { user_id: agentId } : undefined,
    topK: limit,
  });

  return results.results.slice(0, limit).map((r) => ({
    id: (r.metadata?.sqliteId as string) ?? r.id,
    scope: (r.metadata?.scope as MemoryRecord["scope"]) ?? "agent",
    kind: (r.metadata?.kind as MemoryRecord["kind"]) ?? "fact",
    title: r.memory.slice(0, 36),
    content: r.memory,
    agent_id: agentId ?? null,
    conversation_id: null,
    source_run_id: null,
    salience: 70,
    pinned: 0,
    confidence: 70,
    origin: "auto",
    status: "active",
    evidence_json: "[]",
    last_used_at: null,
    expires_at: null,
    supersedes_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  }));
}

/**
 * 通过 Mem0 LLM 抽取记忆。
 * - persist=true（默认）：双写到向量索引 + SQLite，返回数量与记录。
 * - persist=false：仅做抽取并返回记录，不写入 SQLite。
 * Mem0 不可用时返回空数组（由调用方回退到正则）。
 */
export async function addMemoriesFromConversation(
  messages: Array<{ role: string; content: string }>,
  agentId?: string | null,
  conversationId?: string,
  persist = true,
): Promise<{ count: number; records: MemoryRecord[] }> {
  const memory = await getMemory();
  if (!memory) return { count: 0, records: [] }; // 降级：由调用方回退到正则

  const result = await memory.add(messages, {
    userId: agentId ?? DEFAULT_AGENT_ID,
    runId: conversationId ?? undefined,
    metadata: { source: "auto-learning", agentId: agentId ?? DEFAULT_AGENT_ID },
  });

  const extracted = result?.results ?? [];
  const records: MemoryRecord[] = [];
  for (const item of extracted) {
    if (!item.memory) continue;
    const inferred = inferMemoryKind(item.memory);
    const record: MemoryRecord = {
      id: item.id,
      scope: "agent",
      kind: inferred.kind,
      title: item.memory.slice(0, 33) + (item.memory.length > 33 ? "..." : ""),
      content: item.memory,
      agent_id: agentId ?? DEFAULT_AGENT_ID,
      conversation_id: null,
      source_run_id: null,
      salience: inferred.salience,
      pinned: 0,
      confidence: inferred.salience,
      origin: "auto",
      status: "active",
      evidence_json: JSON.stringify([{ source: "mem0", conversationId, at: Date.now() }]),
      last_used_at: null,
      expires_at: null,
      supersedes_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    records.push(record);
    if (persist) saveMemory(record);
  }
  return { count: records.length, records };
}

/**
 * 根据记忆内容推断 kind 与重要性。
 * 用于提升自动保存后文件层分类的准确性。
 */
function inferMemoryKind(text: string): { kind: MemoryRecord["kind"]; salience: number } {
  const lower = text.toLowerCase();
  const userMarkers = [
    "i prefer",
    "i like",
    "i want",
    "i need",
    "i dislike",
    "i hate",
    "my name",
    "my role",
    "my job",
    "my team",
    "my project",
    "i work",
    "i use",
    "i am",
    "i'm",
    "my workflow",
    "my style",
  ];
  const isUser = userMarkers.some((m) => lower.includes(m));
  if (isUser) return { kind: "preference", salience: 85 };

  const profileMarkers = ["user is", "user works as", "user's name", "user's role", "user speaks"];
  if (profileMarkers.some((m) => lower.includes(m))) return { kind: "profile", salience: 90 };

  const skillMarkers = ["how to", "steps to", "guide to", "recipe for", "pattern for"];
  if (skillMarkers.some((m) => lower.includes(m))) return { kind: "skill", salience: 80 };

  const episodeMarkers = ["yesterday", "last week", "recently", "earlier", "today i", "then we"];
  if (episodeMarkers.some((m) => lower.includes(m))) return { kind: "episode", salience: 65 };

  return { kind: "fact", salience: 70 };
}

/**
 * 同步更新 Mem0 内存向量索引中的单条记忆。
 * SQLite 被手动/工具更新后调用，保持两者一致。
 */
export async function updateMemoryInVectorStore(memory: MemoryRecord): Promise<void> {
  const memoryInstance = await getMemory();
  if (!memoryInstance) return;
  try {
    await memoryInstance.update(memory.id, `${memory.title}: ${memory.content}`);
  } catch (error) {
    console.warn("[mem0-service] updateMemoryInVectorStore failed:", memory.id, error);
  }
}

/**
 * 同步删除 Mem0 内存向量索引中的单条记忆。
 * SQLite 被删除后调用，保持两者一致。
 */
export async function deleteMemoryFromVectorStore(id: string): Promise<void> {
  const memoryInstance = await getMemory();
  if (!memoryInstance) return;
  try {
    await memoryInstance.delete(id);
  } catch (error) {
    console.warn("[mem0-service] deleteMemoryFromVectorStore failed:", id, error);
  }
}

/**
 * 重置 Mem0 实例。
 * API Key 变更后调用，使下次 getMemory() 重新初始化。
 */
export function resetMemoryInstance(): void {
  memoryInstance = null;
  rehydrated = false;
}

/** 重建内存向量索引；后台 job 可调用，失败由调用方吞掉并记录。 */
export async function rehydrateMemoryVectorStore(): Promise<void> {
  resetMemoryInstance();
  await getMemory();
}
