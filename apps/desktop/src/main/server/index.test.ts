import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateReadableStream, type UIMessage } from "ai";
import {
  MockImageModelV4,
  MockLanguageModelV4,
  MockSpeechModelV4,
  MockTranscriptionModelV4,
  MockVideoModelV4,
} from "ai/test";
import { createApp } from "./index";
import {
  CHAT_SESSION_HEADER,
  type MediaGenerationKind,
  type ModelCapabilities,
} from "../../shared/types";

const token = "test-session-token";
const validMessages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];
const buildNoChatTools = () => ({ descriptors: [], toolChoice: "none" as const });

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

  void it("rejects unsupported chat reasoning levels", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat", reasoning: "extreme" }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /reasoning must be one of/);
  });

  void it("streams valid chat responses as an AI SDK UI message stream", async () => {
    const providerOptions = { mock: { reasoningEffort: "low" } };
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
        return { model, temperature: 0.7, topP: 1, maxOutputTokens: 256, providerOptions };
      },
      buildChatToolRuntime: buildNoChatTools,
      buildAgentSystemPrompt: () => "You are a test assistant.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat", reasoning: "high" }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    const body = await response.text();
    assert.match(body, /text-delta/);
    assert.match(body, /Hello/);
    assert.match(body, / from mock/);

    const chunks = parseSseJsonChunks(body);
    const startChunk = chunks.find((chunk) => chunk.type === "start");
    const finishChunk = chunks.find((chunk) => chunk.type === "finish");
    const startExecution = readExecutionMetadata(startChunk);
    const finishExecution = readExecutionMetadata(finishChunk);
    assert.equal(startExecution?.model, "mock/chat");
    assert.equal(typeof startExecution?.startedAt, "number");
    assert.equal(finishExecution?.model, "mock/chat");
    assert.equal(finishExecution?.finishReason, "stop");
    assert.equal(finishExecution?.inputTokens, 3);
    assert.equal(finishExecution?.outputTokens, 4);
    assert.equal(finishExecution?.totalTokens, 7);
    assert.equal(typeof finishExecution?.durationMs, "number");

    assert.deepEqual(model.doStreamCalls[0]?.providerOptions, providerOptions);
    assert.equal(model.doStreamCalls[0]?.reasoning, "high");
  });

  void it("routes OpenAI chat requests through the Agents SDK runtime", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [],
        }),
      }),
    });
    let called = false;
    const toolSelection = { mode: "manual" as const, selectedToolIds: ["memory_search" as const] };
    const app = createApp({
      sessionToken: token,
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "openai/gpt-test");
        return {
          model,
          providerId: "openai",
          providerKind: "openai",
          modelId: "gpt-test",
          temperature: 0.7,
          topP: 1,
          maxOutputTokens: 256,
        };
      },
      buildChatToolRuntime: () => {
        throw new Error("AI SDK fallback should not run for OpenAI provider models.");
      },
      buildAgentSystemPrompt: () => "Void root prompt",
      runOpenAIAgentsChat: async (options) => {
        called = true;
        assert.equal(options.modelRef, "openai/gpt-test");
        assert.equal(options.conversationId, "c-openai");
        assert.equal(options.preferredAgentId, "agent-analyst");
        assert.equal(options.reasoning, "high");
        assert.deepEqual(options.toolSelection, toolSelection);
        assert.equal(options.buildAgentSystemPrompt("agent-void", "c-openai"), "Void root prompt");
        return new Response("agents-stream", {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
        });
      },
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "openai/gpt-test",
        agentId: "agent-analyst",
        conversationId: "c-openai",
        reasoning: "high",
        toolSelection,
      }),
    });

    assert.equal(called, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    assert.equal(await response.text(), "agents-stream");
  });

  void it("injects prior assistant reactions into agent instructions", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Adjusted answer" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Explain streams" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "This answer used a terse explanation." }],
        metadata: {
          reaction: { emoji: "\u{1F44D}", label: "helpful", createdAt: 123 },
        },
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Continue" }] },
    ];
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildChatToolRuntime: buildNoChatTools,
      buildAgentSystemPrompt: () => "Base instructions.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages, model: "mock/chat" }),
    });

    assert.equal(response.status, 200);
    await response.text();
    const call = JSON.stringify(model.doStreamCalls[0]);
    assert.match(call, /Base instructions/);
    assert.match(call, /Private user feedback/);
    assert.match(call, /helpful/);
    assert.match(call, /This answer used a terse explanation/);
  });
  void it("omits provider-default reasoning when calling the model", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildChatToolRuntime: buildNoChatTools,
      buildAgentSystemPrompt: () => "You are a test assistant.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        reasoning: "provider-default",
      }),
    });

    assert.equal(response.status, 200);
    await response.text();
    assert.equal(model.doStreamCalls[0]?.reasoning, undefined);
  });

  void it("omits none reasoning when calling the model", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildChatToolRuntime: buildNoChatTools,
      buildAgentSystemPrompt: () => "You are a test assistant.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        reasoning: "none",
      }),
    });

    assert.equal(response.status, 200);
    await response.text();
    assert.equal(model.doStreamCalls[0]?.reasoning, undefined);
  });

  void it("omits incompatible minimal reasoning for openai-compatible models", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({
        model,
        providerKind: "openai-compatible",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 256,
      }),
      buildChatToolRuntime: buildNoChatTools,
      buildAgentSystemPrompt: () => "You are a test assistant.",
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        reasoning: "minimal",
      }),
    });

    assert.equal(response.status, 200);
    await response.text();
    assert.equal(model.doStreamCalls[0]?.reasoning, undefined);
  });
});

const mediaCapabilities: ModelCapabilities = {
  textGeneration: false,
  vision: false,
  imageOutput: true,
  speechOutput: true,
  transcription: true,
  videoOutput: true,
  toolCalling: false,
  reasoning: false,
  embedding: false,
};

void describe("local chat server /api/media/generate", () => {
  void it("rejects media generation without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/media/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "image", model: "mock/image", prompt: "hi" }),
    });

    assert.equal(response.status, 401);
  });

  void it("rejects missing media request parameters", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/media/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ kind: "image", model: "mock/image" }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /prompt is required/);
  });

  void it("generates image, speech, transcription, and video responses", async () => {
    const imageModel = new MockImageModelV4({
      doGenerate: async () => ({
        images: [new Uint8Array([1, 2, 3])],
        warnings: [],
        response: mockResponse("image"),
        providerMetadata: {},
      }),
    });
    const speechModel = new MockSpeechModelV4({
      doGenerate: async () => ({
        audio: new Uint8Array([1, 2, 3, 4]),
        warnings: [],
        response: mockResponse("speech"),
        providerMetadata: {},
      }),
    });
    const transcriptionModel = new MockTranscriptionModelV4({
      doGenerate: async () => ({
        text: "hello transcript",
        segments: [{ text: "hello", startSecond: 0, endSecond: 1 }],
        language: "en",
        durationInSeconds: 1,
        warnings: [],
        response: mockResponse("transcription"),
        providerMetadata: {},
      }),
    });
    const videoModel = new MockVideoModelV4({
      doGenerate: async () => ({
        videos: [
          { type: "binary" as const, data: new Uint8Array([1, 2, 3]), mediaType: "video/mp4" },
        ],
        warnings: [],
        response: mockResponse("video"),
        providerMetadata: {},
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveMediaModel: ((modelRef: string, kind: MediaGenerationKind) => {
        assert.match(modelRef, /^mock\//);
        const model =
          kind === "image"
            ? imageModel
            : kind === "speech"
              ? speechModel
              : kind === "transcription"
                ? transcriptionModel
                : videoModel;
        return {
          kind,
          model,
          providerId: "mock",
          providerKind: "openai-compatible",
          modelId: kind,
          capabilities: mediaCapabilities,
          providerOptions: {},
        };
      }) as typeof import("../lib/providers").resolveMediaModel,
      writeMediaAsset: ({ data, mediaType, kind, filename }) => ({
        type: "file" as const,
        mediaType,
        filename: `${filename ?? kind}.bin`,
        url: `void-media://asset/${kind}.bin`,
        size: data.byteLength,
      }),
    });

    const image = await postMedia(app, { kind: "image", model: "mock/image", prompt: "draw" });
    assert.equal(image.status, 200);
    assert.equal(((await image.json()) as { files: unknown[] }).files.length, 1);

    const speech = await postMedia(app, { kind: "speech", model: "mock/speech", text: "hello" });
    assert.equal(speech.status, 200);
    const speechBody = (await speech.json()) as { files: Array<{ mediaType: string }> };
    assert.equal(speechBody.files[0]?.mediaType.startsWith("audio/"), true);

    const transcription = await postMedia(app, {
      kind: "transcription",
      model: "mock/transcription",
      audio: { url: "data:audio/wav;base64,AA==", mediaType: "audio/wav", filename: "clip.wav" },
    });
    assert.equal(transcription.status, 200);
    const transcriptionBody = (await transcription.json()) as {
      text: string;
      metadata: { language?: string };
    };
    assert.equal(transcriptionBody.text, "hello transcript");
    assert.equal(transcriptionBody.metadata.language, "en");

    const video = await postMedia(app, {
      kind: "video",
      model: "mock/video",
      prompt: "make video",
    });
    assert.equal(video.status, 200);
    const videoBody = (await video.json()) as { files: Array<{ mediaType: string }> };
    assert.equal(videoBody.files[0]?.mediaType, "video/mp4");
  });
});

function parseSseJsonChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function readExecutionMetadata(
  chunk: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const metadata = chunk?.messageMetadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const execution = (metadata as { execution?: unknown }).execution;
  return execution && typeof execution === "object"
    ? (execution as Record<string, unknown>)
    : undefined;
}
function postMedia(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request("/api/media/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify(body),
    }),
  );
}

function mockResponse(modelId: string): {
  modelId: string;
  timestamp: Date;
  headers: Record<string, string>;
} {
  return { modelId, timestamp: new Date(0), headers: {} };
}

void describe("local chat server /api/title", () => {
  void it("rejects title posts without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 401);
  });

  void it("rejects title posts without a model reference", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 400);
  });

  void it("generates a sanitized title from the model", async () => {
    const providerOptions = { mock: { textVerbosity: "low" } };
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text" as const, text: '  "\u91cf\u5b50\u8ba1\u7b97\u5165\u95e8"  ' }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "mock/chat");
        return { model, temperature: 0.4, topP: 1, maxOutputTokens: 64, providerOptions };
      },
      buildAgentSystemPrompt: () => "",
    });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { title: string };
    assert.equal(body.title, "\u91cf\u5b50\u8ba1\u7b97\u5165\u95e8");
    assert.deepEqual(model.doGenerateCalls[0]?.providerOptions, providerOptions);
  });
});
