import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSnapshotPersistenceQueue, persistMessagesSnapshot } from "./chat-persistence";

void describe("chat snapshot persistence queue", () => {
  void it("serializes writes and coalesces queued snapshots to the latest value", async () => {
    const persisted: number[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = createSnapshotPersistenceQueue<number>(async (snapshot) => {
      if (persisted.length === 0) await firstBlocked;
      persisted.push(snapshot);
    });

    queue.request(1);
    queue.request(2);
    queue.request(3);
    releaseFirst();
    await queue.flush();

    assert.deepEqual(persisted, [1, 3]);
  });

  void it("flushes an explicitly supplied final snapshot", async () => {
    const persisted: string[] = [];
    const queue = createSnapshotPersistenceQueue<string>(async (snapshot) => {
      persisted.push(snapshot);
    });

    await queue.flush("final");

    assert.deepEqual(persisted, ["final"]);
  });

  void it("replaces the stored snapshot even when the conversation is empty", async () => {
    const calls: Array<{ conversationId: string; rowCount: number }> = [];
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        api: {
          messages: {
            replaceSnapshot: async (conversationId: string, rows: unknown[]) => {
              calls.push({ conversationId, rowCount: rows.length });
              return true;
            },
          },
        } as unknown as NonNullable<Window["api"]>,
      },
    });

    try {
      await persistMessagesSnapshot("conversation-1", [], new Map());
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }

    assert.deepEqual(calls, [{ conversationId: "conversation-1", rowCount: 0 }]);
  });
});
