import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import {
  DEFAULT_DESKTOP_PET_WINDOW,
  type DesktopPetMood,
  type DesktopPetSnapshot,
  type LocalServerInfo,
} from "@shared/types";
import { useDesktopPetState } from "../lib/useDesktopPetState";
import { PetSoundPlayer } from "../lib/pet-sound";

/**
 * 桌宠根组件。
 *
 * 关键设计：
 *  - BrowserWindow 物理 bounds 永远 = DEFAULT_DESKTOP_PET_WINDOW（128×128），
 *    不会再被 setWindowBy / setSize 改成 280×360，避免整块大框挡到其它 app。
 *  - 渲染层只放"球 + 状态文字"两样东西，按内容 size 渲染，hit area = 视觉 area。
 *  - 历史的"原地展开 chat overlay"功能被移除——它会让 BrowserWindow 临时变
 *    280×360，与"bounds 永远 = 桌宠大小"冲突。点击球现在改为调
 *    `openConversation` IPC 打开主窗口（**后续**会换成一个独立 BrowserWindow
 *    承载 chat 浮层，但那是另一个窗口，不影响桌宠 bounds）。
 *  - 拖动 / 状态机 / 音效保持不变。
 */
export function DesktopPetApp(): React.JSX.Element {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<DesktopPetSnapshot | null>(null);
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.desktopPet.getSnapshot().then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };
    load();
    void api.server.info().then((info) => {
      if (!cancelled) setServerInfo(info);
    });
    const id = window.setInterval(load, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!snapshot || !serverInfo) {
    return (
      <div className="flex h-full items-center justify-center bg-transparent text-xs text-foreground/55">
        {t("common.loading")}
      </div>
    );
  }

  return <DesktopPetView snapshot={snapshot} />;
}

function DesktopPetView({ snapshot }: { snapshot: DesktopPetSnapshot }): React.JSX.Element {
  const { t } = useT();

  // 状态机 + 音效
  const state = useDesktopPetState({ snapshot });
  const soundRef = useRef<PetSoundPlayer | null>(null);
  if (!soundRef.current) soundRef.current = new PetSoundPlayer();
  useEffect(() => {
    soundRef.current?.setMuted(!snapshot.config.interaction.soundEnabled);
  }, [snapshot.config.interaction.soundEnabled]);
  useEffect(() => {
    return () => {
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  // 拖动状态：用 ref 记录 + 抑制 click
  // 关键：用 lastScreenX/Y 跟踪鼠标的"上一次物理位置"（不是 movementX/Y），
  // 原因见 desktop-pet-window.ts 旧实现：贴边时 screenX 不会越界，movementX 会。
  const dragRef = useRef({
    pointerId: -1,
    lastScreenX: 0,
    lastScreenY: 0,
    totalX: 0,
    totalY: 0,
    moved: false,
    startTime: 0,
  });
  const suppressClickRef = useRef(false);
  const lastClickAtRef = useRef(0);

  // 点击穿透动态切换：rootRef 用于 hit-test 鼠标是否在球上，
  // ignoreRef 缓存当前 ignore 状态避免高频 IPC。
  const rootRef = useRef<HTMLDivElement>(null);
  const ignoreRef = useRef(true);

  // mount 时强制把 BrowserWindow 收回到 DEFAULT（128×128），
  // 兜底任何 db 残留或外部写入导致的大尺寸。
  useEffect(() => {
    void api.desktopPet.setWindowSize({
      width: DEFAULT_DESKTOP_PET_WINDOW.width,
      height: DEFAULT_DESKTOP_PET_WINDOW.height,
    });
  }, []);

  // 右键菜单：window 上 contextmenu → 通知 main 弹原生菜单
  useEffect(() => {
    const onContext = (e: globalThis.MouseEvent): void => {
      e.preventDefault();
      void api.desktopPet.showContextMenu();
    };
    window.addEventListener("contextmenu", onContext);
    return () => window.removeEventListener("contextmenu", onContext);
  }, []);

  // 点击穿透核心：监听 mousemove（main 端 setIgnoreMouseEvents(true,{forward:true})
  // 会把 mousemove 转发给渲染层），实时判断鼠标是否落在球的可视区内：
  //   - 在球上 → setIgnoreMouseEvents(false)，球可拖动/点击/hover
  //   - 不在球上 → setIgnoreMouseEvents(true)，透明区域点击穿透到底下 app
  // 拖动期间：强制保持 ignore=false。不在这里 setIgnoreMouseEvents(true)，
  // 否则异步 IPC 会在拖动进行中把 pointermove 截断，导致窗口不跟手。
  // 拖动结束后也不主动设 true——交给下一条 mousemove 自动判断鼠标位置。
  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent): void => {
      // 拖动期间：确保 ignore=false，防止竞态导致 pointermove 丢失
      if (dragRef.current.pointerId !== -1) {
        if (ignoreRef.current !== false) {
          ignoreRef.current = false;
          void api.desktopPet.setIgnoreMouseEvents(false);
        }
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const onPet =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      const next = !onPet;
      if (next === ignoreRef.current) return; // 状态未变，跳过 IPC
      ignoreRef.current = next;
      void api.desktopPet.setIgnoreMouseEvents(next);
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  // 全局 window pointer 监听：处理 move / up / cancel
  useEffect(() => {
    type NativePointerEvent = globalThis.PointerEvent;

    const handleMove = (event: NativePointerEvent): void => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const dx = event.screenX - drag.lastScreenX;
      const dy = event.screenY - drag.lastScreenY;
      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      if (dx === 0 && dy === 0) return;
      drag.totalX += dx;
      drag.totalY += dy;
      if (Math.abs(drag.totalX) + Math.abs(drag.totalY) > 4) drag.moved = true;
      void api.desktopPet.moveWindowBy({ dx, dy });
    };

    const finishDrag = (event: NativePointerEvent): void => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const wasDragging = drag.moved;
      dragRef.current = {
        pointerId: -1,
        lastScreenX: 0,
        lastScreenY: 0,
        totalX: 0,
        totalY: 0,
        moved: false,
        startTime: 0,
      };
      state.setDragging(false);
      if (wasDragging) {
        suppressClickRef.current = true;
        soundRef.current?.play("drop");
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      // 不在这里设 setIgnoreMouseEvents(true)：异步 IPC 可能延迟到达，
      // 在用户连续拖动时把 ignore 翻回 true，导致 pointermove 丢失、
      // 窗口不跟手。改由上面 mousemove 监听器自动判断鼠标位置。
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [state]);

  const handleRootPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    if (dragRef.current.pointerId !== -1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      totalX: 0,
      totalY: 0,
      moved: false,
      startTime: Date.now(),
    };
    state.setDragging(true);
    state.notifyActivity();
    // 不在这里调 setIgnoreMouseEvents(false)：用户能点击球说明 ignore
    // 已经是 false（mousemove 监听器在鼠标进入球时设的）。异步 IPC
    // 反而可能和 moveWindowBy 交叉，引入竞态。拖动期间 ignore 状态
    // 由 mousemove 监听器负责保持 false。
  };

  const handlePetClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (suppressClickRef.current) {
      event.preventDefault();
      return;
    }
    state.notifyActivity();
    const now = Date.now();
    const delta = now - lastClickAtRef.current;
    lastClickAtRef.current = now;
    // 250ms 内的两次 click 视为双击
    if (delta > 0 && delta < 280) {
      lastClickAtRef.current = 0;
      state.triggerInteract(1_400);
      soundRef.current?.play("happy");
      return;
    }
    soundRef.current?.play("click");
    // 单击 → 通知主进程打开主窗口（**临时**方案，后续会替换为独立 chat overlay
    // BrowserWindow——但那也是另一个窗口，不影响桌宠 bounds）。
    void api.desktopPet.openMain(snapshot.config.conversationId ?? undefined);
  };

  const handlePetEnter = (): void => {
    state.setHover(true);
    state.notifyActivity();
    soundRef.current?.play("hover");
  };

  const handlePetLeave = (): void => {
    state.setHover(false);
  };

  // mood：桌宠无 chat overlay 后，mood 只由后端 snapshot.mood / activity 决定
  const baseMood: DesktopPetMood = snapshot.mood;
  const statusText = activityStatusLabel(t, baseMood, state.activity);

  const petStyle: React.CSSProperties = {
    ["--pet-scale" as string]: String(snapshot.config.window.scale),
  };

  return (
    // 关键：root 容器用 absolute 定位在 BrowserWindow 右下角，**不**强制
    // h-full / w-full。这样 root 的 layout 盒子大小 = 实际内容大小（球 + 状态条），
    // 而不是整个 BrowserWindow bounds。结合 main.css 里 body / #root 的
    // pointer-events: none，hit area = 视觉 area，透明区域不挡其它 app。
    <div
      ref={rootRef}
      className={`desktop-pet-root absolute bottom-0 right-0 flex flex-col items-center gap-1 bg-transparent p-1 text-foreground desktop-pet-activity-${state.activity}`}
      style={petStyle}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handleRootPointerDown}
    >
      <button
        type="button"
        className={`mx-auto flex touch-none select-none flex-col items-center gap-1 outline-none ${
          state.activity === "drag" ? "cursor-grabbing" : "cursor-grab"
        }`}
        onClick={handlePetClick}
        onPointerEnter={handlePetEnter}
        onPointerLeave={handlePetLeave}
        aria-label={t("desktopPet.toggle")}
      >
        <span className={`desktop-pet-orb desktop-pet-mood-${baseMood}`}>
          <span className="desktop-pet-orb-glow" />
          <span className="relative z-10 text-2xl font-semibold">
            {snapshot.agent?.avatar ?? "V"}
          </span>
          {state.activity === "interact" ? <span className="desktop-pet-burst">✨</span> : null}
          {state.activity === "sleep" ? <span className="desktop-pet-zzz">Zzz</span> : null}
        </span>
        <span className="rounded-full border border-foreground/10 bg-background/75 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur">
          {snapshot.agent?.name ?? "Void"} · {statusText}
        </span>
      </button>
    </div>
  );
}

function activityStatusLabel(
  t: (key: string) => string,
  baseMood: DesktopPetMood,
  activity: string,
): string {
  if (activity === "sleep") return t("desktopPet.status.sleep");
  if (activity === "interact") return t("desktopPet.status.happy");
  if (baseMood === "thinking") return t("desktopPet.status.thinking");
  if (baseMood === "working") return t("desktopPet.status.working");
  if (baseMood === "learning") return t("desktopPet.status.learning");
  if (baseMood === "error") return t("desktopPet.status.error");
  return t("desktopPet.status.idle");
}
