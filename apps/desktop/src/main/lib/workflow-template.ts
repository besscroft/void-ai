/**
 * 工作流节点配置模板插值。
 *
 * 支持 {{ path }} 形式的占位符解析。`path` 形如：
 * - `input.<key>` / `outputs.<nodeId>` / `outputs.<nodeId>.<field>`
 *
 * 仅做轻量插值（不引入 jinja 之类依赖），未命中则原样保留。
 */

type TemplateContext = {
  input?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  node?: { id: string; title: string };
};

export function interpolateTemplate(
  template: string,
  ctx: TemplateContext,
  extra: Record<string, unknown> = {},
): string {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const value = readPath(ctx, path) ?? readPath(extra as TemplateContext, path);
    if (value === undefined || value === null) return match;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      const fallback =
        value !== null && typeof value === "object"
          ? (value.constructor?.name ?? "Object")
          : typeof value;
      return `[${fallback}]`;
    }
  });
}

function readPath(ctx: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  if (parts.length === 0) return undefined;
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
