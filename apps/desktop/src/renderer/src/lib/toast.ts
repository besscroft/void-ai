import { toast } from "sonner";

/**
 * 从任意错误对象中提取可展示的文本。
 * 优先级：错误 message > responseBody > cause.message > JSON 序列化 > 兜底文案
 *
 * 之所以要这么复杂：AI SDK 的 HttpChatTransport 在收到非 2xx 响应时，
 * 直接 `throw new Error(response.text())`，若服务器返回空 body（如 404），
 * 错误 message 就是空字符串。我们必须从其它字段（cause / responseBody 等）补信息。
 */
export function getErrorMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return error.trim() || "Unknown error";

  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message;

    // 部分 AI SDK 错误对象把详细信息放在 cause / responseBody 等字段
    const e = error as Error & {
      cause?: unknown;
      responseBody?: string;
      statusCode?: number;
    };

    if (e.responseBody && e.responseBody.trim()) {
      try {
        const parsed = JSON.parse(e.responseBody) as { error?: string; message?: string };
        const inner = parsed.error ?? parsed.message;
        if (inner) {
          return e.statusCode !== undefined ? `[${e.statusCode}] ${inner}` : String(inner);
        }
      } catch {
        // responseBody 不是 JSON，直接展示
        return e.statusCode !== undefined ? `[${e.statusCode}] ${e.responseBody}` : e.responseBody;
      }
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

  // 剩余：string / number / boolean / bigint / undefined / symbol / function
  // 用显式分支展开，避免 String(unknown) 触发 no-base-to-string
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "bigint" || typeof error === "symbol") return error.toString();
  if (typeof error === "function") return "[function]";
  return "Unknown error";
}

export const notify = {
  success(message: string): void {
    toast.success(message);
  },
  error(message: string, error?: unknown): void {
    const detail = error === undefined ? "" : `: ${getErrorMessage(error)}`;
    toast.error(`${message}${detail}`);
  },
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ): Promise<T> {
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: (error) => `${messages.error}: ${getErrorMessage(error)}`,
    });
    return promise;
  },
};
