import type { DesktopPetAnimationSpec, DesktopPetActivityKind } from "@shared/types";

export type PetAnimationName =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

interface TimedFrame {
  index: number;
  durationMs: number;
}

const IDLE: TimedFrame[] = [
  [0, 1680],
  [1, 660],
  [2, 660],
  [3, 840],
  [4, 840],
  [5, 1920],
].map(([index, durationMs]) => ({ index, durationMs }));

const TRACKS: Record<
  Exclude<PetAnimationName, "idle">,
  { row: number; frames: number; duration: number; final: number }
> = {
  "running-right": { row: 1, frames: 8, duration: 120, final: 220 },
  "running-left": { row: 2, frames: 8, duration: 120, final: 220 },
  waving: { row: 3, frames: 4, duration: 140, final: 280 },
  jumping: { row: 4, frames: 5, duration: 140, final: 280 },
  failed: { row: 5, frames: 8, duration: 140, final: 240 },
  waiting: { row: 6, frames: 6, duration: 150, final: 260 },
  running: { row: 7, frames: 6, duration: 120, final: 220 },
  review: { row: 8, frames: 6, duration: 150, final: 280 },
};

export function animationForActivity(kind: DesktopPetActivityKind): PetAnimationName {
  if (kind === "running") return "running";
  if (kind === "needs_input") return "waiting";
  if (kind === "ready") return "review";
  if (kind === "blocked") return "failed";
  return "idle";
}

export function petFrameAt(
  name: PetAnimationName,
  elapsedMs: number,
  reducedMotion: boolean,
  customAnimations?: Record<string, DesktopPetAnimationSpec>,
): number {
  const custom = customAnimations?.[name] ?? customAnimations?.[legacyAnimationName(name)];
  if (custom) return customFrameAt(custom, elapsedMs, reducedMotion);
  if (reducedMotion) return name === "idle" ? (IDLE[0]?.index ?? 0) : TRACKS[name].row * 8;
  if (name === "idle") return timedFrameAt(IDLE, elapsedMs, true);
  return defaultStateFrameAt(name, elapsedMs);
}

function defaultStateFrameAt(name: Exclude<PetAnimationName, "idle">, elapsedMs: number): number {
  const track = TRACKS[name];
  const primary = Array.from({ length: track.frames }, (_, column) => ({
    index: track.row * 8 + column,
    durationMs: column === track.frames - 1 ? track.final : track.duration,
  }));
  const cycleDuration = primary.reduce((sum, frame) => sum + frame.durationMs, 0);
  const stateDuration = cycleDuration * 3;
  if (elapsedMs < stateDuration) return timedFrameAt(primary, elapsedMs, true);
  return timedFrameAt(IDLE, elapsedMs - stateDuration, true);
}

function customFrameAt(
  spec: DesktopPetAnimationSpec,
  elapsedMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || spec.frames.length <= 1 || spec.fps === 0) return spec.frames[0] ?? 0;
  const durationMs = 1000 / (spec.fps ?? 8);
  const frames = spec.frames.map((index) => ({ index, durationMs }));
  return timedFrameAt(frames, elapsedMs, spec.loop !== false);
}

function timedFrameAt(frames: TimedFrame[], elapsedMs: number, loop: boolean): number {
  if (frames.length === 0) return 0;
  const total = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  let remaining = loop
    ? Math.max(0, elapsedMs) % total
    : Math.min(Math.max(0, elapsedMs), total - 1);
  for (const frame of frames) {
    if (remaining < frame.durationMs) return frame.index;
    remaining -= frame.durationMs;
  }
  return frames.at(-1)?.index ?? 0;
}

function legacyAnimationName(name: PetAnimationName): string {
  if (name === "running-right") return "move_right";
  if (name === "running-left") return "move_left";
  if (name === "waving") return "wave";
  if (name === "jumping") return "bounce";
  if (name === "failed") return "sad";
  return name;
}
