/**
 * WorkflowStatusWidget
 *
 * Chat 页面右上方悬浮可折叠框，展示当前会话最近一次 workflow run 的状态：
 *  - 无活动 run（状态在 queued/running/waiting_approval/waiting_handoff 之一）→ 隐藏
 *  - 活动 run：默认展开一个紧凑摘要（短 id + 状态 + 当前节点 + 已耗时）
 *  - 终态 run：显示一个短暂徽标（5 秒后自动隐藏）
 *
 * 数据源：主进程 IPC `workflowRuns:activeForConversation`（按会话取最近一次 run）。
 * 轮询频率 1.5 秒，与原 WorkflowRunsPanel 一致。
 */

import { useEffect, useRef, useState } from "react";
import type { ActiveWorkflowRunSnapshot } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button } from "./ui";
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClose,
} from "./icons";
import { cn } from "../lib/utils";

interface WorkflowStatusWidgetProps {
  conversationId: string;
}

type Phase = "active" | "terminal" | "hidden";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_approval", "waiting_handoff"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TERMINAL_TOAST_MS = 5_000;
const POLL_INTERVAL_MS = 1_500;

/** 取 run 标识的短码（前 8 位）。 */
function shortRunId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** 简单格式化已耗时：< 60s 显示 s；>= 60s 显示 m:ss。 */
function formatElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function WorkflowStatusWidget({
  conversationId,
}: WorkflowStatusWidgetProps): React.JSX.Element | null {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<ActiveWorkflowRunSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0); // 触发 1s 一次的局部重渲染以更新"已耗时"
  const lastTerminalIdRef = useRef<string | null>(null);
  const terminalHideTimerRef = useRef<number | null>(null);

  // 轮询：拉取当前会话的最近一次 run
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async (): Promise<void> => {
      try {
        const next = await api.workflows.activeRunForConversation(conversationId);
        if (cancelled) return;
        setSnapshot(next);
      } catch (err) {
        // 静默：widget 是辅助展示，不应打扰用户
        console.error("[widget] failed to load active workflow run:", err);
      }
    };
    void tick();
    timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [conversationId]);

  // 1s 一次的局部 re-render（仅更新"已耗时"显示，不重新拉取）
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // 终态自动隐藏
  useEffect(() => {
    if (!snapshot) {
      lastTerminalIdRef.current = null;
      return;
    }
    if (TERMINAL_STATUSES.has(snapshot.status)) {
      // 仅在新进入终态时启动一次 5s 倒计时
      if (lastTerminalIdRef.current !== snapshot.id) {
        lastTerminalIdRef.current = snapshot.id;
        if (terminalHideTimerRef.current !== null) {
          window.clearTimeout(terminalHideTimerRef.current);
        }
        terminalHideTimerRef.current = window.setTimeout(() => {
          setSnapshot((current) =>
            current && current.id === snapshot.id && TERMINAL_STATUSES.has(current.status)
              ? null
              : current,
          );
        }, TERMINAL_TOAST_MS);
      }
    } else {
      lastTerminalIdRef.current = null;
      if (terminalHideTimerRef.current !== null) {
        window.clearTimeout(terminalHideTimerRef.current);
        terminalHideTimerRef.current = null;
      }
    }
    return () => {
      if (terminalHideTimerRef.current !== null) {
        window.clearTimeout(terminalHideTimerRef.current);
        terminalHideTimerRef.current = null;
      }
    };
  }, [snapshot]);

  if (!snapshot) return null;

  const isActive = ACTIVE_STATUSES.has(snapshot.status);
  const isTerminal = TERMINAL_STATUSES.has(snapshot.status);
  const phase: Phase = isActive ? "active" : isTerminal ? "terminal" : "hidden";
  if (phase === "hidden") return null;

  // 终态默认折叠；活动 run 默认展开
  const showExpanded = expanded || phase === "active";
  const elapsedMs = (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt;

  const handleCancel = (): void => {
    void api.workflows.cancelRun(snapshot.id).catch((err) => {
      console.error("[widget] failed to cancel workflow run:", err);
    });
  };

  const handleDismiss = (): void => {
    setSnapshot(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-phase={phase}
      className={cn(
        "pointer-events-auto fixed top-3 right-3 z-40 w-[300px] overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-lg backdrop-blur",
        "transition-[transform,opacity] duration-200 ease-out",
      )}
    >
      {/* 头部（始终可见，可折叠 + 关闭） */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-foreground/5"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={showExpanded}
      >
        <PhaseIcon phase={phase} status={snapshot.status} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {phase === "active"
            ? t("workflow.widget.active", { id: shortRunId(snapshot.id) })
            : t("workflow.widget.terminal", {
                id: shortRunId(snapshot.id),
                status: statusLabel(snapshot.status, t),
              })}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-foreground/50">
          {formatElapsed(elapsedMs)}
        </span>
        <IconChevronDown
          className={cn(
            "size-3.5 shrink-0 text-foreground/40 transition-transform",
            showExpanded && "rotate-180",
          )}
        />
      </button>

      {/* 详情区（折叠时隐藏） */}
      {showExpanded && (
        <div className="space-y-2 border-t border-border/40 px-3 py-2 text-xs text-foreground/70">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground/45">{t("workflow.widget.run")}</span>
            <span className="truncate font-mono text-[11px]">{snapshot.id}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground/45">{t("workflow.widget.workflow")}</span>
            <span className="truncate font-mono text-[11px]">{snapshot.workflowId}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground/45">{t("workflow.widget.status")}</span>
            <span className="font-medium text-foreground/80">
              {statusLabel(snapshot.status, t)}
            </span>
          </div>
          {snapshot.currentNodeId && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground/45">{t("workflow.widget.node")}</span>
              <span className="truncate font-mono text-[11px]">{snapshot.currentNodeId}</span>
            </div>
          )}

          {/* 操作区 */}
          <div className="flex items-center justify-end gap-1.5 pt-1">
            {phase === "active" && (
              <Button size="sm" variant="tertiary" onPress={handleCancel}>
                {t("workflow.widget.cancel")}
              </Button>
            )}
            <Button
              size="sm"
              isIconOnly
              variant="ghost"
              onPress={handleDismiss}
              aria-label={t("common.close")}
            >
              <IconClose className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseIcon({
  phase,
  status,
}: {
  phase: Phase;
  status: ActiveWorkflowRunSnapshot["status"];
}): React.JSX.Element {
  if (phase === "terminal") {
    if (status === "succeeded")
      return <IconCircleCheck className="size-4 shrink-0 text-emerald-500" />;
    if (status === "failed") return <IconCircleX className="size-4 shrink-0 text-rose-500" />;
    return <IconCircleDashed className="size-4 shrink-0 text-foreground/40" />;
  }
  // 活动：用一个旋转的圆环表示"正在跑"
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500" />
    </span>
  );
}

function statusLabel(
  status: ActiveWorkflowRunSnapshot["status"],
  t: (k: string) => string,
): string {
  switch (status) {
    case "succeeded":
      return t("workflow.status.succeeded");
    case "failed":
      return t("workflow.status.failed");
    case "cancelled":
      return t("workflow.status.cancelled");
    case "running":
      return t("workflow.status.running");
    case "queued":
      return t("workflow.status.queued");
    case "waiting_approval":
      return t("workflow.status.waitingApproval");
    case "waiting_handoff":
      return t("workflow.status.waitingHandoff");
    default:
      return status;
  }
}
