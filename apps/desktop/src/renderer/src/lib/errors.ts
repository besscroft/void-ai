export type ErrorLocale = "zh-CN" | "en";

type ErrorLike = Error & {
  cause?: unknown;
  responseBody?: string;
  statusCode?: number;
  status?: number;
};

const CHAT_ERROR_TEXT: Record<ErrorLocale, Record<string, string>> = {
  "zh-CN": {
    unknown: "\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
    network:
      "\u65e0\u6cd5\u8fde\u63a5\u5230\u672c\u5730\u804a\u5929\u670d\u52a1\u3002\u8bf7\u7a0d\u7b49\u51e0\u79d2\u540e\u91cd\u8bd5\uff0c\u6216\u91cd\u542f\u5e94\u7528\u3002",
    unauthorized:
      "\u804a\u5929\u4f1a\u8bdd\u5df2\u8fc7\u671f\u3002\u8bf7\u91cd\u542f\u5e94\u7528\u540e\u518d\u8bd5\u3002",
    missingModel:
      "\u8fd8\u6ca1\u6709\u9009\u62e9\u53ef\u7528\u6a21\u578b\u3002\u8bf7\u5148\u9009\u62e9\u6216\u914d\u7f6e\u4e00\u4e2a\u6a21\u578b\u3002",
    badRequest:
      "\u8bf7\u6c42\u5185\u5bb9\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u65b0\u53d1\u9001\u3002",
    server: "\u672c\u5730\u804a\u5929\u670d\u52a1\u5904\u7406\u5931\u8d25\u3002",
  },
  en: {
    unknown: "The request failed. Please try again.",
    network:
      "Could not reach the local chat service. Wait a few seconds and retry, or restart the app.",
    unauthorized: "The chat session expired. Restart the app and try again.",
    missingModel: "No available model is selected. Choose or configure a model first.",
    badRequest: "The request is incomplete. Please send it again.",
    server: "The local chat service failed to process the request.",
  },
};

function normalizeLocale(locale?: string): ErrorLocale {
  return locale === "en" ? "en" : "zh-CN";
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

/** Extract a displayable detail from arbitrary errors without depending on UI libraries. */
export function getErrorMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string")
    return parseJsonMessage(error) ?? (error.trim() || "Unknown error");

  if (error instanceof Error) {
    const e = error as ErrorLike;

    if (e.responseBody && e.responseBody.trim()) {
      const inner = parseJsonMessage(e.responseBody);
      if (inner) return e.statusCode !== undefined ? `[${e.statusCode}] ${inner}` : inner;
      return e.statusCode !== undefined ? `[${e.statusCode}] ${e.responseBody}` : e.responseBody;
    }

    if (error.message && error.message.trim()) {
      return parseJsonMessage(error.message) ?? error.message;
    }

    if (e.cause !== undefined && e.cause !== null) {
      const causeMsg = getErrorMessage(e.cause);
      if (causeMsg && causeMsg !== "Unknown error") return causeMsg;
    }

    return error.name && error.name !== "Error" ? error.name : "Unknown error";
  }

  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }

  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "bigint" || typeof error === "symbol") return error.toString();
  if (typeof error === "function") return "[function]";
  return "Unknown error";
}

/** Convert transport/server failures into actionable chat-specific copy. */
export function getChatErrorMessage(error: unknown, locale?: string): string {
  const text = CHAT_ERROR_TEXT[normalizeLocale(locale)];
  const raw = getErrorMessage(error);
  const status = getStatusCode(error);
  const lower = raw.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower === "typeerror") {
    return text.network;
  }
  if (status === 401 || lower.includes("unauthorized")) return text.unauthorized;
  if (
    lower.includes("model is required") ||
    (lower.includes("model") && lower.includes("required"))
  ) {
    return text.missingModel;
  }
  if (status === 400 || lower.includes("messages cannot be empty")) return text.badRequest;
  if (status !== undefined && status >= 500) return `${text.server} ${raw}`;
  if (raw === "Unknown error") return text.unknown;
  return raw;
}
