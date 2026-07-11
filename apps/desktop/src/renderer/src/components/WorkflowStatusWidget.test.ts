import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentInstanceRecord, RuntimeSnapshot } from "@shared/types";
import { selectAgentActivity } from "./WorkflowStatusWidget";

const child: AgentInstanceRecord = {
  id: "child-1",
  run_id: "run-1",
  agent_id: "agent-research",
  agent_path: "/root/research",
  parent_instance_id: null,
  parent_agent_path: "/root",
  status: "running",
  task_name: "Research",
  task_summary: "Find the relevant evidence",
  turn_count: 1,
  last_message: null,
  error: null,
  started_at: 110,
  finished_at: null,
  created_at: 105,
  updated_at: 120,
};

function snapshot(): Pick<
  RuntimeSnapshot,
  "runtimeRuns" | "conversationAgentStates" | "agentInstances"
> {
  return {
    runtimeRuns: [
      {
        id: "run-1",
        conversation_id: "conversation-1",
        root_agent_id: "agent-void",
        final_agent_id: "agent-void",
        status: "running",
        model_ref: "mock/chat",
        started_at: 100,
        finished_at: null,
        trace_id: "run-1",
        input_summary: null,
        output_summary: null,
        error: null,
        usage_json: null,
      },
    ],
    conversationAgentStates: [
      {
        conversation_id: "conversation-1",
        active_agent_id: "agent-research",
        current_run_id: "run-1",
        current_step_id: null,
        status: "running",
        summary: "Research is consulting",
        updated_at: 120,
      },
    ],
    agentInstances: [child, { ...child, id: "other", run_id: "run-other" }],
  };
}

void describe("agent activity selection", () => {
  void it("always includes the root agent and filters children to the active run", () => {
    const activity = selectAgentActivity(snapshot(), "conversation-1", "streaming", true, 150);

    assert.equal(activity?.active, true);
    assert.deepEqual(
      activity?.agents.map((agent) => agent.path),
      ["/root", "/root/research"],
    );
  });

  void it("shows a pending root before the runtime snapshot arrives", () => {
    const activity = selectAgentActivity(null, "conversation-1", "submitted", true, 150);

    assert.equal(activity?.agents.length, 1);
    assert.equal(activity?.agents[0]?.status, "running");
  });

  void it("maps a completed runtime run to a terminal root state", () => {
    const data = snapshot();
    data.runtimeRuns[0] = {
      ...data.runtimeRuns[0],
      status: "succeeded",
      finished_at: 200,
    };
    data.conversationAgentStates[0] = {
      ...data.conversationAgentStates[0],
      current_run_id: null,
      status: "idle",
    };

    const activity = selectAgentActivity(data, "conversation-1", "ready", false, 250);

    assert.equal(activity?.active, false);
    assert.equal(activity?.agents[0]?.status, "succeeded");
  });
});
