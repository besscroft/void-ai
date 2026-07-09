import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopPetActivity, DesktopPetConfig, DesktopPetSnapshot } from "@shared/types";

/**
 * 桌宠交互状态机。
 *
 * activity 表示渲染层维护的"瞬时交互状态"，会与来自后端的 mood 组合显示。
 *  - hover     鼠标悬停在桌宠上
 *  - drag      正在拖动
 *  - interact  短暂的"互动"动画（双击触发）
 *  - sleep     无操作超过 autoSleepMs
 *  - hidden    桌宠被隐藏（此钩子不会被使用，仅供类型完整性）
 *  - idle      默认空闲
 *
 * 状态转换：
 *   idle ─[hover]→ hover ─[leave]→ idle
 *   idle ─[drag]→ drag ─[drop]→ interact ─[1.5s]→ idle
 *   idle ─[dblclick]→ interact ─[1.5s]→ idle
 *   idle ─[autoSleepMs]→ sleep ─[any interaction]→ idle
 */
export interface DesktopPetStateController {
  activity: DesktopPetActivity;
  /** 由 drag 结束或双击触发，进入 interact 一段时间后回到 idle */
  triggerInteract: (durationMs?: number) => void;
  setHover: (hover: boolean) => void;
  setDragging: (dragging: boolean) => void;
  /** 任意"有意义"的用户活动：重置 sleep 计时器 */
  notifyActivity: () => void;
  /** 由 main 进程发送的 configApplied 事件触发，更新 sleep 阈值等 */
  applyServerConfig: (config: DesktopPetConfig) => void;
}

interface UseDesktopPetStateOptions {
  snapshot: DesktopPetSnapshot | null;
}

const DEFAULT_AUTO_SLEEP_MS = 60_000;
const INTERACT_DURATION_MS = 1_500;

export function useDesktopPetState(options: UseDesktopPetStateOptions): DesktopPetStateController {
  const { snapshot } = options;
  const [activity, setActivity] = useState<DesktopPetActivity>("idle");
  const [autoSleepMs, setAutoSleepMs] = useState<number>(DEFAULT_AUTO_SLEEP_MS);

  const lastActivityAtRef = useRef<number>(Date.now());
  const interactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearInteractTimer = useCallback((): void => {
    if (interactTimerRef.current) {
      clearTimeout(interactTimerRef.current);
      interactTimerRef.current = null;
    }
  }, []);

  const triggerInteract = useCallback(
    (durationMs: number = INTERACT_DURATION_MS): void => {
      clearInteractTimer();
      setActivity("interact");
      interactTimerRef.current = setTimeout(() => {
        interactTimerRef.current = null;
        setActivity("idle");
        lastActivityAtRef.current = Date.now();
      }, durationMs);
    },
    [clearInteractTimer],
  );

  const setHover = useCallback((hover: boolean): void => {
    setActivity((current) => {
      // 拖动 / 互动 / 睡眠期间忽略 hover
      if (current === "drag" || current === "interact" || current === "sleep") return current;
      return hover ? "hover" : "idle";
    });
  }, []);

  const setDragging = useCallback(
    (dragging: boolean): void => {
      if (dragging) {
        clearInteractTimer();
        setActivity("drag");
      } else {
        setActivity("idle");
        lastActivityAtRef.current = Date.now();
      }
    },
    [clearInteractTimer],
  );

  const notifyActivity = useCallback((): void => {
    lastActivityAtRef.current = Date.now();
    setActivity((current) => (current === "sleep" ? "idle" : current));
  }, []);

  const applyServerConfig = useCallback((config: DesktopPetConfig): void => {
    setAutoSleepMs(config.interaction.autoSleepMs);
  }, []);

  // 同步后端 config
  useEffect(() => {
    if (snapshot) setAutoSleepMs(snapshot.config.interaction.autoSleepMs);
  }, [snapshot]);

  // 监听主进程实时推送的 config
  useEffect(() => {
    const handler = (config: DesktopPetConfig): void => {
      applyServerConfig(config);
    };
    // 渲染进程通过 preload 的 onConfigApplied 监听
    const unsubscribe = window.api?.desktopPet?.onConfigApplied?.(handler);
    return () => {
      unsubscribe?.();
    };
  }, [applyServerConfig]);

  // 自动睡眠检测 + 内存优化（sleep 状态降低帧率）
  useEffect(() => {
    if (sleepCheckTimerRef.current) clearInterval(sleepCheckTimerRef.current);
    if (autoSleepMs <= 0) return;
    sleepCheckTimerRef.current = setInterval(
      () => {
        const elapsed = Date.now() - lastActivityAtRef.current;
        if (elapsed >= autoSleepMs) {
          setActivity((current) => {
            if (current === "drag" || current === "interact") return current;
            return "sleep";
          });
        }
      },
      Math.max(5_000, Math.min(15_000, Math.floor(autoSleepMs / 4))),
    );
    return () => {
      if (sleepCheckTimerRef.current) {
        clearInterval(sleepCheckTimerRef.current);
        sleepCheckTimerRef.current = null;
      }
    };
  }, [autoSleepMs]);

  // 根据当前 activity 调用主进程 setFrameRate：sleep -> 1fps，其它 -> 60fps
  useEffect(() => {
    const targetFps = activity === "sleep" ? 1 : 60;
    try {
      void window.api?.desktopPet?.setFrameRate?.(targetFps);
    } catch (err) {
      // 主进程 IPC 可能在初始化时短暂不可用，忽略
      console.debug("[pet-state] setFrameRate failed:", err);
    }
  }, [activity]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      clearInteractTimer();
      if (sleepCheckTimerRef.current) clearInterval(sleepCheckTimerRef.current);
    };
  }, [clearInteractTimer]);

  return {
    activity,
    triggerInteract,
    setHover,
    setDragging,
    notifyActivity,
    applyServerConfig,
  };
}
