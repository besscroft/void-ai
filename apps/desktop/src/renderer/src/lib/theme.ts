import {
  ACCENT_PRESETS,
  FONT_SIZE_PX,
  type AppSettings,
  type ThemeMode,
  type FontSizeLevel,
  type LayoutDensity,
  type ThemePresetId,
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

  if (accent === "theme") {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-foreground");
    return;
  }

  const preset = ACCENT_PRESETS.find((p) => p.id === accent);
  const value = preset?.value ?? accent;
  const foreground = preset?.foreground ?? "oklch(0.98 0.01 264)";
  root.style.setProperty("--accent", value);
  root.style.setProperty("--accent-foreground", foreground);
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
  settings: Pick<AppSettings, "theme" | "themePreset" | "accentColor" | "fontSize" | "density">,
): ResolvedTheme {
  const resolved = resolveTheme(settings.theme);
  applyResolvedTheme(resolved);
  applyThemePreset(settings.themePreset);
  applyAccent(settings.accentColor);
  applyFontSize(settings.fontSize);
  applyDensity(settings.density);
  return resolved;
}
