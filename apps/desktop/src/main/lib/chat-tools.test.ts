import { afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { ChatToolModelContext } from "./chat-tools";
import type { ModelCapabilities, ModelProviderKind } from "../../shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: {
    isPackaged: false,
    getPath: () => process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

let chatTools: typeof import("./chat-tools");
const originalFetch = globalThis.fetch;

before(async () => {
  chatTools = await import("./chat-tools");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("chat tool runtime", () => {
  void it("maps off mode to no tools and toolChoice none", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "off", selectedToolIds: ["memory_search"] },
      model: modelContext("openai", "web_search"),
      conversationId: "c1",
    });

    assert.equal(runtime.tools, undefined);
    assert.equal(runtime.activeTools, undefined);
    assert.equal(runtime.toolChoice, "none");
  });

  void it("maps auto mode to safe default tools including native web search", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "auto", selectedToolIds: [] },
      model: modelContext("openai", "web_search"),
      conversationId: "c1",
    });

    assert.deepEqual(runtime.activeTools, [
      "web_search",
      "current_time",
      "memory_search",
      "workspace_snapshot",
      "model_capabilities",
    ]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.stopWhen, "function");
  });

  void it("maps manual single and multiple selections to forced tool choices", () => {
    const single = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["memory_search"] },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(single.activeTools, ["memory_search"]);
    assert.deepEqual(single.toolChoice, { type: "tool", toolName: "memory_search" });

    const multiple = chatTools.buildChatToolRuntime({
      selection: {
        mode: "manual",
        selectedToolIds: ["memory_search", "workspace_snapshot"],
      },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(multiple.activeTools, ["memory_search", "workspace_snapshot"]);
    assert.equal(multiple.toolChoice, "required");
  });

  void it("uses provider-native web search internal tool names", () => {
    const openai = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(openai.activeTools, ["web_search"]);
    assert.deepEqual(openai.toolChoice, { type: "tool", toolName: "web_search" });

    const anthropic = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("anthropic", "web_search"),
    });
    assert.deepEqual(anthropic.activeTools, ["web_search"]);
    assert.deepEqual(anthropic.toolChoice, { type: "tool", toolName: "web_search" });

    const google = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("google", "google_search"),
    });
    assert.deepEqual(google.activeTools, ["google_search"]);
    assert.deepEqual(google.toolChoice, { type: "tool", toolName: "google_search" });
  });

  void it("uses host fallback web search for compatible providers without native search", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    assert.deepEqual(runtime.activeTools, ["web_search"]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.tools?.web_search, "object");
    assert.match(runtime.instructions ?? "", /current, live, recent/);

    const web = chatTools
      .createChatToolDescriptors(modelContext("openai-compatible"))
      .find((descriptor) => descriptor.id === "web_search");
    assert.equal(web?.available, true);
    assert.equal(web?.execution, "host");
  });

  void it("executes the current time tool with host time metadata", async () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["current_time"] },
      model: modelContext("openai-compatible"),
    });
    const timeTool = runtime.tools?.current_time as {
      execute?: (input: Record<string, never>) => Promise<unknown>;
    };
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof timeTool.execute, "function");

    const before = Date.now();
    const output = (await timeTool.execute?.({})) as {
      timestampMs: number;
      utcIso: string;
      timeZone: string;
      locale: string;
      utcOffsetMinutes: number;
      localDateTime: string;
    };
    const after = Date.now();

    assert.equal(typeof output.timestampMs, "number");
    assert.ok(output.timestampMs >= before);
    assert.ok(output.timestampMs <= after);
    assert.equal(new Date(output.utcIso).getTime(), output.timestampMs);
    assert.equal(typeof output.timeZone, "string");
    assert.equal(typeof output.locale, "string");
    assert.equal(typeof output.utcOffsetMinutes, "number");
    assert.equal(typeof output.localDateTime, "string");
  });

  void it("limits manual compatible-provider tools without forcing tool choice", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: {
        mode: "manual",
        selectedToolIds: ["web_search", "memory_search"],
      },
      model: modelContext("openai-compatible"),
    });

    assert.deepEqual(runtime.activeTools, ["web_search", "memory_search"]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.tools?.web_search, "object");
    assert.equal(typeof runtime.tools?.memory_search, "object");
    assert.equal(runtime.tools?.workspace_snapshot, undefined);
  });

  void it("rejects web search when the model cannot call tools", () => {
    assert.throws(
      () =>
        chatTools.buildChatToolRuntime({
          selection: { mode: "manual", selectedToolIds: ["web_search"] },
          model: modelContext("openai-compatible", undefined, {
            ...capabilities,
            toolCalling: false,
          }),
        }),
      (error) => error instanceof chatTools.ChatToolSelectionError && error.status === 400,
    );
  });

  void it("executes host fallback web search with parsed public results", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `
        <html><body>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">One &amp; Result</a>
          <div class="result__snippet">First snippet &amp; detail.</div>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftwo">Two Result</a>
          <div class="result__snippet">Second snippet.</div>
        </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };

    const output = (await webTool.execute?.({ query: "fresh news", maxResults: 2 })) as {
      query: string;
      source: string;
      count: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    assert.equal(output.query, "fresh news");
    assert.equal(output.source, "host_fallback");
    assert.equal(output.count, 2);
    assert.deepEqual(output.results[0], {
      title: "One & Result",
      url: "https://example.com/one",
      snippet: "First snippet & detail.",
    });
  });

  void it("extracts weather answers from public search result cards", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `
        <html><body>
          <div class="weather201016">
            <h3 class="vr-title">
              <a href="https://weatherol.cn/index.html?cityid1=420100">武汉天气预报</a>
            </h3>
            <div class="w-desc currentDay">
              <div class="desc">
                <div class="temperature">26~31 <i>℃</i></div>
                <p class="w-info"><span>小雨转阴</span><span>南风3级</span></p>
              </div>
            </div>
          </div>
        </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };

    const output = (await webTool.execute?.({ query: "武汉今天的天气", maxResults: 3 })) as {
      count: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    assert.equal(output.count, 1);
    assert.equal(output.results[0]?.title, "武汉天气预报");
    assert.match(output.results[0]?.snippet ?? "", /26~31/);
    assert.match(output.results[0]?.snippet ?? "", /小雨转阴/);
  });

  void it("reports host fallback web search request failures clearly", async () => {
    globalThis.fetch = (async () =>
      new Response("blocked", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };
    assert.equal(typeof webTool.execute, "function");

    await assert.rejects(() => webTool.execute!({ query: "fresh news" }), /HTTP 503/);
  });
});

function modelContext(
  providerKind: ModelProviderKind,
  webSearchToolName?: string,
  modelCapabilities: ModelCapabilities = capabilities,
): ChatToolModelContext {
  return {
    providerId: providerKind,
    providerKind,
    modelId: "model",
    capabilities: modelCapabilities,
    nativeTools: webSearchToolName
      ? [
          {
            id: "web_search",
            toolName: webSearchToolName,
            tool: { type: "provider-defined" },
            providerExecuted: true,
          },
        ]
      : [],
  };
}
