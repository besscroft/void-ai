import {
  FONT_SIZE_PX,
  STYLE_PRESETS,
  type AppSettings,
  type ThemeMode,
  type FontSizeLevel,
  type LayoutDensity,
  type ThemePresetId,
  type StylePresetId,
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

/** 应用视觉风格：注入字体栈与全局圆角。
 * 注入 --style-radius 和 --style-font-stack，由 main.css 桥接到 --radius / --app-font-sans。
 * 用户在"字体"选择器里设的值会 inline 写到 --app-font-sans，CSS 级联下用户值优先。*/
export function applyStyle(style: StylePresetId): void {
  const root = document.documentElement;
  const preset = STYLE_PRESETS.find((p) => p.id === style) ?? STYLE_PRESETS[0];
  root.setAttribute("data-style", preset.id);
  root.style.setProperty("--style-radius", `${preset.radius}px`);
  root.style.setProperty("--style-font-stack", preset.fontStack);
}

/** 应用 UI 字体与等宽字体；空字符串清除自定义。 */
export function applyFonts(family: string, mono: string): void {
  const root = document.documentElement;
  if (family) {
    root.style.setProperty("--app-font-sans", family);
    root.style.setProperty("--font-sans", family);
  } else {
    root.style.removeProperty("--app-font-sans");
    root.style.removeProperty("--font-sans");
  }
  if (mono) {
    root.style.setProperty("--app-font-mono", mono);
    root.style.setProperty("--font-mono", mono);
  } else {
    root.style.removeProperty("--app-font-mono");
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
    | "style"
    | "fontFamily"
    | "monoFontFamily"
    | "translucentSidebar"
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
  applyStyle(settings.style);
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
