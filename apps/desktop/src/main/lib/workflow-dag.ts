/**
 * Workflow DAG 工具与校验
 *
 * 工作流以节点（node）+ 边（dependsOn）形式存储为 DAG：
 * - 校验：检测环、孤立节点、入口节点缺失、分支/并行子节点有效性
 * - 拓扑排序：用于执行次序参考
 * - ready 计算：找出所有前置 succeeded、自身 pending 的节点
 *
 * 状态机约束：succeeded / failed / skipped / cancelled 视为终态；
 * running / waiting_approval / waiting_handoff 视为非终态（继续等待）。
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowNodeStatus } from "../../shared/types";

export type DagValidationResult = { ok: true } | { ok: false; errors: string[] };

const TERMINAL_STATUSES: ReadonlySet<WorkflowNodeStatus> = new Set<WorkflowNodeStatus>([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

export function isTerminalStatus(status: WorkflowNodeStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 取出节点 id → 节点的索引，方便后续快速查询。 */
function indexNodes(nodes: WorkflowNode[]): Map<string, WorkflowNode> {
  const idx = new Map<string, WorkflowNode>();
  for (const node of nodes) idx.set(node.id, node);
  return idx;
}

/** 校验工作流定义的合法性。 */
export function validateWorkflowDefinition(def: WorkflowDefinition): DagValidationResult {
  const errors: string[] = [];
  const idx = indexNodes(def.nodes);
  if (def.nodes.length === 0) {
    errors.push("workflow has no nodes");
    return { ok: false, errors };
  }
  if (!def.entryNodeId) {
    errors.push("entryNodeId is required");
  } else if (!idx.has(def.entryNodeId)) {
    errors.push(`entryNodeId '${def.entryNodeId}' is not defined in nodes`);
  }
  // 检查 dependsOn 引用与重复 id
  const seen = new Set<string>();
  for (const node of def.nodes) {
    if (seen.has(node.id)) errors.push(`duplicate node id '${node.id}'`);
    seen.add(node.id);
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        errors.push(`node '${node.id}' depends on itself`);
        continue;
      }
      if (!idx.has(dep)) errors.push(`node '${node.id}' depends on missing node '${dep}'`);
    }
    // 校验 parallel / branch 子节点
    if (node.kind === "parallel" && node.config.parallelNodes) {
      for (const sub of node.config.parallelNodes) {
        if (!idx.has(sub))
          errors.push(`parallel node '${node.id}' references missing child '${sub}'`);
        if (sub === node.id) errors.push(`parallel node '${node.id}' cannot include itself`);
      }
    }
    if (node.kind === "branch" && node.config.branches) {
      for (const branch of node.config.branches) {
        if (!idx.has(branch.nodeId))
          errors.push(`branch in '${node.id}' references missing target '${branch.nodeId}'`);
      }
    }
    // fallback 节点必须存在
    if (node.onError === "fallback" && node.fallbackNodeId) {
      if (!idx.has(node.fallbackNodeId))
        errors.push(`node '${node.id}' fallback '${node.fallbackNodeId}' is missing`);
    }
  }
  // 环检测：DFS
  const cycle = detectCycle(def.nodes);
  if (cycle) errors.push(`cycle detected: ${cycle.join(" -> ")}`);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** DFS 检测环。返回第一个环的节点 id 序列；无环返回 null。 */
function detectCycle(nodes: WorkflowNode[]): string[] | null {
  const idx = indexNodes(nodes);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const n of nodes) {
    color.set(n.id, WHITE);
    parent.set(n.id, null);
  }
  // 显式栈避免尾递归
  const stack: { nodeId: string; iter: Iterator<string> }[] = [];
  for (const n of nodes) {
    if (color.get(n.id) !== WHITE) continue;
    stack.push({ nodeId: n.id, iter: (idx.get(n.id)?.dependsOn ?? [])[Symbol.iterator]() });
    color.set(n.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.nodeId, BLACK);
        stack.pop();
        continue;
      }
      const dep = next.value;
      const depColor = color.get(dep) ?? WHITE;
      if (depColor === GRAY) {
        // 找到环：沿 parent 回溯到 dep
        const cycle: string[] = [dep];
        let cur: string | null = top.nodeId;
        while (cur && cur !== dep) {
          cycle.push(cur);
          cur = parent.get(cur) ?? null;
        }
        cycle.push(dep);
        return cycle.reverse();
      }
      if (depColor === WHITE) {
        parent.set(dep, top.nodeId);
        color.set(dep, GRAY);
        stack.push({ nodeId: dep, iter: (idx.get(dep)?.dependsOn ?? [])[Symbol.iterator]() });
      }
    }
  }
  return null;
}

/** 拓扑排序（Kahn 算法）。仅当工作流是 DAG 时给出确定的次序。 */
export function topologicalOrder(def: WorkflowDefinition): string[] {
  const idx = indexNodes(def.nodes);
  const indeg = new Map<string, number>();
  for (const n of def.nodes) indeg.set(n.id, 0);
  for (const n of def.nodes) {
    for (const dep of n.dependsOn) {
      // 倒置视角：A dependsOn B 等价于 B -> A
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
      void idx.get(dep);
    }
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const n of def.nodes) {
      if (n.dependsOn.includes(id)) {
        const newDeg = (indeg.get(n.id) ?? 0) - 1;
        indeg.set(n.id, newDeg);
        if (newDeg === 0) queue.push(n.id);
      }
    }
  }
  return out;
}

/**
 * 计算初始 ready 节点：entryNodeId 自身（若 entry 没有依赖且有定义）。
 * entryNodeId 缺失依赖（如多入口）时回退到"没有依赖的节点集合"。
 */
export function initialReady(def: WorkflowDefinition): string[] {
  if (def.entryNodeId) {
    const entry = def.nodes.find((n) => n.id === def.entryNodeId);
    if (entry && entry.dependsOn.length === 0) return [entry.id];
  }
  return def.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id);
}

export type NodeStatusMap = Map<string, WorkflowNodeStatus>;

/**
 * 找出可调度的 ready 节点：所有前置 succeeded、自身 pending，且未被并发占用的节点。
 * `excluded` 用于"已通过 transition 跳过的"或"被级联跳过的"节点，避免重复调度。
 */
export function nextReady(
  def: WorkflowDefinition,
  statuses: NodeStatusMap,
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  for (const node of def.nodes) {
    if (excluded.has(node.id)) continue;
    const status = statuses.get(node.id) ?? "pending";
    if (status !== "pending") continue;
    let allDepsSucceeded = true;
    for (const dep of node.dependsOn) {
      const depStatus = statuses.get(dep) ?? "pending";
      if (depStatus !== "succeeded") {
        allDepsSucceeded = false;
        break;
      }
    }
    if (allDepsSucceeded) out.push(node.id);
  }
  return out;
}

/**
 * 在某节点失败后，找出"受影响的下游节点"（任意前置处于 failed/skipped/cancelled 的 pending 节点）。
 * 这些节点应当被级联标记为 skipped。
 */
export function collectDownstream(def: WorkflowDefinition, rootIds: Iterable<string>): string[] {
  const visited = new Set<string>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const node of def.nodes) {
      if (node.dependsOn.includes(id) && !visited.has(node.id)) queue.push(node.id);
    }
  }
  return [...visited];
}

/**
 * 用于并行节点的子节点展开：若节点 kind=parallel 且配置了 parallelNodes，
 * 引擎会把它视作"虚拟"组节点；返回它所代表的真实子节点 id 列表。
 */
export function resolveParallelChildren(def: WorkflowDefinition, nodeId: string): string[] {
  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== "parallel") return [];
  return node.config.parallelNodes ?? [];
}
