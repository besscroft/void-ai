import {
  DEFAULT_AGENT_ID,
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
            activity: summary(run, "needs_input", "Needs input"),
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
        return [{ priority: 1, timestamp, activity: summary(run, "running", "Running") }];
      }
      return [];
    })
    .sort((left, right) => right.priority - left.priority || right.timestamp - left.timestamp);

  return {
    activity: candidates[0]?.activity ?? {
      kind: "idle",
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
): DesktopPetActivitySummary {
  return {
    kind,
    runId: run.id,
    conversationId: run.conversation_id,
    title,
    detail: run.error || run.output_summary || run.input_summary || null,
  };
}
