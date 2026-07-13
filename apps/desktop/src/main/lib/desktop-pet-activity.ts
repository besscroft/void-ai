import {
  DEFAULT_AGENT_ID,
  type AgentRuntimeState,
  type AgentRuntimeStatus,
  type DesktopPetActivitySummary,
  type RuntimeRun,
} from "../../shared/types";

interface DesktopPetActivityResolution {
  activity: DesktopPetActivitySummary;
  pendingCount: number;
}

interface Candidate {
  priority: number;
  timestamp: number;
  activity: DesktopPetActivitySummary;
}

export const DESKTOP_PET_SLEEP_AFTER_MS = 60_000;

export function resolveDesktopPetActivity(
  runs: RuntimeRun[],
  acknowledgedRunIds: string[],
  mainAgentState?: AgentRuntimeState,
): DesktopPetActivityResolution {
  const acknowledged = new Set(acknowledgedRunIds);
  const candidates = runs
    .filter((run) => run.root_agent_id === DEFAULT_AGENT_ID)
    .flatMap((run): Candidate[] => {
      const timestamp = run.finished_at ?? run.started_at;
      if (run.status === "waiting_approval" || run.status === "waiting_handoff") {
        return [
          {
            priority: 4,
            timestamp,
            activity: summary(
              run,
              "needs_input",
              "Needs input",
              run.status === "waiting_approval" ? "reviewing" : "handoff",
            ),
          },
        ];
      }
      if (run.status === "failed" && !acknowledged.has(run.id)) {
        return [{ priority: 3, timestamp, activity: summary(run, "blocked", "Run failed") }];
      }
      if (run.status === "succeeded" && !acknowledged.has(run.id)) {
        return [{ priority: 2, timestamp, activity: summary(run, "ready", "Ready") }];
      }
      if (run.status === "queued" || run.status === "running") {
        return [
          {
            priority: 1,
            timestamp,
            activity: summary(run, "running", "Running", run.status),
          },
        ];
      }
      return [];
    })
    .sort((left, right) => right.priority - left.priority || right.timestamp - left.timestamp);

  const agentActivity = activityForAgentState(mainAgentState, runs);
  if (agentActivity) {
    return {
      activity: agentActivity,
      pendingCount: Math.max(1, candidates.length),
    };
  }

  return {
    activity: candidates[0]?.activity ?? {
      kind: "idle",
      agentStatus: mainAgentState?.status ?? "idle",
      runId: null,
      conversationId: null,
      title: "Idle",
      detail: null,
    },
    pendingCount: candidates.length,
  };
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

function summary(
  run: RuntimeRun,
  kind: DesktopPetActivitySummary["kind"],
  title: string,
  agentStatus: AgentRuntimeStatus | null = null,
): DesktopPetActivitySummary {
  return {
    kind,
    agentStatus,
    runId: run.id,
    conversationId: run.conversation_id,
    title,
    detail: run.error || run.output_summary || run.input_summary || null,
  };
}

function activityForAgentState(
  state: AgentRuntimeState | undefined,
  runs: RuntimeRun[],
): DesktopPetActivitySummary | null {
  if (!state || state.status === "idle") return null;
  const run = state.current_run_id
    ? runs.find((candidate) => candidate.id === state.current_run_id)
    : undefined;
  return {
    kind:
      state.status === "failed"
        ? "blocked"
        : state.status === "reviewing"
          ? "needs_input"
          : "running",
    agentStatus: state.status,
    runId: run?.id ?? state.current_run_id,
    conversationId: run?.conversation_id ?? null,
    title: state.status,
    detail: state.last_error || run?.error || run?.output_summary || run?.input_summary || null,
  };
}
