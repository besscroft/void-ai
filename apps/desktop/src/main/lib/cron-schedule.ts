import { Cron } from "croner";
import type { CronSchedule } from "../../shared/types";

export function nextRunForSchedule(schedule: CronSchedule, after: number): number | null {
  switch (schedule.kind) {
    case "once": {
      const at = Date.parse(schedule.at);
      return Number.isFinite(at) && at > after ? at : null;
    }
    case "interval": {
      const anchor = schedule.anchorAt ? Date.parse(schedule.anchorAt) : after;
      if (anchor > after) return anchor;
      return anchor + (Math.floor((after - anchor) / schedule.everyMs) + 1) * schedule.everyMs;
    }
    case "cron": {
      const cron = new Cron(schedule.expression, {
        timezone: schedule.timezone,
        paused: true,
        mode: "5-or-6-parts",
      });
      return cron.nextRun(new Date(after))?.getTime() ?? null;
    }
  }
}

export function normalizeCronSchedule(schedule: CronSchedule): CronSchedule {
  if (schedule.kind === "once") {
    const at = Date.parse(schedule.at);
    if (!Number.isFinite(at)) throw new Error("One-time schedule must contain a valid timestamp.");
    return { kind: "once", at: new Date(at).toISOString() };
  }
  if (schedule.kind === "interval") {
    if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < 1_000) {
      throw new Error("Interval must be at least one second.");
    }
    const anchorAt = schedule.anchorAt
      ? new Date(Date.parse(schedule.anchorAt)).toISOString()
      : undefined;
    return { kind: "interval", everyMs: schedule.everyMs, ...(anchorAt ? { anchorAt } : {}) };
  }
  if (!isTimeZone(schedule.timezone))
    throw new Error("Cron timezone must be a valid IANA timezone.");
  const expression = schedule.expression.trim();
  new Cron(expression, {
    timezone: schedule.timezone,
    paused: true,
    mode: "5-or-6-parts",
  });
  return { kind: "cron", expression, timezone: schedule.timezone };
}

export function isTransientCronError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    /\b(408|409|425|429|500|502|503|504)\b/.test(message) ||
    /timeout|timed out|temporar|rate limit|connection reset|network|fetch failed|econn/.test(
      message,
    )
  );
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
