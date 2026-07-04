import {
  ACCENT_PRESETS,
  FONT_SIZE_PX,
  type AppSettings,
  type ThemeMode,
  type FontSizeLevel,
  type LayoutDensity,
  type ThemePresetId,
  type ReduceMotion,
  type DiffMark,
} from "@shared/types";

export type ResolvedTheme = "light" | "dark";

export type { ThemeMode };

export function resolveSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? resolveSystemTheme() : mode;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

export function applyThemePreset(preset: ThemePresetId): void {
  document.documentElement.setAttribute("data-theme-preset", preset);
}

export function applyAccent(accent: string): void {
  const root = document.documentElement;
  root.style.removeProperty("--color-accent");
  root.style.removeProperty("--color-accent-foreground");
  // 兼容历史：HeroUI 早期主题使用 --accent，新主题使用 --color-accent
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-foreground");

  if (accent === "theme") {
    return;
  }

  const preset = ACCENT_PRESETS.find((p) => p.id === accent);
  const value = preset?.value ?? accent;
  const foreground = preset?.foreground ?? "oklch(0.98 0.01 264)";
  root.style.setProperty("--color-accent", value);
  root.style.setProperty("--color-accent-foreground", foreground);
  root.style.setProperty("--accent", value);
  root.style.setProperty("--accent-foreground", foreground);
}

/** 应用自定义背景/前景色；空字符串清除自定义值 */
export function applyCustomColors(background: string, foreground: string, contrast: number): void {
  const root = document.documentElement;
  // 对比度 0~100 映射到强调色明度微调
  // 50 = 不变；>50 提亮；<50 压暗
  const lightness = 0.5 + (contrast - 50) / 200; // [-0.25, 0.75]
  if (lightness === 0.5) {
    root.style.removeProperty("--color-accent-lightness-shift");
  } else {
    root.style.setProperty("--color-accent-lightness-shift", String(lightness));
  }

  if (background) {
    root.style.setProperty("--color-background", background);
  } else {
    root.style.removeProperty("--color-background");
  }
  if (foreground) {
    root.style.setProperty("--color-foreground", foreground);
  } else {
    root.style.removeProperty("--color-foreground");
  }
}

/** 应用 UI 字体与等宽字体；空字符串清除自定义 */
export function applyFonts(family: string, mono: string): void {
  const root = document.documentElement;
  if (family) {
    root.style.setProperty("--font-sans", family);
  } else {
    root.style.removeProperty("--font-sans");
  }
  if (mono) {
    root.style.setProperty("--font-mono", mono);
  } else {
    root.style.removeProperty("--font-mono");
  }
}

export function applyCodeFontSize(px: number): void {
  const safe = Number.isFinite(px) ? Math.min(24, Math.max(10, Math.round(px))) : 13;
  document.documentElement.style.setProperty("--code-font-size", safe + "px");
}

export function applyTranslucentSidebar(enabled: boolean): void {
  document.documentElement.setAttribute("data-translucent-sidebar", enabled ? "true" : "false");
}

export function applyPointerCursor(enabled: boolean): void {
  document.documentElement.setAttribute("data-pointer-cursor", enabled ? "true" : "false");
}

export function applyReduceMotion(value: ReduceMotion): void {
  document.documentElement.setAttribute("data-reduce-motion", value);
}

export function applyDiffMark(value: DiffMark): void {
  document.documentElement.setAttribute("data-diff-mark", value);
}

export function applyFontSize(level: FontSizeLevel): void {
  const px = FONT_SIZE_PX[level] ?? FONT_SIZE_PX.base;
  document.documentElement.style.fontSize = String(px) + "px";
}

export function applyDensity(density: LayoutDensity): void {
  const root = document.documentElement;
  root.setAttribute("data-density", density);
  const spacing = density === "compact" ? "0.22rem" : density === "loose" ? "0.3rem" : "0.25rem";
  root.style.setProperty("--spacing", spacing);
}

export function applyTheme(
  settings: Pick<
    AppSettings,
    | "theme"
    | "themePreset"
    | "accentColor"
    | "backgroundColor"
    | "foregroundColor"
    | "fontFamily"
    | "monoFontFamily"
    | "translucentSidebar"
    | "contrast"
    | "usePointerCursor"
    | "reduceMotion"
    | "codeFontSizePx"
    | "diffMark"
    | "fontSize"
    | "density"
  >,
): ResolvedTheme {
  const resolved = resolveTheme(settings.theme);
  applyResolvedTheme(resolved);
  applyThemePreset(settings.themePreset);
  applyAccent(settings.accentColor);
  applyCustomColors(settings.backgroundColor, settings.foregroundColor, settings.contrast);
  applyFonts(settings.fontFamily, settings.monoFontFamily);
  applyCodeFontSize(settings.codeFontSizePx);
  applyTranslucentSidebar(settings.translucentSidebar);
  applyPointerCursor(settings.usePointerCursor);
  applyReduceMotion(settings.reduceMotion);
  applyDiffMark(settings.diffMark);
  applyFontSize(settings.fontSize);
  applyDensity(settings.density);
  return resolved;
}
