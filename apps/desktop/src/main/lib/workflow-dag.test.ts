/**
 * 工作流 DAG 工具与校验：单元测试。
 *
 * 纯函数测试，不需要数据库。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDownstream,
  initialReady,
  isTerminalStatus,
  nextReady,
  resolveParallelChildren,
  topologicalOrder,
  validateWorkflowDefinition,
} from "./workflow-dag";
import { DEFAULT_RETRY_POLICY, makeAdHocWorkflow } from "./workflow-types";
import type { WorkflowDefinition, WorkflowNode } from "../../shared/types";

function makeNode(
  id: string,
  kind: WorkflowNode["kind"] = "prompt",
  dependsOn: string[] = [],
): WorkflowNode {
  return {
    id,
    kind,
    title: id,
    dependsOn,
    config: {},
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    onError: "fail",
  };
}

function buildDef(nodes: WorkflowNode[], entryNodeId: string): WorkflowDefinition {
  return {
    id: "wf-test",
    name: "test",
    description: "",
    status: "enabled",
    trigger: "manual",
    version: 1,
    entryNodeId,
    nodes,
    created_at: 0,
    updated_at: 0,
  };
}

void describe("validateWorkflowDefinition", () => {
  void it("接受有效线性工作流", () => {
    const def = buildDef(
      [makeNode("a"), makeNode("b", "prompt", ["a"]), makeNode("c", "prompt", ["b"])],
      "a",
    );
    const result = validateWorkflowDefinition(def);
    assert.equal(result.ok, true);
  });

  void it("拒绝空工作流", () => {
    const result = validateWorkflowDefinition(buildDef([], "a"));
    assert.equal(result.ok, false);
  });

  void it("拒绝缺失的 entryNodeId", () => {
    const def = buildDef([makeNode("a")], "ghost");
    const result = validateWorkflowDefinition(def);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("entryNodeId")));
    }
  });

  void it("拒绝自依赖", () => {
    const def = buildDef([makeNode("a", "prompt", ["a"])], "a");
    const result = validateWorkflowDefinition(def);
    assert.equal(result.ok, false);
  });

  void it("检测环", () => {
    const def = buildDef(
      [
        makeNode("a", "prompt", ["c"]),
        makeNode("b", "prompt", ["a"]),
        makeNode("c", "prompt", ["b"]),
      ],
      "a",
    );
    const result = validateWorkflowDefinition(def);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("cycle")));
    }
  });

  void it("接受菱形依赖", () => {
    const def = buildDef(
      [
        makeNode("a"),
        makeNode("b", "prompt", ["a"]),
        makeNode("c", "prompt", ["a"]),
        makeNode("d", "prompt", ["b", "c"]),
      ],
      "a",
    );
    const result = validateWorkflowDefinition(def);
    assert.equal(result.ok, true);
  });
});

void describe("isTerminalStatus", () => {
  void it("终态判断", () => {
    assert.equal(isTerminalStatus("succeeded"), true);
    assert.equal(isTerminalStatus("failed"), true);
    assert.equal(isTerminalStatus("skipped"), true);
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("running"), false);
    assert.equal(isTerminalStatus("pending"), false);
    assert.equal(isTerminalStatus("waiting_approval"), false);
  });
});

void describe("initialReady / nextReady", () => {
  void it("线性工作流初始只返回 entryNode", () => {
    const def = buildDef([makeNode("a"), makeNode("b", "prompt", ["a"])], "a");
    assert.deepEqual(initialReady(def), ["a"]);
  });

  void it("nextReady 在 a 完成后返回 b", () => {
    const def = buildDef(
      [makeNode("a"), makeNode("b", "prompt", ["a"]), makeNode("c", "prompt", ["b"])],
      "a",
    );
    const ready = nextReady(def, new Map([["a", "succeeded"]]));
    assert.deepEqual(ready, ["b"]);
  });

  void it("菱形依赖在 b、c 都成功后返回 d", () => {
    const def = buildDef(
      [
        makeNode("a"),
        makeNode("b", "prompt", ["a"]),
        makeNode("c", "prompt", ["a"]),
        makeNode("d", "prompt", ["b", "c"]),
      ],
      "a",
    );
    const ready = nextReady(
      def,
      new Map([
        ["a", "succeeded"],
        ["b", "succeeded"],
        ["c", "succeeded"],
      ]),
    );
    assert.deepEqual(ready, ["d"]);
  });
});

void describe("collectDownstream", () => {
  void it("收集直接与传递下游", () => {
    const def = buildDef(
      [
        makeNode("a"),
        makeNode("b", "prompt", ["a"]),
        makeNode("c", "prompt", ["b"]),
        makeNode("d"), // 独立
      ],
      "a",
    );
    const downstream = collectDownstream(def, ["a"]);
    assert.deepEqual(new Set(downstream), new Set(["a", "b", "c"]));
  });
});

void describe("topologicalOrder", () => {
  void it("线性 A->B->C 排序为 [A, B, C]", () => {
    const def = buildDef(
      [makeNode("a"), makeNode("b", "prompt", ["a"]), makeNode("c", "prompt", ["b"])],
      "a",
    );
    const order = topologicalOrder(def);
    assert.ok(order.indexOf("a") < order.indexOf("b"));
    assert.ok(order.indexOf("b") < order.indexOf("c"));
  });
});

void describe("resolveParallelChildren", () => {
  void it("返回 parallel 节点的子节点", () => {
    const parallelNode: WorkflowNode = {
      ...makeNode("p", "parallel"),
      config: { parallelNodes: ["x", "y"] },
    };
    const def = buildDef([parallelNode, makeNode("x"), makeNode("y")], "p");
    assert.deepEqual(resolveParallelChildren(def, "p"), ["x", "y"]);
  });
});

void describe("makeAdHocWorkflow", () => {
  void it("构造一个单节点工作流", () => {
    const def = makeAdHocWorkflow({
      name: "adhoc",
      node: makeNode("only", "prompt"),
    });
    assert.equal(def.nodes.length, 1);
    assert.equal(def.entryNodeId, "only");
    assert.equal(def.status, "draft");
  });
});
