import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getChatToolSelectionForConversation,
  withChatToolSelectionForConversation,
  type ModelCapabilities,
  type ProviderInfo,
} from "@shared/types";
import { createClientChatToolDescriptors, getActiveChatToolIds } from "./chat-tools";

const capabilities: ModelCapabilities = {
  vision: false,
  imageOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("chat tool UI helpers", () => {
  void it("defaults per-conversation tool settings to auto and persists manual choices", () => {
    const first = getChatToolSelectionForConversation(null, "c1");
    assert.equal(first.mode, "auto");
    assert.deepEqual(first.selectedToolIds, []);

    const saved = withChatToolSelectionForConversation(null, "c1", {
      mode: "manual",
      selectedToolIds: ["web_search", "memory_save", "web_search"],
    });

    const parsed = getChatToolSelectionForConversation(JSON.stringify(saved), "c1");
    assert.equal(parsed.mode, "manual");
    assert.deepEqual(parsed.selectedToolIds, ["web_search", "memory_save"]);
    assert.equal(getChatToolSelectionForConversation(JSON.stringify(saved), "c2").mode, "auto");
  });

  void it("enables native web search for supported providers", () => {
    const providers = [provider("openai", "openai")];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-test",
      providers,
    });
    const web = descriptors.find((descriptor) => descriptor.id === "web_search");

    assert.equal(web?.available, true);
    assert.equal(web?.execution, "provider");
    assert.deepEqual(getActiveChatToolIds({ mode: "auto", selectedToolIds: [] }, descriptors), [
      "web_search",
      "memory_search",
      "workspace_snapshot",
      "model_capabilities",
    ]);
  });

  void it("enables host fallback web search after switching to a compatible provider", () => {
    const providers = [provider("custom", "openai-compatible")];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "custom/local-model",
      providers,
    });
    const web = descriptors.find((descriptor) => descriptor.id === "web_search");
    const memory = descriptors.find((descriptor) => descriptor.id === "memory_search");

    assert.equal(web?.available, true);
    assert.equal(web?.execution, "host");
    assert.equal(memory?.available, true);
    assert.deepEqual(
      getActiveChatToolIds(
        { mode: "manual", selectedToolIds: ["web_search", "memory_search"] },
        descriptors,
      ),
      ["web_search", "memory_search"],
    );
  });

  void it("disables every tool when the selected model cannot call tools", () => {
    const providers = [provider("openai", "openai", { ...capabilities, toolCalling: false })];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-no-tools",
      providers,
    });

    assert.equal(
      descriptors.every((descriptor) => !descriptor.available),
      true,
    );
    assert.deepEqual(getActiveChatToolIds({ mode: "auto", selectedToolIds: [] }, descriptors), []);
    assert.deepEqual(
      getActiveChatToolIds({ mode: "manual", selectedToolIds: ["web_search"] }, descriptors),
      [],
    );
  });
});

function provider(
  id: string,
  kind: ProviderInfo["kind"],
  modelCapabilities: ModelCapabilities = capabilities,
): ProviderInfo {
  const modelId =
    id === "custom" ? "local-model" : modelCapabilities.toolCalling ? "gpt-test" : "gpt-no-tools";
  return {
    id,
    label: id,
    kind,
    source: id === "custom" ? "custom" : "builtin",
    models: [
      {
        id: modelId,
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: modelCapabilities,
        providerOptions: {},
      },
    ],
    helpUrl: "https://example.com",
    hasApiKey: true,
  };
}
