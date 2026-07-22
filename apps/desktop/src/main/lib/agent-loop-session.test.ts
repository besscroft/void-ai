import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import { DEFAULT_AGENT_ID } from "../../shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: { isPackaged: false, getPath: () => process.env.VOID_AI_USER_DATA_DIR ?? process.cwd() },
};
require.cache[electronPath] = electronModule;

let db: typeof import("./db");
let sessionModule: typeof import("./agent-loop-session");
let testRoot = "";
let conversationId = "";

before(async () => {
  db = await import("./db");
  sessionModule = await import("./agent-loop-session");
});

beforeEach(async () => {
  db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "void-ai-agent-loop-"));
  process.env.VOID_AI_USER_DATA_DIR = testRoot;
  db.initDb();
  conversationId = randomUUID();
  db.createConversation(conversationId);
});

afterEach(async () => {
  db.closeDb();
  delete process.env.VOID_AI_USER_DATA_DIR;
  await rm(testRoot, { recursive: true, force: true });
});

void describe("AgentLoopSessionManager", () => {
  void it("drains steering FIFO before follow-up and keeps one run id", () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = manager.start(baseOptions(runId));
    manager.enqueue(runId, "steering", "user", message("s1"));
    manager.enqueue(runId, "steering", "user", message("s2"));
    manager.enqueueFollowUp(runId, message("f1"));

    assert.deepEqual(session.drain("steering").map(readText), ["s1", "s2"]);
    assert.deepEqual(session.drain("follow_up").map(readText), ["f1"]);
    assert.equal(manager.start({ ...baseOptions(runId), mode: "resume" }), session);
    session.complete();
  });

  void it("records budget exhaustion and discards queued input", () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = manager.start({
      ...baseOptions(runId),
      runtimeConfig: { maxTurns: 1, maxDurationMs: 600_000, maxToolCalls: 50 },
    });
    manager.enqueueFollowUp(runId, message("pending"));
    assert.equal(session.recordStep(), "max_turns");
    session.complete("done");

    assert.equal(db.getRuntimeRun(runId)?.finish_reason, "budget_exhausted");
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "discarded");
  });

  void it("cancels without consuming queued input", () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    manager.start(baseOptions(runId));
    manager.enqueue(runId, "steering", "user", message("pending"));
    assert.equal(manager.cancel(runId), true);
    assert.equal(db.getRuntimeRun(runId)?.finish_reason, "cancelled");
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "discarded");
  });
});

function baseOptions(runId: string) {
  return {
    runId,
    conversationId,
    rootAgentId: DEFAULT_AGENT_ID,
    modelRef: "mock/chat",
    mode: "start" as const,
  };
}

function message(text: string): UIMessage {
  return { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

function readText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
