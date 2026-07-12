import { useEffect, useMemo, useState } from "react";
import type {
  ActiveWorkflowRunSnapshot,
  AgentInstanceRecord,
  RuntimeSnapshot,
} from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import {
  IconBrain,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconCpu,
} from "./icons";

type RuntimeSnapshotSubset = Pick<
  RuntimeSnapshot,
  "runtimeRuns" | "conversationAgentStates" | "agentInstances"
>;

type ChatRunStatus = "submitted" | "streaming" | "ready" | "stopped" | "error";
type ActivityStatus =
  | AgentInstanceRecord["status"]
  | "waiting_approval"
  | "succeeded"
  | "cancelled";

export interface AgentActivityItem {
  id: string;
  name: string;
  path: string;
  status: ActivityStatus;
  summary: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  isRoot: boolean;
}

export interface AgentActivityModel {
  runId: string;
  active: boolean;
  failed: boolean;
  waitingApproval: boolean;
  startedAt: number;
  finishedAt: number | null;
  agents: AgentActivityItem[];
}

interface AgentStatusWidgetProps {
  conversationId: string;
  snapshot: RuntimeSnapshotSubset | null;
  chatStatus: ChatRunStatus;
  isChatActive: boolean;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_approval", "waiting_handoff"]);
const ACTIVE_WORKFLOW_STATUSES = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_handoff",
]);
const POLL_INTERVAL_MS = 1_500;

export function selectAgentActivity(
  snapshot: RuntimeSnapshotSubset | null,
  conversationId: string,
  chatStatus: ChatRunStatus,
  isChatActive: boolean,
  now = Date.now(),
): AgentActivityModel | null {
  const runs = (snapshot?.runtimeRuns ?? [])
    .filter((run) => run.conversation_id === conversationId)
    .sort((a, b) => b.started_at - a.started_at);
  const conversationState = snapshot?.conversationAgentStates.find(
    (state) => state.conversation_id === conversationId,
  );
  const currentRun = conversationState?.current_run_id
    ? runs.find((run) => run.id === conversationState.current_run_id)
    : undefined;
  const runtimeRun = currentRun ?? runs.at(0);

  if (!isChatActive && !runtimeRun) return null;

  const runId = runtimeRun?.id ?? `pending:${conversationId}`;
  const waitingApproval =
    conversationState?.status === "reviewing" || runtimeRun?.status === "waiting_approval";
  const active =
    isChatActive ||
    waitingApproval ||
    (runtimeRun ? ACTIVE_RUN_STATUSES.has(runtimeRun.status) : false);
  const failed = chatStatus === "error" || runtimeRun?.status === "failed";
  const rootStatus: ActivityStatus = waitingApproval
    ? "waiting_approval"
    : active
      ? "running"
      : failed
        ? "failed"
        : chatStatus === "stopped" || runtimeRun?.status === "cancelled"
          ? "cancelled"
          : "succeeded";
  const root: AgentActivityItem = {
    id: `root:${runId}`,
    name: "Paimon",
    path: "/root",
    status: rootStatus,
    summary: conversationState?.summary ?? runtimeRun?.output_summary ?? null,
    error: runtimeRun?.error ?? null,
    startedAt: runtimeRun?.started_at ?? now,
    finishedAt: active ? null : (runtimeRun?.finished_at ?? now),
    isRoot: true,
  };
  const children = (snapshot?.agentInstances ?? [])
    .filter((instance) => instance.run_id === runId)
    .sort((a, b) => a.created_at - b.created_at)
    .map(toActivityItem);

  return {
    runId,
    active,
    failed: failed || children.some((item) => item.status === "failed"),
    waitingApproval,
    startedAt: runtimeRun?.started_at ?? now,
    finishedAt: active ? null : (runtimeRun?.finished_at ?? now),
    agents: [root, ...children],
  };
}

function toActivityItem(instance: AgentInstanceRecord): AgentActivityItem {
  return {
    id: instance.id,
    name: instance.task_name || instance.agent_id,
    path: instance.agent_path,
    status: instance.status,
    summary: instance.task_summary || instance.last_message,
    error: instance.error,
    startedAt: instance.started_at,
    finishedAt: instance.finished_at,
    isRoot: false,
  };
}

export function AgentStatusWidget({
  conversationId,
  snapshot,
  chatStatus,
  isChatActive,
}: AgentStatusWidgetProps): React.JSX.Element | null {
  const { t } = useT();
  const [workflow, setWorkflow] = useState<ActiveWorkflowRunSnapshot | null>(null);
  const [retainedActivity, setRetainedActivity] = useState<AgentActivityModel | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setClock] = useState(0);
  const activity = useMemo(
    () => selectAgentActivity(snapshot, conversationId, chatStatus, isChatActive),
    [chatStatus, conversationId, isChatActive, snapshot],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await api.workflows.activeRunForConversation(conversationId);
        if (!cancelled && next) setWorkflow(next);
      } catch (error) {
        console.error("[agent-status] failed to load workflow:", error);
      }
    };
    void load();
    if (!isChatActive) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationId, isChatActive]);

  useEffect(() => {
    if (activity) setRetainedActivity(activity);
  }, [activity]);

  useEffect(() => {
    if (!activity?.active && !workflow) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [activity?.active, workflow]);

  useEffect(() => {
    const hasChild = (activity?.agents.length ?? 0) > 1;
    if (hasChild || activity?.waitingApproval || activity?.failed) setExpanded(true);
  }, [activity?.agents.length, activity?.failed, activity?.waitingApproval]);

  const workflowActive = workflow ? ACTIVE_WORKFLOW_STATUSES.has(workflow.status) : false;
  const visibleActivity = activity ?? retainedActivity;
  const visibleWorkflow = workflow;
  if (!visibleActivity && !visibleWorkflow) return null;

  const agents = visibleActivity?.agents ?? [];
  const activeAgentCount = agents.filter((agent) => isActiveAgentStatus(agent.status)).length;
  const startedAt = visibleActivity?.startedAt ?? workflow?.startedAt ?? Date.now();
  const finishedAt = visibleActivity?.finishedAt ?? workflow?.finishedAt ?? null;
  const elapsed = formatElapsed((finishedAt ?? Date.now()) - startedAt);
  const title = visibleActivity
    ? visibleActivity.active
      ? t("agentStatus.running", { count: activeAgentCount || 1 })
      : visibleActivity.failed
        ? t("agentStatus.failed")
        : t("agentStatus.completed")
    : workflowActive
      ? t("agentStatus.workflowRunning")
      : t("agentStatus.workflowCompleted");

  return (
    <aside
      role="status"
      aria-live="polite"
      className={cn(
        "relative w-full min-w-0 rounded-md border border-border/70 bg-background/90",
        "transition-[border-color,background-color,border-radius] duration-200 ease-out",
        isChatActive && "border-accent/25 bg-accent/[0.025]",
        expanded && "rounded-b-none",
      )}
    >
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left hover:bg-foreground/5"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <StatusIcon status={visibleActivity?.agents[0]?.status ?? workflow?.status ?? "running"} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-foreground/50">{elapsed}</span>
        <IconChevronDown
          className={cn(
            "size-3.5 shrink-0 text-foreground/45 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="absolute top-[calc(100%-1px)] right-[-1px] z-50 max-h-[min(420px,55vh)] w-[calc(100%+2px)] overflow-y-auto rounded-b-md border border-border/70 bg-background/98 p-2 shadow-lg">
          <div className="space-y-1">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </div>

          {visibleWorkflow ? (
            <div className="mt-2 border-t border-border/50 pt-2">
              <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs">
                <IconCpu className="size-3.5 shrink-0 text-foreground/55" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t("agentStatus.workflow")}</p>
                  <p className="truncate text-foreground/50">
                    {visibleWorkflow.currentNodeId ?? visibleWorkflow.workflowId}
                  </p>
                </div>
                <span className="text-foreground/55">{statusLabel(visibleWorkflow.status, t)}</span>
              </div>
              {workflowActive ? (
                <div className="flex justify-end px-2 pb-1">
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => void api.workflows.cancelRun(visibleWorkflow.id)}
                  >
                    {t("workflow.widget.cancel")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function AgentRow({ agent }: { agent: AgentActivityItem }): React.JSX.Element {
  const { t } = useT();
  const elapsed = agent.startedAt
    ? formatElapsed((agent.finishedAt ?? Date.now()) - agent.startedAt)
    : null;
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-foreground/[0.035]">
      <StatusIcon status={agent.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{agent.name}</span>
          <span className="truncate font-mono text-[10px] text-foreground/40">{agent.path}</span>
        </div>
        {agent.summary ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-foreground/55">
            {agent.summary}
          </p>
        ) : null}
        {agent.error ? <p className="mt-0.5 text-[11px] text-danger">{agent.error}</p> : null}
      </div>
      <div className="shrink-0 text-right text-[10px] text-foreground/45">
        <p>{statusLabel(agent.status, t)}</p>
        {elapsed ? <p className="mt-0.5 tabular-nums">{elapsed}</p> : null}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "completed" || status === "succeeded") {
    return <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  }
  if (status === "failed") {
    return <IconCircleX className="mt-0.5 size-4 shrink-0 text-danger" />;
  }
  if (status === "interrupted" || status === "cancelled") {
    return <IconCircleDashed className="mt-0.5 size-4 shrink-0 text-foreground/45" />;
  }
  if (status === "waiting_approval") {
    return <IconBrain className="mt-0.5 size-4 shrink-0 animate-pulse text-warning" />;
  }
  return (
    <span className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
    </span>
  );
}

function isActiveAgentStatus(status: ActivityStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval";
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: string, t: ReturnType<typeof useT>["t"]): string {
  switch (status) {
    case "queued":
      return t("agentStatus.status.queued");
    case "running":
      return t("agentStatus.status.running");
    case "waiting_approval":
      return t("agentStatus.status.waitingApproval");
    case "waiting_handoff":
      return t("agentStatus.status.waitingHandoff");
    case "completed":
    case "succeeded":
      return t("agentStatus.status.completed");
    case "failed":
      return t("agentStatus.status.failed");
    case "interrupted":
    case "cancelled":
      return t("agentStatus.status.interrupted");
    default:
      return status;
  }
}
