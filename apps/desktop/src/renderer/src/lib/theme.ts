/**
 * 主题与外观辅助函数（纯函数，无 React 依赖）
 *
 * 由 lib/settings.tsx 的 SettingsProvider 调用，统一应用到 DOM。
 * 拆分为独立模块便于单测与复用，避免与 settings 上下文循环依赖。
 */

import {
  ACCENT_PRESETS,
  FONT_SIZE_PX,
  type ThemeMode,
  type FontSizeLevel,
  type LayoutDensity,
} from "@shared/types";

/** 实际生效的主题（system 会被解析为 light 或 dark） */
export type ResolvedTheme = "light" | "dark";

export type { ThemeMode };

/** 系统主题解析（matchMedia 在 Electron 渲染进程可用） */
export function resolveSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 将已解析的主题应用到 documentElement。
 * HeroUI v3 通过 [data-theme="dark"] 切换暗色；
 * 同时设置 class="dark" 兼容 Tailwind 的 dark: 变体。
 */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * 解析主题模式为实际值（system → light/dark）
 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? resolveSystemTheme() : mode;
}

/**
 * 应用强调色：覆盖 --color-accent / --color-accent-foreground。
 *
 * 支持两种输入：
 *  - 预设 id（如 "indigo"）：从 ACCENT_PRESETS 查找
 *  - 自定义 oklch/hex 字符串：直接作为主色，前景色推断为雪色
 */
export function applyAccent(accent: string): void {
  const preset = ACCENT_PRESETS.find((p) => p.id === accent);
  const value = preset?.value ?? accent;
  const foreground = preset?.foreground ?? "oklch(0.98 0.01 264)";
  const root = document.documentElement;
  root.style.setProperty("--color-accent", value);
  root.style.setProperty("--color-accent-foreground", foreground);
}

/**
 * 应用字号：设置根 font-size，影响所有 rem 单位（HeroUI 全局缩放）。
 */
export function applyFontSize(level: FontSizeLevel): void {
  const px = FONT_SIZE_PX[level] ?? FONT_SIZE_PX.base;
  document.documentElement.style.fontSize = `${px}px`;
}

/**
 * 应用界面密度：通过 data-density 属性 + Tailwind v4 --spacing 变量缩放间距。
 * compact 更紧凑，loose 更宽松。
 */
export function applyDensity(density: LayoutDensity): void {
  const root = document.documentElement;
  root.setAttribute("data-density", density);
  // Tailwind v4 的间距基准变量；适度缩放避免布局破坏
  const spacing = density === "compact" ? "0.22rem" : density === "loose" ? "0.3rem" : "0.25rem";
  root.style.setProperty("--spacing", spacing);
}
