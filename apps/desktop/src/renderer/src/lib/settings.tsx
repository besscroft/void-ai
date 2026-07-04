import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { resolveLanguage } from "./i18n";
import {
  SettingKey,
  DEFAULT_SETTINGS,
  ACCENT_PRESETS,
  type AppSettings,
  type ThemeMode,
  type ThemePresetId,
  type FontSizeLevel,
  type LayoutDensity,
  type LanguageMode,
  type AppLanguage,
} from "@shared/types";
import { applyTheme, resolveSystemTheme, type ResolvedTheme } from "./theme";

const APP_SETTING_KEYS: string[] = [
  SettingKey.Theme,
  SettingKey.ThemePreset,
  SettingKey.AccentColor,
  SettingKey.FontSize,
  SettingKey.LayoutDensity,
  SettingKey.Language,
  SettingKey.SelectedModel,
  SettingKey.ModelTemperature,
  SettingKey.ModelMaxTokens,
  SettingKey.ModelTopP,
  SettingKey.CacheSizeMb,
];

const ALL_KEYS = [...APP_SETTING_KEYS, SettingKey.ActiveConversationId];

export type SettingsResetScope = "theme" | "system";

const RESET_PATCHES: Record<SettingsResetScope, Partial<AppSettings>> = {
  theme: {
    theme: DEFAULT_SETTINGS.theme,
    themePreset: DEFAULT_SETTINGS.themePreset,
    accentColor: DEFAULT_SETTINGS.accentColor,
  },
  system: {
    fontSize: DEFAULT_SETTINGS.fontSize,
    density: DEFAULT_SETTINGS.density,
    language: DEFAULT_SETTINGS.language,
  },
};

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parseNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getBrowserLocale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
}

export function parseSettings(map: Record<string, string | null>): AppSettings {
  const theme = parseEnum<ThemeMode>(
    map[SettingKey.Theme],
    ["light", "dark", "system"],
    DEFAULT_SETTINGS.theme,
  );
  const themePreset = parseEnum<ThemePresetId>(
    map[SettingKey.ThemePreset],
    ["default", "ocean", "forest", "rose"],
    DEFAULT_SETTINGS.themePreset,
  );
  const accentRaw = map[SettingKey.AccentColor];
  const accentColor =
    accentRaw &&
    (accentRaw === "theme" ||
      ACCENT_PRESETS.some((p) => p.id === accentRaw) ||
      accentRaw.startsWith("oklch") ||
      accentRaw.startsWith("#"))
      ? accentRaw
      : DEFAULT_SETTINGS.accentColor;
  const fontSize = parseEnum<FontSizeLevel>(
    map[SettingKey.FontSize],
    ["xs", "sm", "base", "lg", "xl"],
    DEFAULT_SETTINGS.fontSize,
  );
  const density = parseEnum<LayoutDensity>(
    map[SettingKey.LayoutDensity],
    ["compact", "comfortable", "loose"],
    DEFAULT_SETTINGS.density,
  );
  const language = parseEnum<LanguageMode>(
    map[SettingKey.Language],
    ["system", "zh-CN", "en"],
    DEFAULT_SETTINGS.language,
  );
  return {
    theme,
    themePreset,
    accentColor,
    fontSize,
    density,
    language,
    selectedModel: map[SettingKey.SelectedModel] || null,
    modelTemperature: parseNumber(
      map[SettingKey.ModelTemperature],
      DEFAULT_SETTINGS.modelTemperature,
      0,
      2,
    ),
    modelMaxTokens: parseNumber(
      map[SettingKey.ModelMaxTokens],
      DEFAULT_SETTINGS.modelMaxTokens,
      1,
      32768,
    ),
    modelTopP: parseNumber(map[SettingKey.ModelTopP], DEFAULT_SETTINGS.modelTopP, 0, 1),
    cacheSizeMb: parseNumber(map[SettingKey.CacheSizeMb], DEFAULT_SETTINGS.cacheSizeMb, 50, 4096),
  };
}

interface SettingsContextValue {
  ready: boolean;
  settings: AppSettings;
  systemLocale: string;
  resolvedLanguage: AppLanguage;
  resolvedTheme: ResolvedTheme;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  reset: (scope: SettingsResetScope) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyAppearance(s: AppSettings): ResolvedTheme {
  return applyTheme(s);
}

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const initialLocale = getBrowserLocale();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [systemLocale, setSystemLocale] = useState(initialLocale);
  const [resolvedLanguage, setResolvedLanguage] = useState<AppLanguage>(() =>
    resolveLanguage(DEFAULT_SETTINGS.language, initialLocale),
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveSystemTheme());

  useEffect(() => {
    void (async () => {
      const [map, locale] = await Promise.all([
        api.settings.getAll(ALL_KEYS),
        api.system.locale().catch(() => getBrowserLocale()),
      ]);
      const nextLocale = locale || getBrowserLocale();
      const parsed = parseSettings(map);
      setSystemLocale(nextLocale);
      setSettings(parsed);
      setResolvedLanguage(resolveLanguage(parsed.language, nextLocale));
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    setResolvedTheme(applyAppearance(settings));
  }, [settings]);

  useEffect(() => {
    setResolvedLanguage(resolveLanguage(settings.language, systemLocale));
  }, [settings.language, systemLocale]);

  useEffect(() => {
    if (!ready || settings.theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      const next = applyAppearance(settings);
      setResolvedTheme(next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [settings, ready]);

  const persist = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const writes: Promise<unknown>[] = [];
    if (patch.theme !== undefined) writes.push(api.settings.set(SettingKey.Theme, patch.theme));
    if (patch.themePreset !== undefined)
      writes.push(api.settings.set(SettingKey.ThemePreset, patch.themePreset));
    if (patch.accentColor !== undefined)
      writes.push(api.settings.set(SettingKey.AccentColor, patch.accentColor));
    if (patch.fontSize !== undefined)
      writes.push(api.settings.set(SettingKey.FontSize, patch.fontSize));
    if (patch.density !== undefined)
      writes.push(api.settings.set(SettingKey.LayoutDensity, patch.density));
    if (patch.language !== undefined)
      writes.push(api.settings.set(SettingKey.Language, patch.language));
    if (patch.selectedModel !== undefined)
      writes.push(api.settings.set(SettingKey.SelectedModel, patch.selectedModel ?? ""));
    if (patch.modelTemperature !== undefined)
      writes.push(api.settings.set(SettingKey.ModelTemperature, String(patch.modelTemperature)));
    if (patch.modelMaxTokens !== undefined)
      writes.push(api.settings.set(SettingKey.ModelMaxTokens, String(patch.modelMaxTokens)));
    if (patch.modelTopP !== undefined)
      writes.push(api.settings.set(SettingKey.ModelTopP, String(patch.modelTopP)));
    if (patch.cacheSizeMb !== undefined)
      writes.push(api.settings.set(SettingKey.CacheSizeMb, String(patch.cacheSizeMb)));
    await Promise.all(writes);
  }, []);

  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      setSettings((prev) => ({ ...prev, ...patch }));
      await persist(patch);
    },
    [persist],
  );

  const reset = useCallback(
    async (scope: SettingsResetScope): Promise<void> => {
      const patch = RESET_PATCHES[scope];
      setSettings((prev) => ({ ...prev, ...patch }));
      await persist(patch);
    },
    [persist],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      ready,
      settings,
      systemLocale,
      resolvedLanguage,
      resolvedTheme,
      update,
      reset,
    }),
    [ready, settings, systemLocale, resolvedLanguage, resolvedTheme, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
