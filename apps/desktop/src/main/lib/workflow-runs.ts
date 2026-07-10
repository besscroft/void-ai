/**
 * 工作流数据访问层（runs / step_runs / transitions）。
 *
 * 此模块只关心 DTO 与 DB 行的转换，不包含业务执行逻辑。
 * 工作流定义、节点和边由 `workflow-engine.ts` 解释和执行。
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { workflowRuns, workflowStepRuns, workflowTransitions, workflows } from "./schema";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowTransition,
} from "../../shared/types";
import { buildNodeFromLegacyStep, cloneDefinition, normalizeDefinition } from "./workflow-types";

type Row = typeof workflows.$inferSelect;
type RunRow = typeof workflowRuns.$inferSelect;
type StepRunRow = typeof workflowStepRuns.$inferSelect;
type TransitionRow = typeof workflowTransitions.$inferSelect;

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 把数据库行映射为应用层 WorkflowDefinition。处理向后兼容：
 * - 若新的 `nodes_json` 为空但旧 `steps_json` 有内容，自动把旧 step 转成 WorkflowNode。
 */
export function toWorkflowDefinition(row: Row): WorkflowDefinition {
  const storedNodes = safeParseJson<WorkflowNode[] | null>(row.nodes_json, null);
  const nodes: WorkflowNode[] =
    Array.isArray(storedNodes) && storedNodes.length > 0
      ? storedNodes
      : safeParseJson<unknown[]>(row.steps_json, []).map((raw, idx) =>
          buildNodeFromLegacyStep(raw, idx),
        );
  const entryNodeId =
    row.entry_node_id && nodes.some((n) => n.id === row.entry_node_id)
      ? row.entry_node_id
      : (nodes[0]?.id ?? "");
  const def: WorkflowDefinition = {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    trigger: row.trigger,
    version: row.version ?? 1,
    entryNodeId,
    nodes,
    steps_json: row.steps_json ?? "[]",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return normalizeDefinition(def);
}

export function toWorkflowRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    runtime_run_id: row.runtime_run_id ?? null,
    status: row.status as WorkflowRunStatus,
    input_json: row.input_json ?? null,
    output_json: row.output_json ?? null,
    error: row.error ?? null,
    context_json: row.context_json ?? "{}",
    started_at: row.started_at,
    finished_at: row.finished_at ?? null,
    triggered_by: row.triggered_by ?? "manual",
    triggered_by_agent_id: row.triggered_by_agent_id ?? null,
    conversation_id: row.conversation_id ?? null,
  };
}

export function toWorkflowStepRun(row: StepRunRow): WorkflowStepRun {
  return {
    id: row.id,
    workflow_run_id: row.workflow_run_id,
    node_id: row.node_id,
    status: row.status as WorkflowNodeStatus,
    attempt: row.attempt ?? 1,
    input_json: row.input_json ?? null,
    output_json: row.output_json ?? null,
    error: row.error ?? null,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    duration_ms: row.duration_ms ?? null,
    assigned_agent_id: row.assigned_agent_id ?? null,
    metadata_json: row.metadata_json ?? "{}",
  };
}

export function toWorkflowTransition(row: TransitionRow): WorkflowTransition {
  return {
    id: row.id,
    workflow_run_id: row.workflow_run_id,
    from_node_id: row.from_node_id ?? null,
    to_node_id: row.to_node_id,
    reason: row.reason ?? "",
    created_at: row.created_at,
  };
}

// ---------- 工作流定义 CRUD ----------

export function listWorkflowDefinitions(): WorkflowDefinition[] {
  const rows = getDb().select().from(workflows).orderBy(desc(workflows.updated_at)).all();
  return rows.map(toWorkflowDefinition);
}

export function getWorkflowDefinition(id: string): WorkflowDefinition | null {
  const row = getDb().select().from(workflows).where(eq(workflows.id, id)).get();
  return row ? toWorkflowDefinition(row) : null;
}

export function createWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition {
  const normalized = normalizeDefinition(cloneDefinition(def));
  getDb()
    .insert(workflows)
    .values({
      id: normalized.id,
      name: normalized.name,
      description: normalized.description,
      status: normalized.status,
      nodes_json: JSON.stringify(normalized.nodes),
      entry_node_id: normalized.entryNodeId,
      version: normalized.version,
      steps_json: normalized.steps_json ?? "[]",
      trigger: normalized.trigger,
      created_at: normalized.created_at,
      updated_at: normalized.updated_at,
    })
    .run();
  return normalized;
}

export function updateWorkflowDefinition(
  id: string,
  patch: Partial<WorkflowDefinition>,
): WorkflowDefinition | null {
  const current = getWorkflowDefinition(id);
  if (!current) return null;
  const next = normalizeDefinition({ ...current, ...patch, id: current.id });
  getDb()
    .update(workflows)
    .set({
      name: next.name,
      description: next.description,
      status: next.status,
      nodes_json: JSON.stringify(next.nodes),
      entry_node_id: next.entryNodeId,
      version: next.version,
      steps_json: next.steps_json ?? "[]",
      trigger: next.trigger,
      updated_at: Date.now(),
    })
    .where(eq(workflows.id, id))
    .run();
  return next;
}

export function deleteWorkflowDefinition(id: string): boolean {
  const res = getDb().delete(workflows).where(eq(workflows.id, id)).run();
  return res.changes > 0;
}

// ---------- 运行记录 CRUD ----------

export function listWorkflowRuns(limit = 100): WorkflowRun[] {
  const rows = getDb()
    .select()
    .from(workflowRuns)
    .orderBy(desc(workflowRuns.started_at))
    .limit(limit)
    .all();
  return rows.map(toWorkflowRun);
}

/**
 * 给定会话，返回最近一个工作流运行的活动快照：
 *  - 优先返回状态为 queued/running/waiting_approval/waiting_handoff 的最新一条
 *  - 若无活动 run，则返回最近一条任意状态的 run（用于显示终态 toast）
 *  - 若该 run 仍有 running 状态的 step_run，则附带 currentNodeId
 */
export interface ActiveWorkflowRunSnapshot {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt: number | null;
  currentNodeId: string | null;
}

export function getActiveWorkflowRunForConversation(
  conversationId: string,
): ActiveWorkflowRunSnapshot | null {
  const db = getDb();
  // 1) 优先：未结束的 run
  const active = db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.conversation_id, conversationId),
        inArray(workflowRuns.status, ["queued", "running", "waiting_approval", "waiting_handoff"]),
      ),
    )
    .orderBy(desc(workflowRuns.started_at))
    .limit(1)
    .get();
  // 2) 否则：最近的任意状态
  const recent =
    active ??
    db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.conversation_id, conversationId))
      .orderBy(desc(workflowRuns.started_at))
      .limit(1)
      .get();
  if (!recent) return null;
  // 取最近一个仍处于 running 状态的 step（如果存在即代表"当前节点"）
  const step = db
    .select()
    .from(workflowStepRuns)
    .where(
      and(eq(workflowStepRuns.workflow_run_id, recent.id), eq(workflowStepRuns.status, "running")),
    )
    .orderBy(desc(workflowStepRuns.started_at), desc(workflowStepRuns.id))
    .limit(1)
    .get();
  return {
    id: recent.id,
    workflowId: recent.workflow_id,
    status: recent.status,
    startedAt: recent.started_at,
    finishedAt: recent.finished_at,
    currentNodeId: step?.node_id ?? null,
  };
}

export function getWorkflowRun(id: string): WorkflowRun | null {
  const row = getDb().select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
  return row ? toWorkflowRun(row) : null;
}

export function getWorkflowRunsByWorkflow(workflowId: string, limit = 50): WorkflowRun[] {
  const rows = getDb()
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflow_id, workflowId))
    .orderBy(desc(workflowRuns.started_at))
    .limit(limit)
    .all();
  return rows.map(toWorkflowRun);
}

export interface CreateWorkflowRunInput {
  id?: string;
  workflowId: string;
  runtimeRunId?: string | null;
  status: WorkflowRunStatus;
  inputJson?: string | null;
  outputJson?: string | null;
  error?: string | null;
  contextJson?: string;
  startedAt?: number;
  finishedAt?: number | null;
  triggeredBy: WorkflowRun["triggered_by"];
  triggeredByAgentId?: string | null;
  conversationId?: string | null;
}

export function createWorkflowRunRecord(input: CreateWorkflowRunInput): WorkflowRun {
  const id = input.id ?? randomUUID();
  const row = {
    id,
    workflow_id: input.workflowId,
    runtime_run_id: input.runtimeRunId ?? null,
    status: input.status,
    input_json: input.inputJson ?? null,
    output_json: input.outputJson ?? null,
    error: input.error ?? null,
    context_json: input.contextJson ?? "{}",
    triggered_by: input.triggeredBy,
    triggered_by_agent_id: input.triggeredByAgentId ?? null,
    conversation_id: input.conversationId ?? null,
    started_at: input.startedAt ?? Date.now(),
    finished_at: input.finishedAt ?? null,
  };
  getDb().insert(workflowRuns).values(row).run();
  return toWorkflowRun(row);
}

export function updateWorkflowRunRecord(
  id: string,
  patch: Partial<{
    status: WorkflowRunStatus;
    outputJson: string | null;
    error: string | null;
    contextJson: string;
    finishedAt: number | null;
    runtimeRunId: string | null;
  }>,
): WorkflowRun | null {
  const current = getWorkflowRun(id);
  if (!current) return null;
  const update: Partial<typeof workflowRuns.$inferInsert> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.outputJson !== undefined) update.output_json = patch.outputJson;
  if (patch.error !== undefined) update.error = patch.error;
  if (patch.contextJson !== undefined) update.context_json = patch.contextJson;
  if (patch.finishedAt !== undefined) update.finished_at = patch.finishedAt;
  if (patch.runtimeRunId !== undefined) update.runtime_run_id = patch.runtimeRunId;
  getDb().update(workflowRuns).set(update).where(eq(workflowRuns.id, id)).run();
  return getWorkflowRun(id);
}

// ---------- 步骤运行记录 CRUD ----------

export function listWorkflowStepRuns(runId: string): WorkflowStepRun[] {
  const rows = getDb()
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.workflow_run_id, runId))
    .orderBy(asc(workflowStepRuns.started_at), asc(workflowStepRuns.id))
    .all();
  return rows.map(toWorkflowStepRun);
}

export function getWorkflowStepRun(id: string): WorkflowStepRun | null {
  const row = getDb().select().from(workflowStepRuns).where(eq(workflowStepRuns.id, id)).get();
  return row ? toWorkflowStepRun(row) : null;
}

export interface CreateWorkflowStepRunInput {
  id?: string;
  workflowRunId: string;
  nodeId: string;
  status: WorkflowNodeStatus;
  attempt?: number;
  inputJson?: string | null;
  outputJson?: string | null;
  error?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  durationMs?: number | null;
  assignedAgentId?: string | null;
  metadataJson?: string;
}

export function createWorkflowStepRun(input: CreateWorkflowStepRunInput): WorkflowStepRun {
  const row = {
    id: input.id ?? randomUUID(),
    workflow_run_id: input.workflowRunId,
    node_id: input.nodeId,
    status: input.status,
    attempt: input.attempt ?? 1,
    input_json: input.inputJson ?? null,
    output_json: input.outputJson ?? null,
    error: input.error ?? null,
    started_at: input.startedAt ?? Date.now(),
    finished_at: input.finishedAt ?? null,
    duration_ms: input.durationMs ?? null,
    assigned_agent_id: input.assignedAgentId ?? null,
    metadata_json: input.metadataJson ?? "{}",
  };
  getDb().insert(workflowStepRuns).values(row).run();
  return toWorkflowStepRun(row);
}

export function updateWorkflowStepRun(
  id: string,
  patch: Partial<{
    status: WorkflowNodeStatus;
    attempt: number;
    inputJson: string | null;
    outputJson: string | null;
    error: string | null;
    startedAt: number | null;
    finishedAt: number | null;
    durationMs: number | null;
    assignedAgentId: string | null;
    metadataJson: string;
  }>,
): WorkflowStepRun | null {
  const current = getWorkflowStepRun(id);
  if (!current) return null;
  const update: Partial<typeof workflowStepRuns.$inferInsert> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.attempt !== undefined) update.attempt = patch.attempt;
  if (patch.inputJson !== undefined) update.input_json = patch.inputJson;
  if (patch.outputJson !== undefined) update.output_json = patch.outputJson;
  if (patch.error !== undefined) update.error = patch.error;
  if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) update.finished_at = patch.finishedAt;
  if (patch.durationMs !== undefined) update.duration_ms = patch.durationMs;
  if (patch.assignedAgentId !== undefined) update.assigned_agent_id = patch.assignedAgentId;
  if (patch.metadataJson !== undefined) update.metadata_json = patch.metadataJson;
  getDb().update(workflowStepRuns).set(update).where(eq(workflowStepRuns.id, id)).run();
  return getWorkflowStepRun(id);
}

// ---------- 状态迁移记录 ----------

export function listWorkflowTransitions(runId: string): WorkflowTransition[] {
  const rows = getDb()
    .select()
    .from(workflowTransitions)
    .where(eq(workflowTransitions.workflow_run_id, runId))
    .orderBy(asc(workflowTransitions.created_at), asc(workflowTransitions.id))
    .all();
  return rows.map(toWorkflowTransition);
}

export function recordWorkflowTransition(
  runId: string,
  fromNodeId: string | null,
  toNodeId: string,
  reason: string,
): WorkflowTransition {
  const row = {
    id: randomUUID(),
    workflow_run_id: runId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    reason,
    created_at: Date.now(),
  };
  getDb().insert(workflowTransitions).values(row).run();
  return toWorkflowTransition(row);
}

// ---------- 复合查询（用于渲染层 detail 视图） ----------

export function getWorkflowRunDetail(runId: string): {
  run: WorkflowRun | null;
  steps: WorkflowStepRun[];
  transitions: WorkflowTransition[];
} {
  const run = getWorkflowRun(runId);
  if (!run) return { run: null, steps: [], transitions: [] };
  return {
    run,
    steps: listWorkflowStepRuns(runId),
    transitions: listWorkflowTransitions(runId),
  };
}

// ---------- 兼容性 / 迁移辅助 ----------

/**
 * 把工作流定义从旧 `steps_json` 升级到新 `nodes_json`。
 * - 旧记录 `nodes_json` 为空、`steps_json` 非空时调用此函数。
 * - 跳过已有 `nodes_json` 的记录。
 */
export function upgradeLegacyWorkflows(): number {
  const rows = getDb().select().from(workflows).all();
  let updated = 0;
  for (const row of rows) {
    const parsedNodes = safeParseJson<WorkflowNode[] | null>(row.nodes_json, null);
    const hasNodes = Array.isArray(parsedNodes) && parsedNodes.length > 0;
    if (hasNodes) continue;
    const legacySteps = safeParseJson<unknown[]>(row.steps_json, []);
    if (legacySteps.length === 0) continue;
    const nodes: WorkflowNode[] = legacySteps.map((s, idx) => buildNodeFromLegacyStep(s, idx));
    const def: WorkflowDefinition = {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      trigger: row.trigger,
      version: row.version ?? 1,
      entryNodeId: nodes[0]?.id ?? "",
      nodes,
      steps_json: row.steps_json ?? "[]",
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    const normalized = normalizeDefinition(def);
    getDb()
      .update(workflows)
      .set({
        nodes_json: JSON.stringify(normalized.nodes),
        entry_node_id: normalized.entryNodeId,
        version: normalized.version,
        updated_at: Date.now(),
      })
      .where(eq(workflows.id, row.id))
      .run();
    updated += 1;
  }
  return updated;
}
