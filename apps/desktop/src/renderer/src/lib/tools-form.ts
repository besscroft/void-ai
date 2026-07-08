import type {
  McpTransportKind,
  ToolServerInput,
  ToolSkillInput,
  ToolSkillStep,
  ToolSkillStepType,
} from "@shared/types";

export interface McpFormState {
  name: string;
  description: string;
  transport: McpTransportKind;
  enabled: boolean;
  auto_use: boolean;
  requires_approval: boolean;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
  cwd: string;
}

export interface SkillFormState {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  auto_use: boolean;
  requires_approval: boolean;
  triggerKeywords: string;
  tags: string;
  configSchema: string;
  config: string;
  steps: string;
}

export function buildMcpInput(form: McpFormState): ToolServerInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  if (form.transport === "stdio" && !form.command.trim()) throw new Error("Command is required.");
  if (form.transport !== "stdio" && !form.url.trim()) throw new Error("URL is required.");
  parseArray(form.args, "args");
  parseObject(form.headers, "headers");
  parseObject(form.env, "env");
  return {
    args: form.args,
    auto_use: form.auto_use,
    command: form.command.trim() || null,
    cwd: form.cwd.trim() || null,
    description: form.description.trim(),
    enabled: form.enabled,
    env: form.env,
    headers: form.headers,
    name,
    requires_approval: form.requires_approval,
    transport: form.transport,
    url: form.url.trim() || null,
  };
}

export function buildSkillInput(form: SkillFormState): ToolSkillInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  parseArray(form.triggerKeywords, "trigger keywords");
  parseArray(form.tags, "tags");
  parseObject(form.configSchema, "config schema");
  parseObject(form.config, "config");
  const steps = parseArray(form.steps, "steps").map(normalizeToolSkillStep);
  return {
    auto_use: form.auto_use,
    category: form.category.trim() || "workflow",
    config: form.config,
    configSchema: form.configSchema,
    description: form.description.trim(),
    enabled: form.enabled,
    name,
    requires_approval: form.requires_approval,
    steps,
    tags: form.tags,
    triggerKeywords: form.triggerKeywords,
  };
}

export function normalizeToolSkillSteps(raw: string): ToolSkillStep[] {
  return readArray(raw).map(normalizeToolSkillStep);
}

function normalizeToolSkillStep(item: unknown, index: number): ToolSkillStep {
  const record =
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {};
  const type = normalizeStepType(record.type);
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step-${index + 1}`,
    type,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : type,
    detail: typeof record.detail === "string" ? record.detail : "",
  };
}

function normalizeStepType(value: unknown): ToolSkillStepType {
  return value === "tool" || value === "approval" || value === "memory" || value === "handoff"
    ? value
    : "prompt";
}

function readArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseArray(raw: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON array.");
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON object.");
}
