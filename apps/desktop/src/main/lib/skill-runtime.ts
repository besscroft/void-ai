import { jsonSchema, tool, type ToolSet } from "ai";
import type { ChatToolDescriptor, ToolSkill, ToolSkillStep, JsonObject } from "../../shared/types";
import {
  createWorkflowRun,
  getSkillTool,
  insertRuntimeEvent,
  listSkillTools,
  listMemories,
  markSkillToolRun,
  updateWorkflowRun,
} from "./db";
import type { ChatToolModelContext } from "./chat-tools";

export function skillToolReference(skillId: string): string {
  return "skill:" + skillId;
}

export function parseSkillToolReference(reference: string): string | null {
  const match = reference.match(/^skill:([A-Za-z0-9_.-]+)$/);
  return match?.[1] ?? null;
}

export function skillToolRuntimeName(skillId: string): string {
  return "skill_" + toolNamePart(skillId);
}

export function createSkillToolDescriptors(): ChatToolDescriptor[] {
  try {
    return listSkillTools().map((skill) => ({
      id: skillToolReference(skill.id),
      label: skill.name,
      description: skill.description || "Workflow skill",
      kind: "host",
      execution: "host",
      category: "skill",
      defaultAuto: skill.enabled !== 0 && skill.auto_use !== 0,
      requiresApproval: skill.requires_approval !== 0,
      available: skill.enabled !== 0,
      unavailableReason: skill.enabled ? undefined : "Skill is disabled.",
      sourceId: skill.id,
      sourceName: skill.category,
    }));
  } catch {
    return [];
  }
}

export function createSkillToolSet({
  references,
  model,
  conversationId,
  agentId,
}: {
  references: string[];
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): { tools: ToolSet; activeTools: string[]; approvalToolNames: string[] } {
  const tools: ToolSet = {};
  const activeTools: string[] = [];
  const approvalToolNames: string[] = [];
  for (const reference of references) {
    const skillId = parseSkillToolReference(reference);
    if (!skillId) continue;
    const skill = getSkillTool(skillId);
    if (!skill || skill.enabled === 0) continue;
    const toolName = skillToolRuntimeName(skill.id);
    tools[toolName] = createSkillTool({ skill, model, conversationId, agentId });
    activeTools.push(toolName);
    if (skill.requires_approval !== 0) approvalToolNames.push(toolName);
  }
  return { tools, activeTools, approvalToolNames };
}

export async function runToolSkill({
  skillId,
  input,
  model,
  conversationId,
  agentId,
}: {
  skillId: string;
  input?: unknown;
  model?: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): Promise<unknown> {
  const skill = getSkillTool(skillId);
  if (!skill || skill.enabled === 0) throw new Error("Skill is unavailable: " + skillId);
  const workflowId = skill.workflow_id;
  if (!workflowId) throw new Error("Skill is missing a workflow: " + skill.name);
  const started = Date.now();
  const run = createWorkflowRun({
    workflow_id: workflowId,
    status: "running",
    input_json: JSON.stringify({ input: normalizeInput(input), conversationId, agentId }),
    output_json: null,
    finished_at: null,
  });
  insertRuntimeEvent({
    kind: "workflow",
    title: "Skill started: " + skill.name,
    status: "running",
    detail: { skillId: skill.id, workflowId, runId: run.id, conversationId, agentId },
  });

  try {
    const steps = readSteps(skill);
    const result = {
      skill: {
        id: skill.id,
        name: skill.name,
        category: skill.category,
        instructions: readSkillInstructions(skill),
      },
      runId: run.id,
      workflowId,
      durationMs: 0,
      steps: steps.map((step) => executeStep(step, input)),
      context: {
        conversationId,
        agentId,
        providerId: model?.providerId,
        modelId: model?.modelId,
      },
    };
    result.durationMs = Date.now() - started;
    updateWorkflowRun(run.id, {
      status: "succeeded",
      output_json: JSON.stringify(result),
      finished_at: Date.now(),
    });
    markSkillToolRun(skill.id);
    insertRuntimeEvent({
      kind: "workflow",
      title: "Skill completed: " + skill.name,
      status: "succeeded",
      detail: { skillId: skill.id, workflowId, runId: run.id, durationMs: result.durationMs },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateWorkflowRun(run.id, {
      status: "failed",
      output_json: JSON.stringify({ error: message }),
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      kind: "error",
      title: "Skill failed: " + skill.name,
      status: "failed",
      detail: { skillId: skill.id, workflowId, runId: run.id, error: message },
    });
    throw error;
  }
}

function createSkillTool({
  skill,
  model,
  conversationId,
  agentId,
}: {
  skill: ToolSkill;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): ToolSet[string] {
  return tool({
    description: createToolDescription(skill),
    inputSchema: jsonSchema<Record<string, unknown>>(safeJsonSchema(skill.config_schema_json)),
    execute: (input) =>
      runToolSkill({
        skillId: skill.id,
        input,
        model,
        conversationId,
        agentId,
      }),
  });
}

function executeStep(step: ToolSkillStep, input: unknown): JsonObject {
  if (step.type === "memory") {
    const query = [step.title, step.detail, JSON.stringify(normalizeInput(input))]
      .join(" ")
      .toLowerCase();
    const memories = listMemories()
      .filter((memory) => query.includes(memory.title.toLowerCase()) || query.includes(memory.kind))
      .slice(0, 5)
      .map((memory) => ({ id: memory.id, title: memory.title, kind: memory.kind }));
    return { ...baseStep(step), memories };
  }
  if (step.type === "approval")
    return { ...baseStep(step), checkpoint: "approved-before-tool-call" };
  if (step.type === "tool") return { ...baseStep(step), requestedTool: step.detail };
  if (step.type === "handoff") return { ...baseStep(step), handoff: step.detail };
  return { ...baseStep(step), prompt: step.detail };
}

function baseStep(step: ToolSkillStep): JsonObject {
  return {
    id: step.id,
    type: step.type,
    title: step.title,
    detail: step.detail,
  };
}

function createToolDescription(skill: ToolSkill): string {
  const triggers = safeJsonArray(skill.trigger_keywords_json).join(", ");
  const steps = readSteps(skill)
    .map((step, index) => `${index + 1}. ${step.title}`)
    .join("; ");
  const instructions = readSkillInstructions(skill);
  return [
    skill.description,
    instructions ? "Instructions:\n" + instructions : "",
    triggers ? "Triggers: " + triggers : "",
    steps ? "Steps: " + steps : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function readSkillInstructions(skill: ToolSkill): string {
  const config = safeJson(skill.config_json, {});
  if (!config || typeof config !== "object" || Array.isArray(config)) return "";
  const instructions = (config as Record<string, unknown>).instructions;
  return typeof instructions === "string" ? instructions.trim().slice(0, 8_000) : "";
}

function readSteps(skill: ToolSkill): ToolSkillStep[] {
  const parsed = safeJsonArray(skill.steps_json);
  return parsed
    .filter((item): item is ToolSkillStep => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<ToolSkillStep>;
      return typeof record.id === "string" && typeof record.title === "string";
    })
    .slice(0, 20);
}

function normalizeInput(input: unknown): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as JsonObject;
}

function safeJsonSchema(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw, {});
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const schema = parsed as Record<string, unknown>;
    if (Object.keys(schema).length > 0) return schema;
  }
  return {
    type: "object",
    properties: {
      request: { type: "string", description: "What the skill should accomplish." },
    },
    additionalProperties: true,
  };
}

function safeJsonArray(raw: string): unknown[] {
  const parsed = safeJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function toolNamePart(value: string): string {
  const part = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return part || "workflow";
}
