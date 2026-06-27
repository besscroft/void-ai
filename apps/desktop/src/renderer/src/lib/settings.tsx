/**
 * 应用设置上下文（单一数据源）
 *
 * 职责：
 *  - 启动时从 DB 一次性加载所有设置项（getAll）
 *  - 解析为 AppSettings，缺失/非法值回退到 DEFAULT_SETTINGS
 *  - 将外观（主题/强调色/字号/密度）实时应用到 DOM
 *  - 监听系统主题变化（仅 system 模式）
 *  - 暴露 update / reset，变更即持久化即应用
 *
 * 设计权衡：
 *  - 实时应用而非"应用/取消"模式：用户可立即看到效果，符合"实时预览"要求
 *  - 破坏性操作（重置/清缓存）由调用方通过确认弹窗保护
 */

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
import {
  SettingKey,
  DEFAULT_SETTINGS,
  ACCENT_PRESETS,
  type AppSettings,
  type ThemeMode,
  type FontSizeLevel,
  type LayoutDensity,
  type AppLanguage,
} from "@shared/types";
import {
  resolveTheme,
  resolveSystemTheme,
  applyResolvedTheme,
  applyAccent,
  applyFontSize,
  applyDensity,
  type ResolvedTheme,
} from "./theme";

/** 可被"恢复默认"重置的键（排除 ActiveConversationId 等会话状态） */
const RESETTABLE_KEYS: string[] = [
  SettingKey.Theme,
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

/** 需要从 DB 加载的所有键 */
const ALL_KEYS = [...RESETTABLE_KEYS, SettingKey.ActiveConversationId];

/** 解析字符串为受限枚举，非法时回退默认 */
function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** 解析数字，附带范围校验与回退 */
function parseNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 将 KV 字典解析为 AppSettings（带校验与回退）
 */
function parseSettings(map: Record<string, string | null>): AppSettings {
  const theme = parseEnum<ThemeMode>(
    map[SettingKey.Theme],
    ["light", "dark", "system"],
    DEFAULT_SETTINGS.theme,
  );
  const accentRaw = map[SettingKey.AccentColor];
  // 强调色：预设 id 或自定义颜色字符串；空值回退默认
  const accentColor =
    accentRaw &&
    (ACCENT_PRESETS.some((p) => p.id === accentRaw) ||
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
  const language = parseEnum<AppLanguage>(
    map[SettingKey.Language],
    ["zh-CN", "en"],
    DEFAULT_SETTINGS.language,
  );
  return {
    theme,
    accentColor,
    fontSize,
    density,
    language,
    selectedModel: map[SettingKey.SelectedModel] ?? null,
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
  /** 是否完成首次加载 */
  ready: boolean;
  settings: AppSettings;
  /** 当前生效（已解析）主题 */
  resolvedTheme: ResolvedTheme;
  /** 局部更新：立即持久化并应用 */
  update: (patch: Partial<AppSettings>) => Promise<void>;
  /** 重置所有可重置项为默认值 */
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * 将外观相关字段应用到 DOM
 */
function applyAppearance(s: AppSettings): void {
  const resolved = resolveTheme(s.theme);
  applyResolvedTheme(resolved);
  applyAccent(s.accentColor);
  applyFontSize(s.fontSize);
  applyDensity(s.density);
}

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveSystemTheme());

  // 首次加载：一次性读取所有键
  useEffect(() => {
    void (async () => {
      const map = await api.settings.getAll(ALL_KEYS);
      const parsed = parseSettings(map);
      setSettings(parsed);
      setReady(true);
    })();
  }, []);

  // 外观变更时重新应用
  useEffect(() => {
    if (!ready) return;
    const resolved = resolveTheme(settings.theme);
    setResolvedTheme(resolved);
    applyAppearance(settings);
  }, [settings, ready]);

  // 监听系统主题变化（仅 system 模式下需要重算 resolved）
  useEffect(() => {
    if (!ready || settings.theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      const next = resolveSystemTheme();
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [settings.theme, ready]);

  const persist = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const writes: Promise<unknown>[] = [];
    if (patch.theme !== undefined) writes.push(api.settings.set(SettingKey.Theme, patch.theme));
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
      // 乐观更新：先改 UI，再持久化；失败时回滚由下一次加载修正
      setSettings((prev) => ({ ...prev, ...patch }));
      await persist(patch);
    },
    [persist],
  );

  const reset = useCallback(async (): Promise<void> => {
    // 仅重置外观/模型相关字段，保留会话状态
    const resetPatch: AppSettings = {
      ...DEFAULT_SETTINGS,
      selectedModel: settings.selectedModel, // 保留已选模型，避免重置后无法对话
    };
    setSettings(resetPatch);
    const defaults: Record<string, string> = {
      [SettingKey.Theme]: DEFAULT_SETTINGS.theme,
      [SettingKey.AccentColor]: DEFAULT_SETTINGS.accentColor,
      [SettingKey.FontSize]: DEFAULT_SETTINGS.fontSize,
      [SettingKey.LayoutDensity]: DEFAULT_SETTINGS.density,
      [SettingKey.Language]: DEFAULT_SETTINGS.language,
      [SettingKey.ModelTemperature]: String(DEFAULT_SETTINGS.modelTemperature),
      [SettingKey.ModelMaxTokens]: String(DEFAULT_SETTINGS.modelMaxTokens),
      [SettingKey.ModelTopP]: String(DEFAULT_SETTINGS.modelTopP),
      [SettingKey.CacheSizeMb]: String(DEFAULT_SETTINGS.cacheSizeMb),
    };
    await Promise.all(Object.entries(defaults).map(([k, v]) => api.settings.set(k, v)));
  }, [settings.selectedModel]);

  const value = useMemo<SettingsContextValue>(
    () => ({ ready, settings, resolvedTheme, update, reset }),
    [ready, settings, resolvedTheme, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * 读取应用设置上下文。
 * 必须在 SettingsProvider 内使用。
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings 必须在 SettingsProvider 内调用");
  return ctx;
}
