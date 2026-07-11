import type { UIMessage } from "ai";
import { api } from "./api";
import { buildMessageSnapshotRows } from "./chat-messages";

export interface SnapshotPersistenceQueue<T> {
  request: (snapshot: T) => void;
  flush: (snapshot?: T) => Promise<void>;
}

export function createSnapshotPersistenceQueue<T>(
  persist: (snapshot: T) => Promise<void>,
  onError?: (error: unknown) => void,
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
      pending = snapshot;
      void start().catch((error) => onError?.(error));
    },
    flush(snapshot) {
      if (snapshot !== undefined) pending = snapshot;
      return start();
    },
  };
}

export async function persistMessagesSnapshot(
  conversationId: string,
  messages: UIMessage[],
  createdAtById: Map<string, number>,
): Promise<void> {
  const rows = buildMessageSnapshotRows({ conversationId, messages, createdAtById });
  await api.messages.replaceSnapshot(conversationId, rows);
  for (const row of rows) createdAtById.set(row.id, row.created_at);
}
