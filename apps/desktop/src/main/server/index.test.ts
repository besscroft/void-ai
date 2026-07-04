import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "./index";
import { CHAT_SESSION_HEADER } from "../../shared/types";

const token = "test-session-token";
const validMessages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];

void describe("local chat server", () => {
  void it("answers chat CORS preflight for allowed renderer origins", async () => {
    const app = createApp({ sessionToken: token, getAssignedPort: () => 4321 });

    const response = await app.request("/api/chat", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": `content-type, ${CHAT_SESSION_HEADER}`,
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/i);
    assert.match(
      response.headers.get("access-control-allow-headers") ?? "",
      new RegExp(CHAT_SESSION_HEADER, "i"),
    );
  });

  void it("rejects chat posts without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized chat session" });
  });

  void it("rejects empty message arrays", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: [] }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "messages cannot be empty" });
  });

  void it("rejects requests without a model reference", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "model is required in provider/model format",
    });
  });

  void it("streams valid chat responses as an AI SDK UI message stream", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-delta", id: "text-1", delta: " from mock" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 4, text: 4, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "mock/chat");
        return { model, temperature: 0.7, topP: 1, maxOutputTokens: 256 };
      },
      buildAgentSystemPrompt: () => "You are a test assistant.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    const body = await response.text();
    assert.match(body, /text-delta/);
    assert.match(body, /Hello/);
    assert.match(body, / from mock/);
  });
});
