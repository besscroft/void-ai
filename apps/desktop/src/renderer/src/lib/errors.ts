import type { AppLanguage } from "@shared/types";
import { translate, type TranslationKey } from "./i18n";

export type ErrorLocale = AppLanguage;

type ErrorLike = Error & {
  cause?: unknown;
  responseBody?: string;
  statusCode?: number;
  status?: number;
};

function normalizeLocale(locale?: string | null): ErrorLocale {
  return locale === "en" ? "en" : "zh-CN";
}

function text(
  locale: ErrorLocale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return translate(locale, key, params);
}

function parseJsonMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    const inner = parsed.error ?? parsed.message;
    return typeof inner === "string" && inner.trim() ? inner : null;
  } catch {
    return null;
  }
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { statusCode?: unknown; status?: unknown };
  const value = typeof e.statusCode === "number" ? e.statusCode : e.status;
  return typeof value === "number" ? value : undefined;
}

function withStatus(status: number | undefined, message: string): string {
  return status !== undefined ? `[${status}] ${message}` : message;
}

function stripStatusPrefix(message: string): string {
  return message.replace(/^\[\d+\]\s*/, "");
}

function getRawErrorMessage(error: unknown, locale: ErrorLocale): string {
  const unknown = text(locale, "error.unknown");

  if (error == null) return unknown;
  if (typeof error === "string") return parseJsonMessage(error) ?? (error.trim() || unknown);

  if (error instanceof Error) {
    const e = error as ErrorLike;

    if (e.responseBody && e.responseBody.trim()) {
      const inner = parseJsonMessage(e.responseBody);
      if (inner) return withStatus(e.statusCode, inner);
      return withStatus(e.statusCode, e.responseBody);
    }

    if (error.message && error.message.trim()) {
      return parseJsonMessage(error.message) ?? error.message;
    }

    if (e.cause !== undefined && e.cause !== null) {
      const causeMsg = getRawErrorMessage(e.cause, locale);
      if (causeMsg && causeMsg !== unknown) return causeMsg;
    }

    return error.name && error.name !== "Error" ? error.name : unknown;
  }

  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return unknown;
    }
  }

  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "bigint" || typeof error === "symbol") return error.toString();
  if (typeof error === "function") return text(locale, "error.function");
  return unknown;
}

function mapKnownError(rawMessage: string, locale: ErrorLocale, status?: number): string | null {
  const raw = stripStatusPrefix(rawMessage).trim();
  const lower = raw.toLowerCase();

  if (lower.includes("unauthorized chat session")) return text(locale, "error.chat.unauthorized");
  if (lower.includes("messages cannot be empty")) return text(locale, "error.chat.badRequest");
  if (lower.includes("model is required")) {
    return text(locale, "error.chat.missingModel");
  }
  if (status === 400) return text(locale, "error.chat.badRequest");

  if (lower.includes("base url must start with")) {
    return text(locale, "error.provider.baseUrlProtocol");
  }
  if (lower.includes("help url must start with")) {
    return text(locale, "error.provider.helpUrlProtocol");
  }
  if (lower === "provider id is required") return text(locale, "error.provider.providerIdRequired");
  if (lower === "built-in providers cannot be overwritten") {
    return text(locale, "error.provider.builtinOverwrite");
  }
  if (lower === "provider label is required") return text(locale, "error.provider.labelRequired");
  if (lower === "base url is required") return text(locale, "error.provider.baseUrlRequired");
  if (lower === "failed to save provider") return text(locale, "error.provider.saveFailed");
  if (lower === "custom provider not found") {
    return text(locale, "error.provider.customProviderNotFound");
  }
  if (lower === "model id is required") return text(locale, "error.provider.modelIdRequired");
  if (lower === "failed to save model") return text(locale, "error.provider.modelSaveFailed");
  if (lower === "provider options must be a json object") {
    return text(locale, "error.providerOptions.json");
  }
  if (lower === "provider options must be valid json") {
    return text(locale, "error.providerOptions.json");
  }
  if (lower === "api key is required") return text(locale, "error.provider.apiKeyRequired");
  if (lower === "custom model not found") return text(locale, "error.provider.customModelNotFound");
  if (lower.includes("invalid model reference") && lower.includes("expected provider/model")) {
    return text(locale, "error.provider.invalidModelReference");
  }

  const unknownProvider = raw.match(/^Unknown provider:\s*(.+)$/i);
  if (unknownProvider) {
    return text(locale, "error.provider.unknownProvider", { provider: unknownProvider[1] });
  }

  const unknownModel = raw.match(/^Unknown model:\s*(.+)$/i);
  if (unknownModel) {
    return text(locale, "error.provider.unknownModel", { model: unknownModel[1] });
  }

  const disabledModel = raw.match(/^(.+?)\s+is disabled\.?$/i);
  if (disabledModel) {
    return text(locale, "error.provider.modelDisabled", { model: disabledModel[1] });
  }

  const apiKeyMissing = raw.match(/^(.+?)\s+API key is not configured\./i);
  if (apiKeyMissing) {
    return text(locale, "error.provider.modelApiKeyMissing", { model: apiKeyMissing[1] });
  }

  const baseUrlMissing = raw.match(/^(.+?)\s+base URL is not configured\./i);
  if (baseUrlMissing) {
    return text(locale, "error.provider.baseUrlMissing", { provider: baseUrlMissing[1] });
  }

  return null;
}

/** Extract a displayable detail from arbitrary errors without depending on UI libraries. */
export function getErrorMessage(error: unknown, locale?: string | null): string {
  const resolvedLocale = normalizeLocale(locale);
  const raw = getRawErrorMessage(error, resolvedLocale);
  return mapKnownError(raw, resolvedLocale, getStatusCode(error)) ?? raw;
}

/** Convert transport/server failures into actionable chat-specific copy. */
export function getChatErrorMessage(error: unknown, locale?: string | null): string {
  const resolvedLocale = normalizeLocale(locale);
  const raw = getRawErrorMessage(error, resolvedLocale);
  const status = getStatusCode(error);
  const lower = stripStatusPrefix(raw).toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower === "typeerror") {
    return text(resolvedLocale, "error.chat.network");
  }
  if (status === 401 || lower.includes("unauthorized")) {
    return text(resolvedLocale, "error.chat.unauthorized");
  }
  if (lower.includes("model is required")) {
    return text(resolvedLocale, "error.chat.missingModel");
  }
  if (status === 400 || lower.includes("messages cannot be empty")) {
    return text(resolvedLocale, "error.chat.badRequest");
  }

  const known = mapKnownError(raw, resolvedLocale, status);
  if (known) return known;

  if (status !== undefined && status >= 500) {
    return `${text(resolvedLocale, "error.chat.server")} ${raw}`;
  }
  if (raw === text(resolvedLocale, "error.unknown")) {
    return text(resolvedLocale, "error.chat.unknown");
  }
  return raw;
}
