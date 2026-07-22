import {
  DEFAULT_AGENT_ID,
  type AgentRuntimeState,
  type DesktopPetActivitySummary,
  type RuntimeRun,
} from "../../shared/types";

interface DesktopPetActivityResolution {
  activity: DesktopPetActivitySummary;
  pendingCount: number;
}

export const DESKTOP_PET_SLEEP_AFTER_MS = 60_000;

export function resolveDesktopPetActivity(
  runs: RuntimeRun[],
  mainAgentState?: AgentRuntimeState,
): DesktopPetActivityResolution {
  const activity = activityForAgentState(mainAgentState, runs);
  return { activity, pendingCount: activity.kind === "idle" ? 0 : 1 };
}

export function applyDesktopPetIdleTimeout(
  activity: DesktopPetActivitySummary,
  idleSince: number,
  now = Date.now(),
): DesktopPetActivitySummary {
  if (activity.kind !== "idle" || now - idleSince < DESKTOP_PET_SLEEP_AFTER_MS) return activity;
  return {
    kind: "sleeping",
    agentStatus: activity.agentStatus,
    runId: null,
    conversationId: null,
    title: "Sleeping",
    detail: null,
  };
}

function activityForAgentState(
  state: AgentRuntimeState | undefined,
  runs: RuntimeRun[],
): DesktopPetActivitySummary {
  if (!state || state.agent_id !== DEFAULT_AGENT_ID || state.status === "idle") {
    return {
      kind: "idle",
      agentStatus: "idle",
      runId: null,
      conversationId: null,
      title: "Idle",
      detail: null,
    };
  }

  const run = state.current_run_id
    ? runs.find((candidate) => candidate.id === state.current_run_id)
    : undefined;
  return {
    kind:
      state.status === "failed"
        ? "blocked"
        : state.status === "reviewing"
          ? "needs_input"
          : state.status === "handoff"
            ? "needs_input"
            : "running",
    agentStatus: state.status,
    runId: run?.id ?? state.current_run_id,
    conversationId: run?.conversation_id ?? null,
    title: state.status,
    detail: state.last_error || run?.error || run?.output_summary || run?.input_summary || null,
  };
}
