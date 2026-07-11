import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
} from "@shared/types";
import { getVisibleAgents } from "./agent-list";

void describe("agent config normalization", () => {
  void it("normalizes the legacy empty object agent config shape", () => {
    assert.deepEqual(normalizeAgentToolPolicy("{}"), DEFAULT_AGENT_TOOL_POLICY);
    assert.deepEqual(normalizeAgentHandoffConfig("{}"), DEFAULT_AGENT_HANDOFF_CONFIG);
    assert.deepEqual(normalizeAgentRuntimeConfig("{}"), DEFAULT_AGENT_RUNTIME_CONFIG);
  });

  void it("falls back from invalid JSON to defaults", () => {
    assert.deepEqual(normalizeAgentToolPolicy("{bad json"), DEFAULT_AGENT_TOOL_POLICY);
    assert.deepEqual(normalizeAgentHandoffConfig("{bad json"), DEFAULT_AGENT_HANDOFF_CONFIG);
    assert.deepEqual(normalizeAgentRuntimeConfig("{bad json"), DEFAULT_AGENT_RUNTIME_CONFIG);
  });

  void it("repairs missing arrays and filters unknown tool ids", () => {
    const policy = normalizeAgentToolPolicy({
      mode: "custom",
      allowedToolIds: ["web_search", "unknown", "web_search"],
    });

    assert.equal(policy.mode, "custom");
    assert.deepEqual(policy.allowedToolIds, ["web_search"]);
    assert.deepEqual(
      policy.requireApprovalToolIds,
      DEFAULT_AGENT_TOOL_POLICY.requireApprovalToolIds,
    );
  });

  void it("repairs invalid handoff and runtime fields", () => {
    const handoff = normalizeAgentHandoffConfig({
      mode: "invalid",
      priority: "urgent",
      accepts: ["research", 42, ""],
      expectedOutput: "",
    });
    const runtime = normalizeAgentRuntimeConfig({
      maxTurns: 99,
      temperature: -1,
      topP: 2,
      maxOutputTokens: 99_999,
      maxConcurrentSubagents: 99,
      totalTimeoutMs: 1,
      contextPolicy: {
        mode: "invalid",
        pruneThreshold: 0,
        compactThreshold: 2,
        targetRatio: 2,
        keepRecentTokens: 1,
      },
      reasoning: "extreme",
      reviewPolicy: "maybe",
      sandboxPolicy: "remote",
      notes: "keep me",
    });

    assert.equal(handoff.mode, DEFAULT_AGENT_HANDOFF_CONFIG.mode);
    assert.equal(handoff.priority, DEFAULT_AGENT_HANDOFF_CONFIG.priority);
    assert.deepEqual(handoff.accepts, ["research", "42"]);
    assert.equal(handoff.expectedOutput, DEFAULT_AGENT_HANDOFF_CONFIG.expectedOutput);
    assert.equal(runtime.maxTurns, 20);
    assert.equal(runtime.temperature, 0);
    assert.equal(runtime.topP, 1);
    assert.equal(runtime.maxOutputTokens, 32768);
    assert.equal(runtime.maxConcurrentSubagents, 16);
    assert.equal(runtime.totalTimeoutMs, 10_000);
    assert.equal(runtime.contextPolicy?.mode, "semantic");
    assert.equal(runtime.contextPolicy?.pruneThreshold, 0.3);
    assert.equal(runtime.contextPolicy?.compactThreshold, 0.98);
    assert.equal(runtime.contextPolicy?.targetRatio, 0.3);
    assert.equal(runtime.contextPolicy?.keepRecentTokens, 1_000);
    assert.equal(runtime.reasoning, undefined);
    assert.equal(runtime.reviewPolicy, DEFAULT_AGENT_RUNTIME_CONFIG.reviewPolicy);
    assert.equal(runtime.sandboxPolicy, DEFAULT_AGENT_RUNTIME_CONFIG.sandboxPolicy);
    assert.equal(runtime.notes, "keep me");
  });

  void it("keeps the Void handoff backfill default when requested", () => {
    const config = normalizeAgentHandoffConfig("{}", {
      ...DEFAULT_AGENT_HANDOFF_CONFIG,
      mode: "both",
    });

    assert.equal(config.mode, "both");
    assert.equal(config.priority, "normal");
  });

  void it("keeps the default main agent visible first in the active list", () => {
    const main = agentProfile({
      id: DEFAULT_AGENT_ID,
      name: "Void",
      kind: "main",
      updated_at: 1,
    });
    const child = agentProfile({
      id: "agent-researcher",
      name: "Researcher",
      kind: "child",
      updated_at: 2,
    });

    assert.deepEqual(
      getVisibleAgents([child, main], "active", "").map((agent) => agent.id),
      [DEFAULT_AGENT_ID, "agent-researcher"],
    );
  });
});

function agentProfile(
  input: Partial<import("@shared/types").AgentProfile> &
    Pick<import("@shared/types").AgentProfile, "id" | "name" | "kind">,
): import("@shared/types").AgentProfile {
  const { id, kind, name, ...overrides } = input;
  return {
    id,
    name,
    role: "Test agent",
    description: "",
    avatar: "A",
    status: "active",
    kind,
    parent_agent_id: kind === "main" ? null : DEFAULT_AGENT_ID,
    locked: kind === "main" ? 1 : 0,
    enabled: 1,
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
    ...overrides,
  };
}
