import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { deleteApiKey, getApiKey, getSetting, setSetting } from "./db";
import {
  SettingKey,
  type CustomModelInput,
  type CustomProviderInput,
  type ModelCatalogSettings,
  type ModelOption,
  type ProviderInfo,
} from "../../shared/types";

type ProviderConfig = ProviderInfo;

function emptyCatalog(): ModelCatalogSettings {
  return { providers: [], models: [] };
}

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    source: "builtin",
    baseUrl: "https://api.openai.com/v1",
    models: [
      builtinModel("gpt-4o", "GPT-4o"),
      builtinModel("gpt-4o-mini", "GPT-4o mini"),
      builtinModel("gpt-4.1", "GPT-4.1"),
      builtinModel("gpt-4.1-mini", "GPT-4.1 mini"),
      builtinModel("o3", "o3"),
      builtinModel("o3-mini", "o3-mini"),
    ],
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      builtinModel("deepseek-chat", "DeepSeek Chat"),
      builtinModel("deepseek-reasoner", "DeepSeek Reasoner"),
    ],
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    source: "builtin",
    models: [
      builtinModel("claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"),
      builtinModel("claude-3-5-haiku-latest", "Claude 3.5 Haiku"),
      builtinModel("claude-3-opus-latest", "Claude 3 Opus"),
    ],
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google",
    kind: "google",
    source: "builtin",
    models: [
      builtinModel("gemini-2.5-pro", "Gemini 2.5 Pro"),
      builtinModel("gemini-2.5-flash", "Gemini 2.5 Flash"),
      builtinModel("gemini-2.0-flash", "Gemini 2.0 Flash"),
      builtinModel("gemini-1.5-pro", "Gemini 1.5 Pro"),
      builtinModel("gemini-1.5-flash", "Gemini 1.5 Flash"),
    ],
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      builtinModel("openai/gpt-4o", "OpenAI GPT-4o"),
      builtinModel("openai/gpt-4o-mini", "OpenAI GPT-4o mini"),
      builtinModel("anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet"),
      builtinModel("deepseek/deepseek-chat", "DeepSeek Chat"),
    ],
    helpUrl: "https://openrouter.ai/settings/keys",
  },
];

function builtinModel(id: string, label?: string): ModelOption {
  return { id, label, source: "builtin" };
}

function customModel(id: string, label?: string): ModelOption {
  return { id, label, source: "custom" };
}

function readCatalog(): ModelCatalogSettings {
  const raw = getSetting(SettingKey.ModelCatalog);
  if (!raw) return emptyCatalog();
  try {
    const parsed = JSON.parse(raw) as Partial<ModelCatalogSettings>;
    return normalizeCatalog(parsed);
  } catch (err) {
    console.error("[providers] Failed to parse model catalog:", err);
    return emptyCatalog();
  }
}

function writeCatalog(catalog: ModelCatalogSettings): void {
  setSetting(SettingKey.ModelCatalog, JSON.stringify(normalizeCatalog(catalog)));
}

function normalizeCatalog(raw: Partial<ModelCatalogSettings>): ModelCatalogSettings {
  const providers = Array.isArray(raw.providers)
    ? raw.providers
        .map((provider) => ({
          id: normalizeProviderId(provider.id),
          label: String(provider.label ?? "").trim(),
          kind: "openai-compatible" as const,
          baseUrl: normalizeBaseUrl(provider.baseUrl ?? ""),
          helpUrl: normalizeOptionalUrl(provider.helpUrl),
          createdAt: Number(provider.createdAt) || Date.now(),
          updatedAt: Number(provider.updatedAt) || Date.now(),
        }))
        .filter((provider) => provider.id && provider.label && provider.baseUrl)
    : [];

  const providerIds = new Set([
    ...BUILTIN_PROVIDERS.map((p) => p.id),
    ...providers.map((p) => p.id),
  ]);
  const models = Array.isArray(raw.models)
    ? raw.models
        .map((model) => ({
          providerId: normalizeProviderId(model.providerId),
          id: String(model.id ?? "").trim(),
          label: normalizeOptionalText(model.label),
          createdAt: Number(model.createdAt) || Date.now(),
          updatedAt: Number(model.updatedAt) || Date.now(),
        }))
        .filter((model) => providerIds.has(model.providerId) && model.id)
    : [];

  return { providers, models };
}

function normalizeProviderId(raw: string | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeOptionalText(raw: unknown): string | undefined {
  const text = String(raw ?? "").trim();
  return text ? text : undefined;
}

function normalizeBaseUrl(raw: string): string {
  const text = raw.trim().replace(/\/+$/, "");
  if (!text) return "";
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL must start with http:// or https://");
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizeOptionalUrl(raw: unknown): string | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Help URL must start with http:// or https://");
  }
  return url.toString();
}

function providerModelRef(providerId: string, modelId: string): string {
  return providerId + "/" + modelId;
}

function assertKnownProvider(providerId: string): void {
  if (!listProviders().some((provider) => provider.id === providerId)) {
    throw new Error("Unknown provider: " + providerId);
  }
}

function mergeModels(provider: ProviderConfig, catalog: ModelCatalogSettings): ModelOption[] {
  const models = new Map<string, ModelOption>();
  for (const model of provider.models) models.set(model.id, model);
  for (const model of catalog.models.filter((item) => item.providerId === provider.id)) {
    models.set(model.id, customModel(model.id, model.label));
  }
  return [...models.values()];
}

export function listProviders(): ProviderConfig[] {
  const catalog = readCatalog();
  const customProviders: ProviderConfig[] = catalog.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    source: "custom",
    baseUrl: provider.baseUrl,
    helpUrl: provider.helpUrl ?? provider.baseUrl,
    models: [],
  }));

  return [...BUILTIN_PROVIDERS, ...customProviders].map((provider) => ({
    ...provider,
    models: mergeModels(provider, catalog),
  }));
}

export function getProviderConfig(providerId: string): ProviderConfig | null {
  return listProviders().find((provider) => provider.id === providerId) ?? null;
}

export function upsertCustomProvider(input: CustomProviderInput): ProviderInfo {
  const catalog = readCatalog();
  const id = normalizeProviderId(input.id ?? input.label);
  if (!id) throw new Error("Provider id is required");
  if (BUILTIN_PROVIDERS.some((provider) => provider.id === id)) {
    throw new Error("Built-in providers cannot be overwritten");
  }

  const label = input.label.trim();
  if (!label) throw new Error("Provider label is required");

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Base URL is required");

  const existing = catalog.providers.find((provider) => provider.id === id);
  const now = Date.now();
  const nextProvider = {
    id,
    label,
    kind: "openai-compatible" as const,
    baseUrl,
    helpUrl: normalizeOptionalUrl(input.helpUrl),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.providers = existing
    ? catalog.providers.map((provider) => (provider.id === id ? nextProvider : provider))
    : [...catalog.providers, nextProvider];
  writeCatalog(catalog);

  const saved = getProviderConfig(id);
  if (!saved) throw new Error("Failed to save provider");
  return saved;
}

export function deleteCustomProvider(providerId: string): void {
  const id = normalizeProviderId(providerId);
  const catalog = readCatalog();
  const existing = catalog.providers.find((provider) => provider.id === id);
  if (!existing) throw new Error("Custom provider not found");

  catalog.providers = catalog.providers.filter((provider) => provider.id !== id);
  catalog.models = catalog.models.filter((model) => model.providerId !== id);
  writeCatalog(catalog);
  deleteApiKey(id);

  const selectedModel = getSetting(SettingKey.SelectedModel);
  if (selectedModel?.startsWith(id + "/")) setSetting(SettingKey.SelectedModel, "");
}

export function upsertCustomModel(input: CustomModelInput): ProviderInfo {
  const providerId = normalizeProviderId(input.providerId);
  assertKnownProvider(providerId);

  const modelId = input.id.trim();
  if (!modelId) throw new Error("Model id is required");

  const catalog = readCatalog();
  const existing = catalog.models.find(
    (model) => model.providerId === providerId && model.id === modelId,
  );
  const now = Date.now();
  const nextModel = {
    providerId,
    id: modelId,
    label: normalizeOptionalText(input.label),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.models = existing
    ? catalog.models.map((model) =>
        model.providerId === providerId && model.id === modelId ? nextModel : model,
      )
    : [...catalog.models, nextModel];
  writeCatalog(catalog);

  const provider = getProviderConfig(providerId);
  if (!provider) throw new Error("Failed to save model");
  return provider;
}

export function deleteCustomModel(providerId: string, modelId: string): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const catalog = readCatalog();
  const before = catalog.models.length;
  catalog.models = catalog.models.filter(
    (model) => !(model.providerId === normalizedProviderId && model.id === normalizedModelId),
  );
  if (catalog.models.length === before) throw new Error("Custom model not found");
  writeCatalog(catalog);

  const selectedModel = getSetting(SettingKey.SelectedModel);
  const deletedRef = providerModelRef(normalizedProviderId, normalizedModelId);
  const stillExists = listProviders()
    .find((provider) => provider.id === normalizedProviderId)
    ?.models.some((model) => model.id === normalizedModelId);
  if (selectedModel === deletedRef && !stillExists) setSetting(SettingKey.SelectedModel, "");
}

export function resolveModel(modelRef: string): LanguageModel {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(
      "Invalid model reference " + JSON.stringify(modelRef) + "; expected provider/model",
    );
  }
  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  const config = getProviderConfig(providerId);
  if (!config) throw new Error("Unknown provider: " + providerId);

  const apiKey = getApiKey(providerId);
  if (!apiKey)
    throw new Error(config.label + " API key is not configured. Please add it in settings.");

  return createLanguageModel(config, apiKey, modelId);
}

function createLanguageModel(
  config: ProviderConfig,
  apiKey: string,
  modelId: string,
): LanguageModel {
  switch (config.kind) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id })(modelId);
    case "openai-compatible":
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      return createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id }).chat(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
  }
}
