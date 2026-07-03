import { useEffect, useState } from "react";
import {
  Button,
  ColorSwatchPicker,
  Description,
  Input,
  Label,
  parseColor,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { useT, LANGUAGE_OPTIONS } from "../lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconClose,
  IconKey,
  IconCheck,
  IconSun,
  IconMoon,
  IconMonitor,
  IconPalette,
  IconSliders,
  IconCpu,
  IconRotateCcw,
  IconDatabase,
  IconTrash,
} from "./icons";
import {
  ACCENT_PRESETS,
  FONT_SIZE_PX,
  THEME_PRESETS,
  type Conversation,
  type ProviderInfo,
  type ThemeMode,
  type ThemePresetId,
  type FontSizeLevel,
  type LayoutDensity,
  type LanguageMode,
} from "@shared/types";

interface SettingsDialogProps {
  /** 控制显隐 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/** Tab 定义 */
type TabId = "theme" | "system" | "model" | "apikey" | "trash";

/**
 * 设置弹窗（分 Tab 结构）
 *
 * 布局示意：
 * ┌──────────────────────────────────────────────┐
 * │ 设置                                     [✕] │
 * │────────────┬─────────────────────────────────│
 * │ 🎨 主题    │                                 │
 * │ ⚙️ 系统    │      <当前 Tab 内容>            │
 * │ 🤖 模型    │                                 │
 * │ 🔑 API Key │                                 │
 * │────────────│                                 │
 * │ ↺ 恢复默认  │                                 │
 * └────────────┴─────────────────────────────────┘
 *
 * 所有外观/模型设置即时应用并持久化（实时预览）；
 * 破坏性操作（重置、清缓存、删 Key）通过 ConfirmDialog 二次确认。
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.JSX.Element | null {
  const { t } = useT();
  const { settings, update, reset } = useSettings();
  const [tab, setTab] = useState<TabId>("theme");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleReset = (): void => {
    void notify
      .promise(reset(), {
        loading: t("toast.settings.resetting"),
        success: t("toast.settings.reset"),
        error: t("toast.settings.resetFailed"),
      })
      .then(() => {
        setResetDone(true);
        setTimeout(() => setResetDone(false), 2000);
      })
      .catch(() => undefined);
  };

  const tabs: { id: TabId; label: string; Icon: typeof IconPalette }[] = [
    { id: "theme", label: t("settings.tab.theme"), Icon: IconPalette },
    { id: "system", label: t("settings.tab.system"), Icon: IconSliders },
    { id: "model", label: t("settings.tab.model"), Icon: IconCpu },
    { id: "apikey", label: t("settings.tab.apiKey"), Icon: IconKey },
    { id: "trash", label: t("settings.tab.trash"), Icon: IconTrash },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="flex h-[calc(100vh-32px)] max-h-[672px] w-[calc(100vw-32px)] max-w-[768px] flex-col overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
          <h2 id="settings-title" className="text-lg font-semibold">
            {t("settings.title")}
          </h2>
          <button
            type="button"
            className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* 主体：导航 + 内容，窄屏纵向布局 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* 导航 */}
          <nav className="flex shrink-0 gap-1 border-b border-foreground/10 p-2 md:w-48 md:flex-col md:border-b-0 md:border-r">
            {tabs.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={[
                    "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm transition md:flex-none",
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/70 hover:bg-foreground/5",
                  ].join(" ")}
                  onClick={() => setTab(id)}
                  aria-pressed={active}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}

            {/* 恢复默认：仅侧栏模式下贴底 */}
            <button
              type="button"
              className="mt-auto hidden items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground/60 transition hover:bg-danger/10 hover:text-danger md:flex"
              onClick={() => setConfirmReset(true)}
            >
              <IconRotateCcw className="size-4 shrink-0" />
              {t("settings.reset.title")}
            </button>
          </nav>

          {/* 内容 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === "theme" && <ThemeTab settings={settings} update={update} />}
            {tab === "system" && <SystemTab settings={settings} update={update} />}
            {tab === "model" && <ModelTab settings={settings} update={update} />}
            {tab === "apikey" && <ApiKeyTab />}
            {tab === "trash" && <TrashTab />}

            {/* 窄屏下的恢复默认按钮 */}
            <div className="mt-6 border-t border-foreground/10 pt-4 md:hidden">
              <Button variant="tertiary" size="sm" onPress={() => setConfirmReset(true)}>
                <IconRotateCcw className="mr-1 size-3.5" />
                {t("settings.reset.title")}
              </Button>
              {resetDone && (
                <span className="ml-3 text-xs text-success">{t("settings.reset.done")}</span>
              )}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-foreground/10 px-6 py-3">
          <span className="text-xs text-success">{resetDone ? t("settings.reset.done") : ""}</span>
          <Button variant="secondary" onPress={onClose}>
            {t("common.done")}
          </Button>
        </div>
      </div>

      {/* 恢复默认确认 */}
      <ConfirmDialog
        open={confirmReset}
        title={t("settings.reset.title")}
        message={t("settings.reset.confirm")}
        danger
        confirmLabel={t("common.reset")}
        onConfirm={() => {
          setConfirmReset(false);
          handleReset();
        }}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

// ============================================================
// 通用小组件
// ============================================================

/** 设置项行：左侧标签 + 描述，右侧控件 */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {desc && <p className="mt-0.5 text-xs text-foreground/50">{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ============================================================
// 主题 Tab
// ============================================================

function ThemeTab({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  const modes: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
    { value: "light", label: t("shell.theme.light"), Icon: IconSun },
    { value: "dark", label: t("shell.theme.dark"), Icon: IconMoon },
    { value: "system", label: t("shell.theme.system"), Icon: IconMonitor },
  ];
  const preset = ACCENT_PRESETS.find((p) => p.id === settings.accentColor);
  const customHex = preset || settings.accentColor === "theme" ? "#4f46e5" : settings.accentColor;
  const selectedAccent = preset ? parseColor(preset.swatch) : undefined;

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium text-foreground/70">{t("theme.section.appearance")}</h3>

      <SettingRow title={t("theme.mode")} desc={t("theme.mode.desc")}>
        <ToggleButtonGroup
          selectionMode="single"
          disallowEmptySelection
          fullWidth
          size="sm"
          selectedKeys={[settings.theme]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            if (value === "light" || value === "dark" || value === "system") {
              void update({ theme: value });
            }
          }}
        >
          {modes.map(({ value, label, Icon }, index) => (
            <ToggleButton
              key={value}
              id={value}
              className="flex flex-1 items-center justify-center gap-2"
            >
              {index > 0 && <ToggleButtonGroup.Separator />}
              <Icon className="size-4" />
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingRow>

      <SettingRow title={t("theme.bundle")} desc={t("theme.bundle.desc")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_PRESETS.map((p) => {
            const active = settings.themePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={[
                  "flex min-h-20 flex-col justify-between rounded-md border p-3 text-left text-sm transition",
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-foreground/15 text-foreground/75 hover:bg-foreground/5",
                ].join(" ")}
                onClick={() => void update({ themePreset: p.id as ThemePresetId })}
                aria-pressed={active}
              >
                <span className="font-medium">{t(p.labelKey)}</span>
                <span className="mt-3 flex gap-1">
                  <span
                    className="h-5 flex-1 rounded border border-foreground/10"
                    style={{ backgroundColor: p.swatches.light }}
                  />
                  <span
                    className="h-5 flex-1 rounded border border-foreground/10"
                    style={{ backgroundColor: p.swatches.dark }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow title={t("theme.accent")} desc={t("theme.accent.desc")}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={[
              "rounded-md border px-3 py-2 text-sm transition",
              settings.accentColor === "theme"
                ? "border-accent bg-accent/10 text-accent"
                : "border-foreground/15 text-foreground/70 hover:bg-foreground/5",
            ].join(" ")}
            onClick={() => void update({ accentColor: "theme" })}
            aria-pressed={settings.accentColor === "theme"}
          >
            {t("theme.accent.theme")}
          </button>
        </div>

        <ColorSwatchPicker
          value={selectedAccent}
          onChange={(color) => {
            const hex = color.toString("hex").toLowerCase();
            const next = ACCENT_PRESETS.find((p) => p.swatch.toLowerCase() === hex);
            if (next) void update({ accentColor: next.id });
          }}
          size="lg"
          variant="circle"
          className="gap-3"
        >
          {ACCENT_PRESETS.map((p) => (
            <ColorSwatchPicker.Item key={p.id} color={p.swatch}>
              <ColorSwatchPicker.Swatch />
              <ColorSwatchPicker.Indicator />
              <span className="sr-only">{t("theme.accent." + p.id)}</span>
            </ColorSwatchPicker.Item>
          ))}
        </ColorSwatchPicker>

        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-foreground/60">
            <span>{t("theme.custom")}</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(customHex) ? customHex : "#4f46e5"}
              onChange={(e) => void update({ accentColor: e.target.value })}
              className="size-7 cursor-pointer rounded border border-foreground/15 bg-transparent"
              aria-label={t("theme.custom")}
            />
          </label>
        </div>
      </SettingRow>

      <SettingRow title={t("theme.preview")}>
        <div className="rounded-md border border-foreground/10 bg-background p-4">
          <div className="mb-3 flex items-center gap-2">
            <Button variant="primary" size="sm">
              {t("theme.preview.button")}
            </Button>
            <Button variant="secondary" size="sm">
              {t("common.cancel")}
            </Button>
            <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
              Tag
            </span>
          </div>
          <p className="text-sm text-foreground/70">{t("theme.preview.text")}</p>
        </div>
      </SettingRow>
    </section>
  );
}

// ============================================================
// System Tab
// ============================================================

function SystemTab({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  const fontLevels: FontSizeLevel[] = ["xs", "sm", "base", "lg", "xl"];
  const densities: { value: LayoutDensity; label: string }[] = [
    { value: "compact", label: t("system.density.compact") },
    { value: "comfortable", label: t("system.density.comfortable") },
    { value: "loose", label: t("system.density.loose") },
  ];

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium text-foreground/70">{t("settings.tab.system")}</h3>

      <SettingRow title={t("system.fontSize")} desc={t("system.fontSize.desc")}>
        <div className="flex gap-2">
          {fontLevels.map((lv) => {
            const active = settings.fontSize === lv;
            return (
              <button
                key={lv}
                type="button"
                className={[
                  "flex-1 rounded-md border px-2 py-2 text-center transition",
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-foreground/15 text-foreground/70 hover:bg-foreground/5",
                ].join(" ")}
                style={{ fontSize: String(FONT_SIZE_PX[lv]) + "px" }}
                onClick={() => void update({ fontSize: lv })}
                aria-pressed={active}
              >
                A
              </button>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow title={t("system.density")} desc={t("system.density.desc")}>
        <ToggleButtonGroup
          selectionMode="single"
          disallowEmptySelection
          fullWidth
          size="sm"
          selectedKeys={[settings.density]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            if (value === "compact" || value === "comfortable" || value === "loose") {
              void update({ density: value });
            }
          }}
        >
          {densities.map(({ value, label }, index) => (
            <ToggleButton key={value} id={value} className="flex flex-1 justify-center">
              {index > 0 && <ToggleButtonGroup.Separator />}
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingRow>

      <SettingRow title={t("system.language")} desc={t("system.language.desc")}>
        <ToggleButtonGroup
          selectionMode="single"
          disallowEmptySelection
          fullWidth
          size="sm"
          selectedKeys={[settings.language]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            if (value === "system" || value === "zh-CN" || value === "en") {
              void update({ language: value as LanguageMode });
            }
          }}
        >
          {LANGUAGE_OPTIONS.map((opt, index) => (
            <ToggleButton key={opt.value} id={opt.value} className="flex flex-1 justify-center">
              {index > 0 && <ToggleButtonGroup.Separator />}
              {t(opt.labelKey)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingRow>
    </section>
  );
}

// ============================================================
// 模型 Tab
// ============================================================

function ModelTab({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [cacheBytes, setCacheBytes] = useState<number>(0);
  const [cacheLimit, setCacheLimit] = useState<number>(settings.cacheSizeMb);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);

  const refreshCache = (): void => {
    void api.cache.stats().then((s) => {
      setCacheBytes(s.bytes);
      setCacheLimit(s.limitMb);
    });
  };

  useEffect(() => {
    void api.providers.list().then(setProviders);
    refreshCache();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClear = (): void => {
    setClearing(true);
    void notify
      .promise(api.cache.clear(), {
        loading: t("toast.cache.clearing"),
        success: t("toast.cache.cleared"),
        error: t("toast.cache.clearFailed"),
      })
      .then((remaining) => {
        setCacheBytes(remaining);
        setCleared(true);
        setTimeout(() => setCleared(false), 2000);
      })
      .finally(() => setClearing(false))
      .catch(() => undefined);
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium text-foreground/70">{t("settings.tab.model")}</h3>

      {/* 默认模型 */}
      <SettingRow title={t("model.default")} desc={t("model.default.desc")}>
        <select
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
          value={settings.selectedModel ?? ""}
          onChange={(e) => void update({ selectedModel: e.target.value || null })}
        >
          <option value="">{t("chat.selectModel")}</option>
          {providers.map((p) => (
            <optgroup key={p.id} label={p.label}>
              {p.models.map((m) => (
                <option key={m.id} value={`${p.id}/${m.id}`}>
                  {m.label ?? m.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </SettingRow>

      {/* 模型参数 */}
      <SettingRow title={t("model.params")} desc={t("model.params.desc")}>
        <div className="space-y-4">
          {/* 温度 */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-foreground/60">
                {t("model.temperature")} · {settings.modelTemperature.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={settings.modelTemperature}
              onChange={(e) => void update({ modelTemperature: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
              aria-label={t("model.temperature")}
            />
            <p className="mt-0.5 text-xs text-foreground/40">{t("model.temperature.hint")}</p>
          </div>

          {/* Top-P */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-foreground/60">
                {t("model.topP")} · {settings.modelTopP.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.modelTopP}
              onChange={(e) => void update({ modelTopP: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
              aria-label={t("model.topP")}
            />
            <p className="mt-0.5 text-xs text-foreground/40">{t("model.topP.hint")}</p>
          </div>

          {/* 最大输出长度 */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-foreground/60">
                {t("model.maxTokens")} · {settings.modelMaxTokens}
              </span>
            </div>
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={Math.min(settings.modelMaxTokens, 8192)}
              onChange={(e) => void update({ modelMaxTokens: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
              aria-label={t("model.maxTokens")}
            />
            <p className="mt-0.5 text-xs text-foreground/40">{t("model.maxTokens.hint")}</p>
          </div>
        </div>
      </SettingRow>

      {/* 缓存管理 */}
      <SettingRow title={t("model.cache")} desc={t("model.cache.desc")}>
        <div className="space-y-3">
          {/* 用量进度条 */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
              <span>
                {t("model.cache.used")}: {formatBytes(cacheBytes)}
              </span>
              <span>
                {t("model.cache.limit")}: {cacheLimit} MB
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.min(100, (cacheBytes / (cacheLimit * 1024 * 1024)) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* 缓存上限 */}
          <div>
            <div className="mb-1 text-xs text-foreground/60">
              {t("model.cache.size")} · {settings.cacheSizeMb} MB
            </div>
            <input
              type="range"
              min={50}
              max={4096}
              step={50}
              value={settings.cacheSizeMb}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCacheLimit(v);
                void update({ cacheSizeMb: v });
              }}
              className="w-full accent-[var(--color-accent)]"
              aria-label={t("model.cache.size")}
            />
          </div>

          {/* 清理按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              size="sm"
              onPress={() => setConfirmClear(true)}
              isDisabled={clearing || cacheBytes === 0}
            >
              <IconDatabase className="mr-1 size-3.5" />
              {clearing ? t("model.cache.clearing") : t("model.cache.clear")}
            </Button>
            {cleared && <span className="text-xs text-success">{t("model.cache.cleared")}</span>}
          </div>
        </div>
      </SettingRow>

      <ConfirmDialog
        open={confirmClear}
        title={t("model.cache.clear")}
        message={t("model.cache.confirm")}
        danger
        confirmLabel={t("common.clear")}
        onConfirm={() => {
          setConfirmClear(false);
          handleClear();
        }}
        onClose={() => setConfirmClear(false)}
      />
    </section>
  );
}

// ============================================================
// 回收站 Tab
// ============================================================

function TrashTab(): React.JSX.Element {
  const { t } = useT();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<Conversation | null>(null);

  const refresh = (): void => {
    setLoading(true);
    void api.conversations
      .purgeExpired()
      .then(() => api.conversations.listDeleted())
      .then(setItems)
      .catch((error) => notify.error(t("toast.trash.loadFailed"), error))
      .finally(() => setLoading(false))
      .catch(() => undefined);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleRestore = (conversation: Conversation): void => {
    void notify
      .promise(api.conversations.restore(conversation.id), {
        loading: t("toast.conversation.restoring"),
        success: t("toast.conversation.restored"),
        error: t("toast.conversation.restoreFailed"),
      })
      .then(refresh)
      .catch(() => undefined);
  };

  const handlePermanentDelete = (): void => {
    if (!pendingPermanentDelete) return;
    const id = pendingPermanentDelete.id;
    void notify
      .promise(api.conversations.permanentDelete(id), {
        loading: t("toast.conversation.permanentDeleting"),
        success: t("toast.conversation.permanentDeleted"),
        error: t("toast.conversation.permanentDeleteFailed"),
      })
      .then(refresh)
      .catch(() => undefined);
    setPendingPermanentDelete(null);
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground/70">
          <IconTrash className="size-4" />
          {t("trash.title")}
        </h3>
        <p className="mt-1 text-xs text-foreground/50">{t("trash.desc")}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/45">
          {loading ? t("chat.loadingHistory") : t("trash.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((conversation) => (
            <div key={conversation.id} className="rounded-md border border-foreground/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{conversation.title}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
                    <span>
                      {t("trash.deletedAt")}: {formatDate(conversation.deleted_at)}
                    </span>
                    <span>
                      {t("trash.purgeIn")}:{" "}
                      {formatRemaining(conversation.purge_after_at, t("trash.expired"))}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onPress={() => handleRestore(conversation)}>
                    {t("common.restore")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onPress={() => setPendingPermanentDelete(conversation)}
                  >
                    {t("common.permanentDelete")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingPermanentDelete}
        title={t("trash.permanent.title")}
        message={t("trash.permanent.confirm", { title: pendingPermanentDelete?.title ?? "" })}
        danger
        confirmLabel={t("common.permanentDelete")}
        onConfirm={handlePermanentDelete}
        onClose={() => setPendingPermanentDelete(null)}
      />
    </section>
  );
}

function formatDate(value: number | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRemaining(value: number | null, expiredLabel: string): string {
  if (!value) return "-";
  const remaining = value - Date.now();
  if (remaining <= 0) return expiredLabel;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.ceil((remaining % 86_400_000) / 3_600_000);
  if (days <= 0) return `${hours}h`;
  return `${days}d ${hours}h`;
}
// ============================================================
// API Key Tab
// ============================================================

function ApiKeyTab(): React.JSX.Element {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    void api.providers.list().then(setProviders);
  }, []);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground/70">
        <IconKey className="size-4" />
        {t("apikey.title")}
      </h3>
      <p className="text-xs text-foreground/50">{t("apikey.desc")}</p>
      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderKeyEditor key={p.id} provider={p} />
        ))}
      </div>
    </section>
  );
}

/**
 * 单个 Provider 的 API Key 编辑器
 */
function ProviderKeyEditor({ provider }: { provider: ProviderInfo }): React.JSX.Element {
  const { t } = useT();
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = (): void => {
    void api.apikeys.list().then((list) => {
      setHasKey(list.includes(provider.id));
    });
  };

  useEffect(() => {
    refresh();
  }, [provider.id]);

  const handleSave = (): void => {
    if (!value.trim()) return;
    setLoading(true);
    void notify
      .promise(api.apikeys.set(provider.id, value.trim()), {
        loading: t("toast.apikey.saving"),
        success: t("toast.apikey.saved"),
        error: t("toast.apikey.saveFailed"),
      })
      .then(() => {
        setHasKey(true);
        setValue("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .finally(() => setLoading(false))
      .catch(() => undefined);
  };

  const handleDelete = (): void => {
    setLoading(true);
    void notify
      .promise(api.apikeys.delete(provider.id), {
        loading: t("toast.apikey.clearing"),
        success: t("toast.apikey.cleared"),
        error: t("toast.apikey.clearFailed"),
      })
      .then(() => {
        setHasKey(false);
        setValue("");
      })
      .finally(() => setLoading(false))
      .catch(() => undefined);
  };

  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{provider.label}</span>
        {hasKey ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <IconCheck className="size-3" /> {t("apikey.configured")}
          </span>
        ) : (
          <span className="text-xs text-foreground/40">{t("apikey.notConfigured")}</span>
        )}
      </div>

      <TextField className="mb-3">
        <Label className="sr-only">{provider.label} API Key</Label>
        <Input
          type="password"
          placeholder={
            hasKey
              ? t("apikey.placeholder.replace")
              : t("apikey.placeholder.set", { label: provider.label })
          }
          value={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
          disabled={loading}
        />
        <Description className="mt-1">
          <a
            href={provider.helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            {t("apikey.getKey")}
          </a>
        </Description>
      </TextField>

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onPress={handleSave}
          isDisabled={!value.trim() || loading}
        >
          {saved ? t("common.saved") : t("common.save")}
        </Button>
        {hasKey && (
          <Button
            variant="tertiary"
            size="sm"
            onPress={() => setConfirmDelete(true)}
            isDisabled={loading}
          >
            {t("common.clear")}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("common.clear")}
        message={t("apikey.confirmDelete", { label: provider.label })}
        danger
        confirmLabel={t("common.clear")}
        onConfirm={() => {
          setConfirmDelete(false);
          handleDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
