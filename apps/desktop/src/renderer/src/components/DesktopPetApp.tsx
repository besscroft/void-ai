import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useReducedMotion } from "motion/react";
import type { DesktopPetSnapshot } from "@shared/types";
import { api } from "../lib/api";
import { AGENT_RUNTIME_STATUS_KEYS } from "../lib/agent-runtime-status";
import { useT } from "../lib/i18n";
import { animationForActivity, petFrameAt, type PetAnimationName } from "../lib/pet-animation";

type TransientState = "hover" | "drag-left" | "drag-right" | "drop" | null;

export function DesktopPetApp(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<DesktopPetSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.desktopPet.getSnapshot().then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };
    load();
    const interval = window.setInterval(load, 1_000);
    const unsubscribe = api.desktopPet.onSnapshotApplied((next) => {
      if (!cancelled) setSnapshot(next);
    });
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  if (!snapshot?.enabled || !snapshot.pet?.available) return null;
  return <DesktopPetView snapshot={snapshot} />;
}

function DesktopPetView({ snapshot }: { snapshot: DesktopPetSnapshot }): React.JSX.Element {
  const { t } = useT();
  const reducedMotion = Boolean(useReducedMotion());
  const [transient, setTransient] = useState<TransientState>(null);
  const [animationStartedAt, setAnimationStartedAt] = useState(Date.now());
  const [clock, setClock] = useState(Date.now());
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const rootRef = useRef<HTMLButtonElement>(null);
  const ignoreRef = useRef(true);
  const suppressClickRef = useRef(false);
  const dropTimerRef = useRef<number | null>(null);
  const dragRef = useRef({ pointerId: -1, screenX: 0, screenY: 0, distance: 0 });

  const semanticAnimation = animationForActivity(snapshot.activity.kind);
  const activeAnimation: PetAnimationName =
    transient === "hover"
      ? "waving"
      : transient === "drag-left"
        ? "running-left"
        : transient === "drag-right"
          ? "running-right"
          : transient === "drop"
            ? "jumping"
            : semanticAnimation;

  useEffect(() => {
    setAnimationStartedAt(Date.now());
  }, [activeAnimation, snapshot.pet?.selector]);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = window.setInterval(() => setClock(Date.now()), 80);
    return () => window.clearInterval(interval);
  }, [reducedMotion]);

  useEffect(() => {
    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      void api.desktopPet.showContextMenu();
    };
    window.addEventListener("contextmenu", onContext);
    return () => window.removeEventListener("contextmenu", onContext);
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent): void => {
      if (dragRef.current.pointerId !== -1) return;
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const onPet =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      const ignore = !onPet;
      if (ignore === ignoreRef.current) return;
      ignoreRef.current = ignore;
      void api.desktopPet.setIgnoreMouseEvents(ignore);
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  useEffect(() => {
    if (
      snapshot.pet?.formatVersion !== 2 ||
      snapshot.activity.kind !== "idle" ||
      transient ||
      reducedMotion
    ) {
      setLookDirection(null);
      return;
    }
    const sample = (): void => {
      void api.desktopPet.getLookDirection().then(setLookDirection);
    };
    sample();
    const interval = window.setInterval(sample, 125);
    return () => window.clearInterval(interval);
  }, [reducedMotion, snapshot.activity.kind, snapshot.pet?.formatVersion, transient]);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const dx = event.screenX - drag.screenX;
      const dy = event.screenY - drag.screenY;
      drag.screenX = event.screenX;
      drag.screenY = event.screenY;
      drag.distance += Math.abs(dx) + Math.abs(dy);
      if (dx !== 0 || dy !== 0) {
        setTransient(dx < 0 ? "drag-left" : "drag-right");
        void api.desktopPet.moveWindowBy({ dx, dy });
      }
    };
    const finish = (event: globalThis.PointerEvent): void => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const moved = drag.distance > 4;
      dragRef.current = { pointerId: -1, screenX: 0, screenY: 0, distance: 0 };
      if (!moved) {
        setTransient(null);
        return;
      }
      suppressClickRef.current = true;
      setTransient("drop");
      if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = window.setTimeout(() => {
        setTransient(null);
        suppressClickRef.current = false;
        dropTimerRef.current = null;
      }, 1_400);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
    };
  }, []);

  const frameIndex = useMemo(() => {
    if (
      snapshot.pet?.formatVersion === 2 &&
      snapshot.activity.kind === "idle" &&
      !transient &&
      !reducedMotion
    ) {
      return lookDirection === null ? 6 : 72 + lookDirection;
    }
    return petFrameAt(
      activeAnimation,
      clock - animationStartedAt,
      reducedMotion || snapshot.activity.kind === "sleeping",
      snapshot.pet?.animations,
    );
  }, [
    activeAnimation,
    animationStartedAt,
    clock,
    lookDirection,
    reducedMotion,
    snapshot.activity.kind,
    snapshot.pet?.animations,
    snapshot.pet?.formatVersion,
    transient,
  ]);

  const rows = snapshot.pet!.formatVersion === 2 ? 11 : 9;
  const column = frameIndex % 8;
  const row = Math.floor(frameIndex / 8);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || dragRef.current.pointerId !== -1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      distance: 0,
    };
    ignoreRef.current = false;
    void api.desktopPet.setIgnoreMouseEvents(false);
  };

  return (
    <button
      ref={rootRef}
      type="button"
      className={`desktop-pet-sprite-root absolute bottom-1 right-1 flex touch-none select-none flex-col items-center outline-none ${
        snapshot.activity.kind === "sleeping" ? "desktop-pet-is-sleeping" : ""
      }`}
      onPointerDown={pointerDown}
      onPointerEnter={() => {
        if (dragRef.current.pointerId === -1) setTransient("hover");
      }}
      onPointerLeave={() => {
        if (transient === "hover") setTransient(null);
      }}
      onClick={() => {
        if (suppressClickRef.current) return;
        void api.desktopPet.openMain(snapshot.activity.conversationId ?? undefined);
      }}
      aria-label={t("pets.openMain")}
    >
      <span
        className="desktop-pet-sprite block h-[104px] w-24 bg-no-repeat [image-rendering:pixelated]"
        style={{
          backgroundImage: `url(${snapshot.pet!.assetUrl})`,
          backgroundSize: `768px ${rows * 104}px`,
          backgroundPosition: `${-column * 96}px ${-row * 104}px`,
        }}
      />
      <span className="mt-[-2px] inline-flex max-w-40 items-center gap-1.5 rounded-md border border-foreground/10 bg-background/92 px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur">
        <span className={`pet-activity-dot pet-activity-${snapshot.activity.kind}`} />
        <span className="truncate">{activityLabel(snapshot.activity, t)}</span>
      </span>
    </button>
  );
}

function activityLabel(
  activity: DesktopPetSnapshot["activity"],
  t: (key: string) => string,
): string {
  if (activity.agentStatus) return t(AGENT_RUNTIME_STATUS_KEYS[activity.agentStatus]);
  return t(`pets.activity.${activity.kind}`);
}
