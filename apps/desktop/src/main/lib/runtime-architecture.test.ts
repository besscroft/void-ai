import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentProfile, ModelCapabilities } from "../../shared/types";
import { isRoutableAgent } from "./agent-routing";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_WORKFLOW_SEEDS,
} from "./runtime-defaults";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";
import { buildToolRegistryPreview } from "./tool-registry";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("runtime architecture", () => {
  void it("generates a single initial schema migration with runtime event storage", () => {
    const migration = readFileSync(path.join(process.cwd(), "drizzle", "0000_initial.sql"), "utf8");

    assert.match(migration, /CREATE TABLE `runtime_runs`/);
    assert.match(migration, /CREATE TABLE `runtime_steps`/);
    assert.match(migration, /CREATE TABLE `runtime_events`/);
    assert.match(migration, /`content_json` text NOT NULL/);
    assert.match(migration, /`metadata_json` text DEFAULT '\{\}' NOT NULL/);
    assert.equal(migration.toLowerCase().includes("harn" + "ess"), false);
    for (const legacyName of [
      ["agent", "runs"],
      ["agent", "run", "steps"],
      ["mcp", "servers"],
      ["mcp", "tools"],
      ["server", "nodes"],
      ["sync", "state"],
    ].map((parts) => parts.join("_"))) {
      assert.equal(migration.includes(legacyName), false);
    }
  });

  void it("defines default seed data for agents, workflows, and tools", () => {
    assert.ok(DEFAULT_CHILD_AGENT_SEEDS.some((agent) => agent.name === "Researcher"));
    assert.ok(DEFAULT_CHILD_AGENT_SEEDS.some((agent) => agent.name === "Operator"));
    assert.ok(DEFAULT_WORKFLOW_SEEDS.some((workflow) => workflow.id === "workflow-runtime-review"));
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "runtime_snapshot"));
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "sandbox_run_command"));
  });

  void it("routes only active, unlocked, enabled child agents", () => {
    const base = {
      id: "agent-test",
      name: "Test",
      role: "Test",
      description: "",
      avatar: "T",
      model_ref: null,
      voice: null,
      created_at: 0,
      updated_at: 0,
      personality: "",
      soul_prompt: "",
      instructions: "",
      persona: "",
      runtime_config_json: "{}",
      tool_policy_json: "{}",
      handoff_config_json: "{}",
    } satisfies Omit<AgentProfile, "kind" | "status" | "locked" | "enabled" | "parent_agent_id">;

    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 0,
        enabled: 1,
      }),
      true,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "archived",
        locked: 0,
        enabled: 1,
      }),
      false,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 1,
        enabled: 1,
      }),
      false,
    );
  });

  void it("builds the tool registry for runtime execution", () => {
    const runtime = buildToolRegistryPreview({
      selection: { mode: "auto", selectedToolIds: [] },
      model: {
        providerId: "test",
        providerKind: "openai-compatible",
        modelId: "model",
        capabilities,
        nativeTools: [],
      },
    });

    assert.equal(runtime.toolChoice, "auto");
    assert.ok(runtime.activeTools?.includes("runtime_snapshot"));
  });

  void it("classifies approval and sandbox policy risks", () => {
    assert.equal(inputHasPathEscape({ path: "../outside.txt" }), true);
    assert.equal(commandLooksDangerous({ command: "npm", args: ["install"] }), true);
    assert.equal(commandLooksDangerous({ command: "node", args: ["--version"] }), false);
  });

  void it("guards sandbox runtime access before a session exists", () => {
    assert.throws(() => getSandboxSessionOrThrow(undefined), /Sandbox session/);
  });
});
