import type { UIMessage } from "ai";
import { api } from "./api";
import { buildMessageSnapshotRows } from "./chat-messages";

export interface MessagePersistenceRequest {
  messages: UIMessage[];
  deleteIds?: string[];
}

export interface RevisionRef {
  current: number;
}

export interface SnapshotPersistenceQueue<T> {
  request: (snapshot: T) => void;
  flush: (snapshot?: T) => Promise<void>;
}

export function createSnapshotPersistenceQueue<T>(
  persist: (snapshot: T) => Promise<void>,
  onError?: (error: unknown) => void,
  mergePending?: (pending: T, incoming: T) => T,
): SnapshotPersistenceQueue<T> {
  let pending: T | undefined;
  let running: Promise<void> | null = null;

  const start = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        await persist(snapshot);
      }
    })().finally(() => {
      running = null;
      if (pending !== undefined) void start();
    });
    return running;
  };

  return {
    request(snapshot) {
      pending = pending !== undefined && mergePending ? mergePending(pending, snapshot) : snapshot;
      void start().catch((error) => onError?.(error));
    },
    flush(snapshot) {
      if (snapshot !== undefined) {
        pending =
          pending !== undefined && mergePending ? mergePending(pending, snapshot) : snapshot;
      }
      return start();
    },
  };
}

export function mergeMessagePersistenceRequests(
  pending: MessagePersistenceRequest,
  incoming: MessagePersistenceRequest,
): MessagePersistenceRequest {
  return {
    messages: incoming.messages,
    deleteIds: [...new Set([...(pending.deleteIds ?? []), ...(incoming.deleteIds ?? [])])],
  };
}

export async function persistMessagesPatch(
  conversationId: string,
  request: MessagePersistenceRequest,
  createdAtById: Map<string, number>,
  revision: RevisionRef,
): Promise<void> {
  const rows = buildMessageSnapshotRows({
    conversationId,
    messages: request.messages,
    createdAtById,
  });
  const deleteIds = [...new Set(request.deleteIds ?? [])];
  if (rows.length === 0 && deleteIds.length === 0) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await api.messages.applyPatch({
      conversationId,
      baseRevision: revision.current,
      upserts: rows,
      deleteIds,
    });
    if (result.applied) {
      revision.current = result.revision;
      for (const row of rows) createdAtById.set(row.id, row.created_at);
      for (const id of deleteIds) createdAtById.delete(id);
      return;
    }

    const snapshot = await api.messages.list(conversationId);
    revision.current = snapshot.revision;
    for (const row of snapshot.messages) {
      if (!createdAtById.has(row.id)) createdAtById.set(row.id, row.created_at);
    }
  }
  throw new Error("Message history changed repeatedly while saving. Please retry.");
}
