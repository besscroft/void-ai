import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import {
  AgentContextManager,
  estimateMessageTokens,
  splitRecentMessages,
} from "./agent-context-manager";

const fakeModel = {} as LanguageModel;

void describe("AgentContextManager", () => {
  void it("keeps short contexts unchanged", async () => {
    const manager = new AgentContextManager({
      runId: "run",
      agentPath: "/root",
      modelRef: "test/model",
      model: fakeModel,
      contextWindow: 10_000,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.6,
        compactThreshold: 0.75,
        targetRatio: 0.5,
        keepRecentTokens: 2_000,
      },
      summarize: async () => "summary",
    });
    assert.equal(await manager.prepare([{ role: "user", content: "hello" }]), undefined);
  });

  void it("creates an auditable semantic checkpoint and preserves the recent tail", async () => {
    const checkpoints: string[] = [];
    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:${"x".repeat(600)}`,
    }));
    const manager = new AgentContextManager({
      runId: "run",
      conversationId: "conversation",
      agentPath: "/root/researcher",
      modelRef: "test/model",
      model: fakeModel,
      contextWindow: 1_000,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.3,
        compactThreshold: 0.4,
        targetRatio: 0.2,
        keepRecentTokens: 1_000,
      },
      summarize: async (older) => `summary:${older.length}`,
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint.summary),
    });
    const compacted = await manager.prepare(messages);
    assert.ok(compacted);
    assert.equal(compacted?.[0]?.role, "system");
    assert.match(String(compacted?.[0]?.content), /summary:/);
    assert.equal(checkpoints.length, 1);
    assert.ok(estimateMessageTokens(compacted ?? []) < estimateMessageTokens(messages));
  });

  void it("splits on whole messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "latest" },
    ];
    const split = splitRecentMessages(messages, 40);
    assert.equal(split.recent.at(-1), messages.at(-1));
    assert.equal(split.older.length + split.recent.length, messages.length);
  });
});
