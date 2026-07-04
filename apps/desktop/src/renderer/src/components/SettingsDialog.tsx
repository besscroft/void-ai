import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ColorSwatchPicker,
  Description,
  Input,
  Label,
  Modal,
  parseColor,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useSettings, type SettingsResetScope } from "../lib/settings";
import { useT, LANGUAGE_OPTIONS } from "../lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconClose,
  IconKey,
  IconCheck,
  IconPalette,
  IconCpu,
  IconRotateCcw,
  IconDatabase,
  IconTrash,
  IconPlus,
} from "./icons";
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  FONT_SIZE_PX,
  MONO_FONT_PRESETS,
  THEME_PRESETS,
  type Conversation,
  type CustomProviderInput,
  type FontPreset,
  type ManagedModelInfo,
  type ProviderInfo,
  type ThemeMode,
  type ThemePresetId,
  type FontSizeLevel,
  type LayoutDensity,
  type LanguageMode,
  type ReduceMotion,
  type DiffMark,
} from "@shared/types";

interface SettingsDialogProps {
  /** 控制显隐 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/** Tab 定义 */
type TabId = "appearance" | "model" | "trash";

/**
 * 设置弹窗（分 Tab 结构）
 *
 * 布局示意：
 * ┌──────────────────────────────────────────────┐
 * │ 设置                                     [✕] │
 * │────────────┬─────────────────────────────────│
 * │ 🎨 外观    │                                 │
 * │ 🤖 模型    │      <当前 Tab 内容>            │
 * │ 🗑 回收站  │                                 │
 * └────────────┴─────────────────────────────────┘
 *
 * 所有外观/模型设置即时应用并持久化（实时预览）；
 * 破坏性操作（重置、清缓存、删 Key）通过 ConfirmDialog 二次确认。
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.JSX.Element | null {
  const { t } = useT();
  const { settings, update, reset } = useSettings();
  const [tab, setTab] = useState<TabId>("appearance");
  const [confirmResetScope, setConfirmResetScope] = useState<SettingsResetScope | null>(null);
  const [resetDoneScope, setResetDoneScope] = useState<SettingsResetScope | null>(null);

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

  const resetScopeLabel = (scope: SettingsResetScope): string =>
    scope === "appearance" ? t("settings.reset.appearance") : t("settings.reset.title");

  const handleReset = (scope: SettingsResetScope): void => {
    const scopeLabel = resetScopeLabel(scope);
    void notify
      .promise(reset(scope), {
        loading: t("toast.settings.resettingScope", { scope: scopeLabel }),
        success: t("toast.settings.resetScope", { scope: scopeLabel }),
        error: t("toast.settings.resetScopeFailed", { scope: scopeLabel }),
      })
      .then(() => {
        setResetDoneScope(scope);
        window.setTimeout(() => {
          setResetDoneScope((current) => (current === scope ? null : current));
        }, 2000);
      })
      .catch(() => undefined);
  };

  const tabs: { id: TabId; label: string; Icon: typeof IconPalette }[] = [
    { id: "appearance", label: t("settings.tab.appearance"), Icon: IconPalette },
    { id: "model", label: t("settings.tab.model"), Icon: IconCpu },
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
        className="flex h-[calc(100vh-32px)] max-h-[760px] w-[calc(100vw-32px)] max-w-[840px] flex-col overflow-hidden rounded-xl border border-foreground/15 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              {t("settings.title")}
            </h2>
            <p className="mt-0.5 text-xs text-foreground/45">
              {tab === "appearance" ? t("appearance.subtitle") : ""}
            </p>
          </div>
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
          </nav>

          {/* 内容 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === "appearance" && (
              <AppearanceTab
                settings={settings}
                update={update}
                onResetDefaults={() => setConfirmResetScope("appearance")}
                resetDone={resetDoneScope === "appearance"}
              />
            )}
            {tab === "model" && <ModelTab settings={settings} update={update} />}
            {tab === "trash" && <TrashTab />}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-foreground/10 px-6 py-3">
          <span aria-hidden="true" />
          <Button variant="secondary" onPress={onClose}>
            {t("common.done")}
          </Button>
        </div>
      </div>

      {/* 恢复默认确认 */}
      <ConfirmDialog
        open={!!confirmResetScope}
        title={
          confirmResetScope
            ? t("settings.reset.scopeTitle", { scope: resetScopeLabel(confirmResetScope) })
            : t("settings.reset.title")
        }
        message={
          confirmResetScope
            ? t("settings.reset.scopeConfirm", { scope: resetScopeLabel(confirmResetScope) })
            : ""
        }
        danger
        confirmLabel={t("common.reset")}
        onConfirm={() => {
          const scope = confirmResetScope;
          if (!scope) return;
          setConfirmResetScope(null);
          handleReset(scope);
        }}
        onClose={() => setConfirmResetScope(null)}
      />
    </div>
  );
}

// ============================================================
// 通用小组件
// ============================================================

/**
 * 设置区块
 *
 * 视觉上呈现为一张"分组卡"：左侧带渐变色细条的标题区 + 右侧的内容区。
 * 让多个设置项按主题聚合在一起，避免单行设置显得零散。
 */
function SettingSection({
  title,
  desc,
  icon,
  children,
}: {
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-foreground/10 bg-foreground/[0.018] p-4">
      <header className="mb-3 flex items-center gap-2">
        {icon && (
          <span className="flex size-6 items-center justify-center rounded-md bg-accent/10 text-accent">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-sm font-medium leading-tight">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-foreground/50">{desc}</p>}
        </div>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** 单行设置项：左侧标题/描述，右侧控件 */
function SettingItem({
  title,
  desc,
  control,
}: {
  title: string;
  desc?: string;
  control: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5 transition hover:border-foreground/15">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-foreground/50">{desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

function ResettableTabHeader({
  title,
  onResetDefaults,
  resetDone,
}: {
  title: string;
  onResetDefaults: () => void;
  resetDone: boolean;
}): React.JSX.Element {
  const { t } = useT();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
      <h3 className="text-sm font-medium text-foreground/70">{title}</h3>
      <div className="flex items-center gap-2">
        <Button variant="tertiary" size="sm" onPress={onResetDefaults}>
          <IconRotateCcw className="mr-1 size-3.5" />
          {t("settings.reset.title")}
        </Button>
        {resetDone && <span className="text-xs text-success">{t("settings.reset.done")}</span>}
      </div>
    </div>
  );
}

// ============================================================
// 外观 Tab
// ============================================================

/**
 * 主题模式预览卡：与图中一致的三张卡片，横向并列
 *  - 上半部分使用 50/50 左右分屏的"窗口"预览
 *  - 边框颜色随选中状态变化（accent / 默认）
 */
function ThemeModePreviewCard({
  value,
  label,
  active,
  onSelect,
  swatchLight,
  swatchDark,
}: {
  value: ThemeMode;
  label: string;
  active: boolean;
  onSelect: (value: ThemeMode) => void;
  swatchLight: string;
  swatchDark: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={[
        "group flex w-full flex-col items-stretch gap-2 rounded-xl border-2 p-2 text-left transition",
        active
          ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)]"
          : "border-foreground/10 hover:border-foreground/25",
      ].join(" ")}
    >
      <div className="flex h-20 w-full overflow-hidden rounded-md border border-foreground/10">
        <div className="flex-1 p-2" style={{ backgroundColor: swatchLight }} aria-hidden="true">
          <PreviewSkeleton tone="light" />
        </div>
        <div className="flex-1 p-2" style={{ backgroundColor: swatchDark }} aria-hidden="true">
          <PreviewSkeleton tone="dark" />
        </div>
      </div>
      <div className="flex items-center justify-between px-1 pb-1">
        <span
          className={["text-sm font-medium", active ? "text-accent" : "text-foreground/80"].join(
            " ",
          )}
        >
          {label}
        </span>
        {active && <IconCheck className="size-4 text-accent" />}
      </div>
    </button>
  );
}

/** 主题模式预览骨架图（与图中类似的几条内容示意线） */
function PreviewSkeleton({ tone }: { tone: "light" | "dark" }): React.JSX.Element {
  const base = tone === "light" ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.22)";
  const accent = tone === "light" ? "rgba(15,23,42,0.3)" : "rgba(255,255,255,0.45)";
  return (
    <div className="flex h-full flex-col gap-1.5">
      <span className="block h-1.5 w-3/5 rounded-full" style={{ backgroundColor: accent }} />
      <span className="block h-1 w-full rounded-full" style={{ backgroundColor: base }} />
      <span className="block h-1 w-4/5 rounded-full" style={{ backgroundColor: base }} />
      <span className="block h-1 w-2/3 rounded-full" style={{ backgroundColor: base }} />
      <span className="mt-auto flex gap-1">
        <span className="block h-2 w-8 rounded" style={{ backgroundColor: accent }} />
        <span className="block h-2 w-8 rounded" style={{ backgroundColor: base }} />
      </span>
    </div>
  );
}

function AppearanceTab({
  settings,
  update,
  onResetDefaults,
  resetDone,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
  onResetDefaults: () => void;
  resetDone: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const preset = ACCENT_PRESETS.find((p) => p.id === settings.accentColor);
  const customAccentHex =
    !preset && settings.accentColor !== "theme" ? settings.accentColor : "#4f46e5";
  const selectedAccent = preset ? parseColor(preset.swatch) : undefined;
  const presetBundle = THEME_PRESETS.find((p) => p.id === settings.themePreset);

  // 主题模式预览卡片：左右两色由"当前主题包 + 浅/深"决定
  const systemSwatchLight = presetBundle?.swatches.light ?? "#f7f7f8";
  const systemSwatchDark = presetBundle?.swatches.dark ?? "#1f1f23";

  const handleThemeMode = (value: ThemeMode): void => {
    void update({ theme: value });
  };

  return (
    <section className="space-y-5">
      <ResettableTabHeader
        title={t("appearance.title")}
        onResetDefaults={onResetDefaults}
        resetDone={resetDone}
      />

      {/* —— 主题模式预览卡 —— */}
      <SettingSection
        title={t("appearance.mode")}
        desc={t("appearance.mode.desc")}
        icon={<IconPalette className="size-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ThemeModePreviewCard
            value="system"
            label={t("shell.theme.system")}
            active={settings.theme === "system"}
            onSelect={handleThemeMode}
            swatchLight={systemSwatchLight}
            swatchDark={systemSwatchDark}
          />
          <ThemeModePreviewCard
            value="light"
            label={t("shell.theme.light")}
            active={settings.theme === "light"}
            onSelect={handleThemeMode}
            swatchLight={systemSwatchLight}
            swatchDark={systemSwatchLight}
          />
          <ThemeModePreviewCard
            value="dark"
            label={t("shell.theme.dark")}
            active={settings.theme === "dark"}
            onSelect={handleThemeMode}
            swatchLight={systemSwatchDark}
            swatchDark={systemSwatchDark}
          />
        </div>
      </SettingSection>

      {/* —— 主题包 + 强调色 并列 —— */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingSection title={t("appearance.bundle")} desc={t("appearance.bundle.desc")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEME_PRESETS.map((p) => {
              const active = settings.themePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void update({ themePreset: p.id as ThemePresetId })}
                  aria-pressed={active}
                  className={[
                    "flex min-h-20 flex-col justify-between rounded-md border p-2.5 text-left text-sm transition",
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-foreground/15 text-foreground/75 hover:bg-foreground/5",
                  ].join(" ")}
                >
                  <span className="font-medium">{t(p.labelKey)}</span>
                  <span className="mt-2 flex gap-1">
                    <span
                      className="h-4 flex-1 rounded border border-foreground/10"
                      style={{ backgroundColor: p.swatches.light }}
                    />
                    <span
                      className="h-4 flex-1 rounded border border-foreground/10"
                      style={{ backgroundColor: p.swatches.dark }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </SettingSection>

        <SettingSection title={t("appearance.accent")} desc={t("appearance.accent.desc")}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void update({ accentColor: "theme" })}
              aria-pressed={settings.accentColor === "theme"}
              className={[
                "rounded-md border px-2.5 py-1.5 text-xs transition",
                settings.accentColor === "theme"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-foreground/15 text-foreground/70 hover:bg-foreground/5",
              ].join(" ")}
            >
              {t("appearance.accent.theme")}
            </button>
          </div>
          <ColorSwatchPicker
            value={selectedAccent}
            onChange={(color) => {
              const hex = color.toString("hex").toLowerCase();
              const next = ACCENT_PRESETS.find((p) => p.swatch.toLowerCase() === hex);
              if (next) void update({ accentColor: next.id });
              else void update({ accentColor: hex });
            }}
            size="md"
            variant="circle"
            className="gap-2.5"
          >
            {ACCENT_PRESETS.map((p) => (
              <ColorSwatchPicker.Item key={p.id} color={p.swatch}>
                <ColorSwatchPicker.Swatch />
                <ColorSwatchPicker.Indicator />
                <span className="sr-only">{t("theme.accent." + p.id)}</span>
              </ColorSwatchPicker.Item>
            ))}
          </ColorSwatchPicker>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-foreground/55">{t("appearance.accent.custom")}</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(customAccentHex) ? customAccentHex : "#4f46e5"}
              onChange={(e) => void update({ accentColor: e.target.value })}
              className="size-7 cursor-pointer rounded border border-foreground/15 bg-transparent"
              aria-label={t("appearance.accent.custom")}
            />
            <span className="font-mono text-xs text-foreground/40">
              {settings.accentColor === "theme" ? t("appearance.accent.theme") : customAccentHex}
            </span>
          </div>
        </SettingSection>
      </div>

      {/* —— 颜色（背景/前景/对比度）—— */}
      <SettingSection title={t("appearance.colors")} desc={t("appearance.colors.desc")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorFieldRow
            label={t("appearance.background")}
            value={settings.backgroundColor}
            onChange={(v) => void update({ backgroundColor: v })}
          />
          <ColorFieldRow
            label={t("appearance.foreground")}
            value={settings.foregroundColor}
            onChange={(v) => void update({ foregroundColor: v })}
          />
        </div>
        <SettingItem
          title={t("appearance.contrast")}
          desc={t("appearance.contrast.desc")}
          control={
            <div className="flex w-72 items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.contrast}
                onChange={(e) => void update({ contrast: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]"
                aria-label={t("appearance.contrast")}
              />
              <span className="w-8 text-right font-mono text-xs tabular-nums text-foreground/60">
                {settings.contrast}
              </span>
            </div>
          }
        />
      </SettingSection>

      {/* —— 字体 —— */}
      <SettingSection title={t("appearance.fonts")} desc={t("appearance.fonts.desc")}>
        <FontFieldRow
          label={t("appearance.font.ui")}
          placeholder={t("appearance.font.ui.hint")}
          value={settings.fontFamily}
          presets={FONT_PRESETS}
          onChange={(v) => void update({ fontFamily: v })}
        />
        <FontFieldRow
          label={t("appearance.font.mono")}
          placeholder={t("appearance.font.mono.hint")}
          value={settings.monoFontFamily}
          presets={MONO_FONT_PRESETS}
          onChange={(v) => void update({ monoFontFamily: v })}
        />
      </SettingSection>

      {/* —— 排版 —— */}
      <SettingSection title={t("appearance.typography")}>
        <SettingItem
          title={t("appearance.fontSize")}
          desc={t("appearance.fontSize.desc")}
          control={
            <ToggleButtonGroup
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[settings.fontSize]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v === "xs" || v === "sm" || v === "base" || v === "lg" || v === "xl") {
                  void update({ fontSize: v });
                }
              }}
            >
              {(["xs", "sm", "base", "lg", "xl"] as FontSizeLevel[]).map((lv, idx) => (
                <ToggleButton key={lv} id={lv}>
                  {idx > 0 && <ToggleButtonGroup.Separator />}
                  <span style={{ fontSize: String(FONT_SIZE_PX[lv]) + "px" }}>A</span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          }
        />
        <SettingItem
          title={t("appearance.codeFontSize")}
          desc={t("appearance.codeFontSize.desc")}
          control={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={24}
                step={1}
                value={settings.codeFontSizePx}
                onChange={(e) => {
                  const v = Math.min(24, Math.max(10, Number(e.target.value) || 13));
                  void update({ codeFontSizePx: v });
                }}
                className="w-20 rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 text-right text-sm font-mono tabular-nums outline-none focus:border-accent/50"
                aria-label={t("appearance.codeFontSize")}
              />
              <span className="text-xs text-foreground/50">px</span>
            </div>
          }
        />
      </SettingSection>

      {/* —— 交互 —— */}
      <SettingSection title={t("appearance.interaction")}>
        <SettingItem
          title={t("appearance.translucent")}
          desc={t("appearance.translucent.desc")}
          control={
            <Switch
              size="sm"
              isSelected={settings.translucentSidebar}
              onChange={(v) => void update({ translucentSidebar: v })}
              aria-label={t("appearance.translucent")}
            />
          }
        />
        <SettingItem
          title={t("appearance.pointer")}
          desc={t("appearance.pointer.desc")}
          control={
            <Switch
              size="sm"
              isSelected={settings.usePointerCursor}
              onChange={(v) => void update({ usePointerCursor: v })}
              aria-label={t("appearance.pointer")}
            />
          }
        />
        <SettingItem
          title={t("appearance.motion")}
          desc={t("appearance.motion.desc")}
          control={
            <ToggleButtonGroup
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[settings.reduceMotion]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v === "system" || v === "on" || v === "off") {
                  void update({ reduceMotion: v as ReduceMotion });
                }
              }}
            >
              <ToggleButton id="system">{t("appearance.motion.system")}</ToggleButton>
              <ToggleButton id="on">
                <ToggleButtonGroup.Separator />
                {t("appearance.motion.on")}
              </ToggleButton>
              <ToggleButton id="off">
                <ToggleButtonGroup.Separator />
                {t("appearance.motion.off")}
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <SettingItem
          title={t("appearance.density")}
          desc={t("appearance.density.desc")}
          control={
            <ToggleButtonGroup
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[settings.density]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v === "compact" || v === "comfortable" || v === "loose") {
                  void update({ density: v as LayoutDensity });
                }
              }}
            >
              <ToggleButton id="compact">{t("appearance.density.compact")}</ToggleButton>
              <ToggleButton id="comfortable">
                <ToggleButtonGroup.Separator />
                {t("appearance.density.comfortable")}
              </ToggleButton>
              <ToggleButton id="loose">
                <ToggleButtonGroup.Separator />
                {t("appearance.density.loose")}
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
      </SettingSection>

      {/* —— 高级/差异化 —— */}
      <SettingSection title={t("appearance.advanced")}>
        <SettingItem
          title={t("appearance.diff")}
          desc={t("appearance.diff.desc")}
          control={
            <ToggleButtonGroup
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[settings.diffMark]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v === "color" || v === "symbol") {
                  void update({ diffMark: v as DiffMark });
                }
              }}
            >
              <ToggleButton id="color">{t("appearance.diff.color")}</ToggleButton>
              <ToggleButton id="symbol">
                <ToggleButtonGroup.Separator />
                {t("appearance.diff.symbol")}
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <SettingItem
          title={t("appearance.language")}
          desc={t("appearance.language.desc")}
          control={
            <ToggleButtonGroup
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[settings.language]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v === "system" || v === "zh-CN" || v === "en") {
                  void update({ language: v as LanguageMode });
                }
              }}
            >
              {LANGUAGE_OPTIONS.map((opt, idx) => (
                <ToggleButton key={opt.value} id={opt.value}>
                  {idx > 0 && <ToggleButtonGroup.Separator />}
                  {t(opt.labelKey)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          }
        />
      </SettingSection>
    </section>
  );
}

// ============================================================
// 字段子组件
// ============================================================

/** 颜色输入行：左侧标签，右侧颜色选择器 + 文本输入 + 清空按钮 */
function ColorFieldRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): React.JSX.Element {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      <label className="relative flex items-center">
        <span
          className="block size-6 rounded-md border border-foreground/20"
          style={{
            background: value || "transparent",
            backgroundImage:
              "linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%), linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 4px 4px",
          }}
        />
        <input
          type="color"
          value={isHex ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB / oklch()"
        className="w-36 rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent/50"
        spellCheck={false}
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded p-1 text-foreground/45 hover:bg-foreground/5 hover:text-foreground"
          aria-label="reset"
        >
          <IconClose className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 字体输入行：标签 + 预设下拉 + 自定义输入 */
function FontFieldRow({
  label,
  placeholder,
  value,
  presets,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  presets: FontPreset[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  // 当前 value 命中某个预设时高亮它
  const matchedPreset = presets.find((p) => p.value === value);
  return (
    <div className="space-y-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <select
          value={matchedPreset ? matchedPreset.id : ""}
          onChange={(e) => {
            const next = presets.find((p) => p.id === e.target.value);
            onChange(next ? next.value : value);
          }}
          className="rounded-md border border-foreground/15 bg-background px-2 py-1 text-xs outline-none focus:border-accent/50"
        >
          <option value="">—</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent/50"
        spellCheck={false}
        aria-label={label}
        style={value ? { fontFamily: value } : undefined}
      />
      {value && (
        <div className="flex items-center justify-between text-xs text-foreground/50">
          <span className="truncate" style={{ fontFamily: value, fontSize: "14px" }}>
            The quick brown fox jumps over the lazy dog · 敏捷的棕色狐狸
          </span>
          <button
            type="button"
            onClick={() => onChange("")}
            className="ml-2 rounded p-1 text-foreground/45 hover:bg-foreground/5 hover:text-foreground"
            aria-label="reset"
          >
            <IconClose className="size-3.5" />
          </button>
        </div>
      )}
    </div>
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
  const [models, setModels] = useState<ManagedModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [editorState, setEditorState] = useState<
    { mode: "add" } | { mode: "edit"; model: ManagedModelInfo } | null
  >(null);
  const [modelToDelete, setModelToDelete] = useState<ManagedModelInfo | null>(null);
  const [cacheBytes, setCacheBytes] = useState<number>(0);
  const [cacheLimit, setCacheLimit] = useState<number>(settings.cacheSizeMb);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);

  const providerModelRef = (providerId: string, modelId: string): string =>
    providerId + "/" + modelId;

  const refreshModels = useCallback((): void => {
    void Promise.all([api.providers.list(), api.providers.listManagedModels()]).then(
      ([providerList, modelList]) => {
        setProviders(providerList);
        setModels(modelList);
        setModelsLoaded(true);
      },
    );
  }, []);

  const refreshCache = useCallback((): void => {
    void api.cache.stats().then((s) => {
      setCacheBytes(s.bytes);
      setCacheLimit(s.limitMb);
    });
  }, []);

  useEffect(() => {
    refreshModels();
    refreshCache();
  }, [refreshModels, refreshCache]);

  useEffect(() => {
    if (!modelsLoaded || !settings.selectedModel) return;
    const selected = models.find((model) => model.ref === settings.selectedModel);
    if (!selected || !selected.enabled) void update({ selectedModel: null });
  }, [models, modelsLoaded, settings.selectedModel, update]);

  const enabledProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.models.length > 0);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return String(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const formatParams = (model: ManagedModelInfo): string =>
    `${t("model.temperature")} ${model.temperature.toFixed(1)} · ${t("model.topP")} ${model.topP.toFixed(2)} · ${t("model.maxTokens")} ${model.maxOutputTokens}`;

  const handleToggleModel = (model: ManagedModelInfo, enabled: boolean): void => {
    void notify
      .promise(api.providers.updateModelEnabled(model.providerId, model.modelId, enabled), {
        loading: t("toast.model.modelSaving"),
        success: t("toast.model.modelSaved"),
        error: t("toast.model.modelSaveFailed"),
      })
      .then(() => {
        if (!enabled && settings.selectedModel === model.ref) void update({ selectedModel: null });
        refreshModels();
      })
      .catch(() => undefined);
  };

  const handleDeleteModel = (): void => {
    if (!modelToDelete) return;
    const model = modelToDelete;
    void notify
      .promise(api.providers.deleteCustomModel(model.providerId, model.modelId), {
        loading: t("toast.model.modelDeleting"),
        success: t("toast.model.modelDeleted"),
        error: t("toast.model.modelDeleteFailed"),
      })
      .then(() => {
        if (settings.selectedModel === model.ref) void update({ selectedModel: null });
        if (editorState?.mode === "edit" && editorState.model.ref === model.ref)
          setEditorState(null);
        setModelToDelete(null);
        refreshModels();
      })
      .catch(() => undefined);
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

      <SettingItem
        title={t("model.default")}
        desc={t("model.default.desc")}
        control={
          <select
            className="min-w-56 rounded-md border border-foreground/15 bg-background px-3 py-1.5 text-sm outline-none focus:border-accent/50"
            value={settings.selectedModel ?? ""}
            onChange={(e) => void update({ selectedModel: e.target.value || null })}
          >
            <option value="">{t("chat.selectModel")}</option>
            {enabledProviders.map((provider) => (
              <optgroup key={provider.id} label={provider.label}>
                {provider.models.map((model) => (
                  <option key={model.id} value={providerModelRef(provider.id, model.id)}>
                    {model.label ?? model.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        }
      />

      <SettingSection title={t("model.catalog")} desc={t("model.catalog.desc")}>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onPress={() => setEditorState({ mode: "add" })}>
            <IconPlus className="mr-1 size-3.5" />
            {t("model.addModel")}
          </Button>
        </div>

        {models.length === 0 ? (
          <div className="rounded-md border border-dashed border-foreground/15 px-4 py-8 text-center text-sm text-foreground/50">
            {t("model.empty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-foreground/10">
            {models.map((model, index) => {
              const selected = settings.selectedModel === model.ref;
              return (
                <div
                  key={model.ref}
                  className={[
                    "grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                    index > 0 ? "border-t border-foreground/10" : "",
                    selected ? "bg-accent/10" : "",
                    model.enabled ? "" : "opacity-65",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {model.modelLabel ?? model.modelId}
                      </span>
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                        {t("model.custom")}
                      </span>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[11px]",
                          model.hasApiKey
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning",
                        ].join(" ")}
                      >
                        {model.hasApiKey ? t("apikey.configured") : t("apikey.notConfigured")}
                      </span>
                      {selected && (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <IconCheck className="size-3" /> {t("model.selected")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 break-all text-xs text-foreground/45">
                      {model.providerLabel} / {model.modelId}
                    </p>
                    <p className="mt-1 text-xs text-foreground/40">{formatParams(model)}</p>
                    {model.providerBaseUrl && (
                      <p className="mt-1 break-all text-xs text-foreground/35">
                        {t("model.provider.baseUrl")}: {model.providerBaseUrl}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Switch
                      size="sm"
                      isSelected={model.enabled}
                      onChange={(enabled) => handleToggleModel(model, enabled)}
                      aria-label={t("model.enabled")}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => setEditorState({ mode: "edit", model })}
                    >
                      <IconKey className="mr-1 size-3.5" />
                      {t("common.edit")}
                    </Button>
                    <Button variant="tertiary" size="sm" onPress={() => setModelToDelete(model)}>
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingSection>

      <SettingSection title={t("model.cache")} desc={t("model.cache.desc")}>
        <div className="space-y-3">
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
                  width:
                    String(Math.min(100, (cacheBytes / (cacheLimit * 1024 * 1024)) * 100)) + "%",
                }}
              />
            </div>
          </div>

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
      </SettingSection>

      <ModelEditorDialog
        open={!!editorState}
        mode={editorState?.mode ?? "add"}
        providers={providers}
        model={editorState?.mode === "edit" ? editorState.model : null}
        selectedModel={settings.selectedModel}
        onClearSelectedModel={() => update({ selectedModel: null })}
        onSaved={refreshModels}
        onClose={() => setEditorState(null)}
      />

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
      <ConfirmDialog
        open={!!modelToDelete}
        title={t("common.delete")}
        message={t("model.deleteModel.confirm", {
          label: modelToDelete?.modelLabel ?? modelToDelete?.modelId ?? "",
        })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteModel}
        onClose={() => setModelToDelete(null)}
      />
    </section>
  );
}

type ModelEditorMode = "add" | "edit";

interface ModelFormState {
  providerId: string;
  id: string;
  label: string;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
}

function createEmptyModelForm(providerId = ""): ModelFormState {
  return {
    providerId,
    id: "",
    label: "",
    enabled: true,
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 4096,
  };
}

function ModelEditorDialog({
  open,
  mode,
  providers,
  model,
  selectedModel,
  onClearSelectedModel,
  onSaved,
  onClose,
}: {
  open: boolean;
  mode: ModelEditorMode;
  providers: ProviderInfo[];
  model: ManagedModelInfo | null;
  selectedModel: string | null;
  onClearSelectedModel: () => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const [addMode, setAddMode] = useState<"existing" | "custom">("existing");
  const [providerForm, setProviderForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });
  const [modelForm, setModelForm] = useState<ModelFormState>(() =>
    createEmptyModelForm(providers[0]?.id ?? ""),
  );
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && model) {
      setAddMode("existing");
      setProviderForm({
        id: model.providerId,
        label: model.providerLabel,
        baseUrl: model.providerBaseUrl ?? "",
        helpUrl: model.providerHelpUrl,
      });
      setModelForm({
        providerId: model.providerId,
        id: model.modelId,
        label: model.modelLabel ?? "",
        enabled: model.enabled,
        temperature: model.temperature,
        topP: model.topP,
        maxOutputTokens: model.maxOutputTokens,
      });
      setApiKey("");
      setHasApiKey(model.hasApiKey);
      return;
    }

    setAddMode("existing");
    setProviderForm({ id: "", label: "", baseUrl: "", helpUrl: "" });
    setModelForm(createEmptyModelForm(providers[0]?.id ?? ""));
    setApiKey("");
    setHasApiKey(false);
  }, [mode, model, open, providers]);

  useEffect(() => {
    if (!open || mode !== "add" || modelForm.providerId || providers.length === 0) return;
    setModelForm((prev) => ({ ...prev, providerId: providers[0].id }));
  }, [mode, modelForm.providerId, open, providers]);

  const isEditing = mode === "edit";
  const canEditProvider = isEditing && model?.providerSource === "custom";
  const providerHelpUrl = isEditing
    ? providerForm.helpUrl || model?.providerHelpUrl
    : addMode === "custom"
      ? providerForm.helpUrl
      : providers.find((provider) => provider.id === modelForm.providerId)?.helpUrl;

  const canSave =
    modelForm.id.trim().length > 0 &&
    modelForm.maxOutputTokens > 0 &&
    (isEditing
      ? !canEditProvider ||
        (providerForm.label.trim().length > 0 && providerForm.baseUrl.trim().length > 0)
      : addMode === "existing"
        ? modelForm.providerId.length > 0
        : providerForm.label.trim().length > 0 && providerForm.baseUrl.trim().length > 0);

  const updateModelNumber = (patch: Partial<ModelFormState>): void => {
    setModelForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = (): void => {
    if (!canSave) return;
    const task = (async (): Promise<void> => {
      let providerId = modelForm.providerId;
      if (!isEditing && addMode === "custom") {
        providerId = (await api.providers.upsertCustomProvider(providerForm)).id;
      } else if (canEditProvider) {
        await api.providers.upsertCustomProvider(providerForm);
      }

      const modelId = modelForm.id.trim();
      await api.providers.upsertCustomModel({
        providerId,
        id: modelId,
        label: modelForm.label.trim(),
        enabled: modelForm.enabled,
        temperature: modelForm.temperature,
        topP: modelForm.topP,
        maxOutputTokens: Math.floor(modelForm.maxOutputTokens),
      });

      if (apiKey.trim()) {
        await api.providers.setModelApiKey(providerId, modelId, apiKey.trim());
      }
      if (!modelForm.enabled && selectedModel === providerId + "/" + modelId) {
        await onClearSelectedModel();
      }
    })();

    void notify
      .promise(task, {
        loading: t("toast.model.modelSaving"),
        success: t("toast.model.modelSaved"),
        error: t("toast.model.modelSaveFailed"),
      })
      .then(() => {
        onSaved();
        onClose();
      })
      .catch(() => undefined);
  };

  const handleClearKey = (): void => {
    if (!model) return;
    void notify
      .promise(api.providers.deleteModelApiKey(model.providerId, model.modelId), {
        loading: t("toast.apikey.clearing"),
        success: t("toast.apikey.cleared"),
        error: t("toast.apikey.clearFailed"),
      })
      .then(() => {
        setHasApiKey(false);
        onSaved();
      })
      .catch(() => undefined);
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex w-full items-center justify-between gap-3">
                <Modal.Heading className="text-base font-semibold">
                  {isEditing ? t("model.editModel") : t("model.addModel")}
                </Modal.Heading>
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onClose}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>

            <Modal.Body>
              <div className="grid gap-3 md:grid-cols-2">
                {!isEditing && (
                  <label className="text-sm md:col-span-2">
                    <span className="mb-1 block text-xs text-foreground/60">
                      {t("model.provider")}
                    </span>
                    <select
                      className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                      value={addMode}
                      onChange={(e) =>
                        setAddMode(e.target.value === "custom" ? "custom" : "existing")
                      }
                    >
                      <option value="existing">{t("model.addToProvider")}</option>
                      <option value="custom">{t("model.addWithProvider")}</option>
                    </select>
                  </label>
                )}

                {!isEditing && addMode === "existing" && (
                  <label className="text-sm md:col-span-2">
                    <span className="mb-1 block text-xs text-foreground/60">
                      {t("model.provider")}
                    </span>
                    <select
                      className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                      value={modelForm.providerId}
                      onChange={(e) =>
                        setModelForm((prev) => ({ ...prev, providerId: e.target.value }))
                      }
                    >
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {((!isEditing && addMode === "custom") || canEditProvider) && (
                  <>
                    <TextField>
                      <Label>{t("model.providerName")}</Label>
                      <Input
                        value={providerForm.label}
                        placeholder={t("model.placeholder.providerName")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            label: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                    {!isEditing && (
                      <TextField>
                        <Label>{t("model.providerId")}</Label>
                        <Input
                          value={providerForm.id ?? ""}
                          placeholder={t("model.placeholder.providerId")}
                          onChange={(e) =>
                            setProviderForm((prev) => ({
                              ...prev,
                              id: (e.target as HTMLInputElement).value,
                            }))
                          }
                        />
                      </TextField>
                    )}
                    <TextField>
                      <Label>{t("model.baseUrl")}</Label>
                      <Input
                        value={providerForm.baseUrl}
                        placeholder={t("model.placeholder.baseUrl")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            baseUrl: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                    <TextField>
                      <Label>{t("model.helpUrl")}</Label>
                      <Input
                        value={providerForm.helpUrl ?? ""}
                        placeholder={t("model.placeholder.helpUrl")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            helpUrl: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                  </>
                )}

                {isEditing && (
                  <TextField>
                    <Label>{t("model.provider")}</Label>
                    <Input value={model?.providerId ?? ""} disabled />
                  </TextField>
                )}
                <TextField>
                  <Label>{t("model.modelId")}</Label>
                  <Input
                    value={modelForm.id}
                    placeholder={t("model.placeholder.modelId")}
                    disabled={isEditing}
                    onChange={(e) =>
                      setModelForm((prev) => ({
                        ...prev,
                        id: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.modelName")}</Label>
                  <Input
                    value={modelForm.label}
                    placeholder={t("model.placeholder.modelName")}
                    onChange={(e) =>
                      setModelForm((prev) => ({
                        ...prev,
                        label: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField className="md:col-span-2">
                  <Label>{t("model.apiKey")}</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    placeholder={
                      hasApiKey ? t("apikey.placeholder.replace") : t("model.placeholder.apiKey")
                    }
                    onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                  />
                  {providerHelpUrl && (
                    <Description className="mt-1">
                      <a
                        href={providerHelpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        {t("apikey.getKey")}
                      </a>
                    </Description>
                  )}
                </TextField>

                <div className="md:col-span-2">
                  <Switch
                    size="sm"
                    isSelected={modelForm.enabled}
                    onChange={(enabled) => setModelForm((prev) => ({ ...prev, enabled }))}
                  >
                    {t("model.enabled")}
                  </Switch>
                </div>

                <div className="space-y-4 md:col-span-2">
                  <p className="text-xs font-medium text-foreground/60">{t("model.params")}</p>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.temperature")}</span>
                      <span>{modelForm.temperature.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={modelForm.temperature}
                      onChange={(e) => updateModelNumber({ temperature: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.temperature")}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {t("model.temperature.hint")}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.topP")}</span>
                      <span>{modelForm.topP.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={modelForm.topP}
                      onChange={(e) => updateModelNumber({ topP: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.topP")}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">{t("model.topP.hint")}</p>
                  </div>
                  <TextField>
                    <Label>{t("model.maxTokens")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={32768}
                      step={256}
                      value={String(modelForm.maxOutputTokens)}
                      onChange={(e) =>
                        updateModelNumber({
                          maxOutputTokens: Math.max(
                            1,
                            Number((e.target as HTMLInputElement).value) || 1,
                          ),
                        })
                      }
                    />
                    <Description className="mt-1">{t("model.maxTokens.hint")}</Description>
                  </TextField>
                </div>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                {isEditing && hasApiKey && (
                  <Button variant="tertiary" onPress={handleClearKey}>
                    {t("common.clear")}
                  </Button>
                )}
                <Button variant="secondary" onPress={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onPress={handleSave} isDisabled={!canSave}>
                  {t("common.save")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
