import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { SettingKey } from "@shared/types";

/** 主题模式枚举 */
export type ThemeMode = "light" | "dark" | "system";

/** 实际生效的主题（system 会被解析为 light 或 dark） */
export type ResolvedTheme = "light" | "dark";

/** 主题持久化键名 */
const THEME_KEY = SettingKey.Theme;

/**
 * 解析 system 主题为实际值
 */
function resolveSystemTheme(): ResolvedTheme {
  // matchMedia 在 Electron 渲染进程中可用
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 将主题应用到 documentElement
 * HeroUI v3 通过 [data-theme="dark"] 切换暗色
 */
function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // 同时设置 class="dark" 以兼容 Tailwind 的 dark: 变体
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * 主题 Hook：管理主题状态、持久化、system 模式监听
 */
export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => Promise<void>;
  toggle: () => Promise<void>;
} {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveSystemTheme());

  // 启动时从设置加载
  useEffect(() => {
    void (async () => {
      const stored = (await api.settings.get(THEME_KEY)) as ThemeMode | null;
      if (stored && ["light", "dark", "system"].includes(stored)) {
        setModeState(stored);
      }
    })();
  }, []);

  // 当 mode 或 system 主题变化时，重新计算并应用
  useEffect(() => {
    const next: ResolvedTheme = mode === "system" ? resolveSystemTheme() : mode;
    setResolved(next);
    applyTheme(next);
  }, [mode]);

  // 监听系统主题变化（仅 system 模式下生效）
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      const next = resolveSystemTheme();
      setResolved(next);
      applyTheme(next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  const setMode = useCallback(async (m: ThemeMode): Promise<void> => {
    setModeState(m);
    await api.settings.set(THEME_KEY, m);
  }, []);

  const toggle = useCallback(async (): Promise<void> => {
    const next: ThemeMode = resolved === "dark" ? "light" : "dark";
    await setMode(next);
  }, [resolved, setMode]);

  return { mode, resolved, setMode, toggle };
}
