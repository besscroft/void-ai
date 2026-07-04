import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import {
  deleteApiKey,
  deleteModelApiKey,
  deleteModelApiKeysForProvider,
  getApiKey,
  getModelApiKey,
  getSetting,
  listModelApiKeyRefs,
  setModelApiKey,
  setSetting,
} from "./db";
import {
  SettingKey,
  type CustomModelInput,
  type CustomProviderInput,
  type ManagedModelInfo,
  type ModelCatalogSettings,
  type ModelOption,
  type ProviderInfo,
} from "../../shared/types";

type ProviderConfig = ProviderInfo;

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const DEFAULT_MODEL_TOP_P = 1;
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4096;

export interface ResolvedModelConfig {
  model: LanguageModel;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
}

function emptyCatalog(): ModelCatalogSettings {
  return { providers: [], models: [], modelStates: [] };
}

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    source: "builtin",
    baseUrl: "https://api.openai.com/v1",
    models: [],
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.deepseek.com/v1",
    models: [],
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    source: "builtin",
    models: [],
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google",
    kind: "google",
    source: "builtin",
    models: [],
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    helpUrl: "https://openrouter.ai/settings/keys",
  },
];

function customModel(model: ModelCatalogSettings["models"][number], enabled: boolean): ModelOption {
  return {
    id: model.id,
    label: model.label,
    source: "custom",
    enabled,
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
  };
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
  const normalized = normalizeCatalog(catalog);
  setSetting(SettingKey.ModelCatalog, JSON.stringify(normalized));
  clearInvalidSelectedModel(normalized);
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
    ...BUILTIN_PROVIDERS.map((provider) => provider.id),
    ...providers.map((provider) => provider.id),
  ]);

  const models = Array.isArray(raw.models)
    ? raw.models
        .map((model) => ({
          providerId: normalizeProviderId(model.providerId),
          id: String(model.id ?? "").trim(),
          label: normalizeOptionalText(model.label),
          enabled: (model as { enabled?: boolean }).enabled !== false,
          temperature: normalizeTemperature((model as { temperature?: unknown }).temperature),
          topP: normalizeTopP((model as { topP?: unknown }).topP),
          maxOutputTokens: normalizeMaxOutputTokens(
            (model as { maxOutputTokens?: unknown }).maxOutputTokens,
          ),
          createdAt: Number(model.createdAt) || Date.now(),
          updatedAt: Number(model.updatedAt) || Date.now(),
        }))
        .filter((model) => providerIds.has(model.providerId) && model.id)
    : [];

  const modelRefs = new Set(models.map((model) => providerModelRef(model.providerId, model.id)));
  const modelStatesByRef = new Map<string, ModelCatalogSettings["modelStates"][number]>();
  if (Array.isArray(raw.modelStates)) {
    for (const state of raw.modelStates) {
      const providerId = normalizeProviderId(state.providerId);
      const id = String(state.id ?? "").trim();
      const ref = providerModelRef(providerId, id);
      if (!modelRefs.has(ref)) continue;
      modelStatesByRef.set(ref, {
        providerId,
        id,
        enabled: state.enabled !== false,
        updatedAt: Number(state.updatedAt) || Date.now(),
      });
    }
  }

  const normalizedModels = models.map((model) => {
    const state = modelStatesByRef.get(providerModelRef(model.providerId, model.id));
    return { ...model, enabled: state?.enabled ?? model.enabled };
  });

  return {
    providers,
    models: normalizedModels,
    modelStates: [...modelStatesByRef.values()],
  };
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

function normalizeTemperature(raw: unknown): number {
  return normalizeNumber(raw, DEFAULT_MODEL_TEMPERATURE, 0, 2);
}

function normalizeTopP(raw: unknown): number {
  return normalizeNumber(raw, DEFAULT_MODEL_TOP_P, 0, 1);
}

function normalizeMaxOutputTokens(raw: unknown): number {
  return Math.floor(normalizeNumber(raw, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 1, 32768));
}

function normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function providerModelRef(providerId: string, modelId: string): string {
  return providerId + "/" + modelId;
}

function isModelEnabled(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
): boolean {
  const state = catalog.modelStates.find(
    (item) => item.providerId === providerId && item.id === modelId,
  );
  if (state) return state.enabled;
  return (
    catalog.models.find((model) => model.providerId === providerId && model.id === modelId)
      ?.enabled ?? true
  );
}

function setModelState(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
  enabled: boolean,
): void {
  const now = Date.now();
  const existing = catalog.modelStates.find(
    (state) => state.providerId === providerId && state.id === modelId,
  );
  const nextState = { providerId, id: modelId, enabled, updatedAt: now };
  catalog.modelStates = existing
    ? catalog.modelStates.map((state) =>
        state.providerId === providerId && state.id === modelId ? nextState : state,
      )
    : [...catalog.modelStates, nextState];
  catalog.models = catalog.models.map((model) =>
    model.providerId === providerId && model.id === modelId
      ? { ...model, enabled, updatedAt: now }
      : model,
  );
}

function removeModelState(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
): void {
  catalog.modelStates = catalog.modelStates.filter(
    (state) => !(state.providerId === providerId && state.id === modelId),
  );
}

function isSelectedModelValid(catalog: ModelCatalogSettings, selectedModel: string): boolean {
  const slashIdx = selectedModel.indexOf("/");
  if (slashIdx <= 0) return false;
  const providerId = normalizeProviderId(selectedModel.slice(0, slashIdx));
  const modelId = selectedModel.slice(slashIdx + 1).trim();
  if (!modelId) return false;
  const model = catalog.models.find(
    (item) => item.providerId === providerId && item.id === modelId,
  );
  return !!model && isModelEnabled(catalog, providerId, modelId);
}

function clearInvalidSelectedModel(catalog = readCatalog()): void {
  const selectedModel = getSetting(SettingKey.SelectedModel);
  if (selectedModel && !isSelectedModelValid(catalog, selectedModel)) {
    setSetting(SettingKey.SelectedModel, "");
  }
}

function assertKnownProvider(providerId: string): void {
  if (!listProviders().some((provider) => provider.id === providerId)) {
    throw new Error("Unknown provider: " + providerId);
  }
}

function assertKnownModel(providerId: string, modelId: string): void {
  const provider = getProviderConfig(providerId);
  if (!provider) throw new Error("Unknown provider: " + providerId);
  if (!provider.models.some((model) => model.id === modelId)) {
    throw new Error("Unknown model: " + providerModelRef(providerId, modelId));
  }
}

function mergeModels(provider: ProviderConfig, catalog: ModelCatalogSettings): ModelOption[] {
  return catalog.models
    .filter((model) => model.providerId === provider.id)
    .map((model) => customModel(model, isModelEnabled(catalog, provider.id, model.id)));
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

export function listManagedModels(): ManagedModelInfo[] {
  const keyRefs = new Set(listModelApiKeyRefs());
  return listProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      ref: providerModelRef(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      providerKind: provider.kind,
      providerSource: provider.source,
      providerBaseUrl: provider.baseUrl,
      providerHelpUrl: provider.helpUrl,
      modelId: model.id,
      modelLabel: model.label,
      modelSource: model.source,
      enabled: model.enabled,
      hasApiKey: keyRefs.has(providerModelRef(provider.id, model.id)),
      temperature: model.temperature,
      topP: model.topP,
      maxOutputTokens: model.maxOutputTokens,
    })),
  );
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
  catalog.modelStates = catalog.modelStates.filter((state) => state.providerId !== id);
  writeCatalog(catalog);
  deleteApiKey(id);
  deleteModelApiKeysForProvider(id);
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
    enabled: input.enabled ?? existing?.enabled ?? true,
    temperature: normalizeTemperature(input.temperature ?? existing?.temperature),
    topP: normalizeTopP(input.topP ?? existing?.topP),
    maxOutputTokens: normalizeMaxOutputTokens(input.maxOutputTokens ?? existing?.maxOutputTokens),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.models = existing
    ? catalog.models.map((model) =>
        model.providerId === providerId && model.id === modelId ? nextModel : model,
      )
    : [...catalog.models, nextModel];
  setModelState(catalog, providerId, modelId, nextModel.enabled);
  writeCatalog(catalog);

  const provider = getProviderConfig(providerId);
  if (!provider) throw new Error("Failed to save model");
  return provider;
}

export function updateModelEnabled(providerId: string, modelId: string, enabled: boolean): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  assertKnownModel(normalizedProviderId, normalizedModelId);

  const catalog = readCatalog();
  setModelState(catalog, normalizedProviderId, normalizedModelId, enabled);
  writeCatalog(catalog);
}

export function saveModelApiKey(providerId: string, modelId: string, apiKey: string): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required");
  assertKnownModel(normalizedProviderId, normalizedModelId);
  setModelApiKey(normalizedProviderId, normalizedModelId, key);
}

export function clearModelApiKey(providerId: string, modelId: string): void {
  deleteModelApiKey(normalizeProviderId(providerId), modelId.trim());
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
  removeModelState(catalog, normalizedProviderId, normalizedModelId);
  writeCatalog(catalog);
  deleteModelApiKey(normalizedProviderId, normalizedModelId);
}

export function migrateProviderApiKeysToModelKeys(): void {
  const existingModelKeys = new Set(listModelApiKeyRefs());
  for (const provider of listProviders()) {
    const legacyKey = getApiKey(provider.id);
    if (!legacyKey) continue;
    for (const model of provider.models) {
      const ref = providerModelRef(provider.id, model.id);
      if (existingModelKeys.has(ref)) continue;
      setModelApiKey(provider.id, model.id, legacyKey);
      existingModelKeys.add(ref);
    }
  }
  clearInvalidSelectedModel();
}

export function resolveModel(modelRef: string): ResolvedModelConfig {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(
      "Invalid model reference " + JSON.stringify(modelRef) + "; expected provider/model",
    );
  }
  const providerId = normalizeProviderId(modelRef.slice(0, slashIdx));
  const modelId = modelRef.slice(slashIdx + 1).trim();

  const config = getProviderConfig(providerId);
  if (!config) throw new Error("Unknown provider: " + providerId);

  const model = config.models.find((item) => item.id === modelId);
  if (!model) throw new Error("Unknown model: " + modelRef);
  if (!model.enabled) throw new Error((model.label ?? model.id) + " is disabled.");

  const apiKey = getModelApiKey(providerId, modelId);
  if (!apiKey) {
    throw new Error(
      config.label +
        " / " +
        (model.label ?? model.id) +
        " API key is not configured. Please add it in model management.",
    );
  }

  return {
    model: createLanguageModel(config, apiKey, modelId),
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
  };
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
      return createGoogle({ apiKey })(modelId);
  }
}
