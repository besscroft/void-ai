import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { ModelCatalogSettings } from "../../shared/types";

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

let providerHelpers: typeof import("./providers");

before(async () => {
  providerHelpers = await import("./providers");
});

const capabilities = {
  vision: false,
  imageOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("provider helpers", () => {
  void it("parses remote model list responses from supported providers", () => {
    const openaiModels = providerHelpers.parseOpenAIModelListResponse({
      data: [{ id: "gpt-4o", display_name: "GPT-4o" }, { name: "fallback-model" }, { id: "" }],
    });
    assert.deepEqual(
      openaiModels.map((model) => model.id),
      ["fallback-model", "gpt-4o"],
    );
    assert.equal(openaiModels.find((model) => model.id === "gpt-4o")?.contextWindow, 128_000);

    const anthropicModels = providerHelpers.parseAnthropicModelListResponse({
      data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet" }],
    });
    assert.equal(anthropicModels[0]?.label, "Claude Sonnet");
    assert.equal(anthropicModels[0]?.contextWindow, 200_000);

    const googleModels = providerHelpers.parseGoogleModelListResponse({
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini Pro",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    assert.deepEqual(
      googleModels.map((model) => model.id),
      ["gemini-2.5-pro"],
    );
  });

  void it("merges remote models into the catalog while keeping local settings", () => {
    const catalog: ModelCatalogSettings = {
      providers: [],
      models: [
        {
          providerId: "openai",
          id: "gpt-4o",
          enabled: true,
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 2048,
          contextWindow: 64_000,
          capabilities: { ...capabilities, vision: true },
          providerOptions: { openai: { textVerbosity: "low" } },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      modelStates: [{ providerId: "openai", id: "gpt-4o", enabled: true, updatedAt: 1 }],
    };

    const result = providerHelpers.mergeRemoteModelsIntoCatalog(
      catalog,
      "openai",
      [
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "o3-mini", label: "O3 mini", contextWindow: 128_000 },
      ],
      1234,
    );

    assert.equal(result.discovered, 2);
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);

    const existing = result.catalog.models.find((model) => model.id === "gpt-4o");
    assert.equal(existing?.enabled, true);
    assert.equal(existing?.temperature, 0.2);
    assert.deepEqual(existing?.providerOptions, { openai: { textVerbosity: "low" } });
    assert.equal(existing?.label, "GPT-4o");

    const discovered = result.catalog.models.find((model) => model.id === "o3-mini");
    assert.equal(discovered?.enabled, false);
    assert.equal(discovered?.contextWindow, 128_000);
    assert.equal(
      result.catalog.modelStates.find((state) => state.id === "o3-mini")?.enabled,
      false,
    );
  });

  void it("validates provider options JSON", () => {
    assert.equal(providerHelpers.parseProviderOptionsJson(undefined), undefined);
    assert.deepEqual(providerHelpers.parseProviderOptionsJson(""), {});
    assert.deepEqual(
      providerHelpers.parseProviderOptionsJson('{"openai":{"reasoningEffort":"low"}}'),
      {
        openai: { reasoningEffort: "low" },
      },
    );
    assert.throws(() => providerHelpers.parseProviderOptionsJson("[]"), /JSON object/);
    assert.throws(() => providerHelpers.parseProviderOptionsJson("{"), /valid JSON/);
  });

  void it("prefers provider keys and falls back to legacy model keys", () => {
    const legacyKeys: Record<string, string> = {
      "gpt-4o": "legacy-gpt-key",
      "o3-mini": "legacy-o3-key",
    };
    const getLegacyModelKey = (modelId: string): string | null => legacyKeys[modelId] ?? null;

    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        providerKey: "provider-key",
        legacyModelRefs: ["openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "provider-key",
    );
    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        modelId: "o3-mini",
        providerKey: null,
        legacyModelRefs: ["openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "legacy-o3-key",
    );
    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        providerKey: null,
        legacyModelRefs: ["other/model", "openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "legacy-gpt-key",
    );
  });
});
