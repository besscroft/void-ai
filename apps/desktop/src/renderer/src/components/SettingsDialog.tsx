import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ColorSwatchPicker,
  Description,
  Input,
  Label,
  parseColor,
  Switch,
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
  IconPlus,
} from "./icons";
import {
  ACCENT_PRESETS,
  FONT_SIZE_PX,
  THEME_PRESETS,
  type Conversation,
  type CustomModelInput,
  type CustomProviderInput,
  type ManagedModelInfo,
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
type TabId = "theme" | "system" | "model" | "trash";

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
  const [models, setModels] = useState<ManagedModelInfo[]>([]);
  const [addMode, setAddMode] = useState<"existing" | "custom">("existing");
  const [providerForm, setProviderForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });
  const [modelForm, setModelForm] = useState<CustomModelInput>({
    providerId: "",
    id: "",
    label: "",
    enabled: true,
  });
  const [modelApiKey, setModelApiKey] = useState("");
  const [editingModel, setEditingModel] = useState<ManagedModelInfo | null>(null);
  const [editModelForm, setEditModelForm] = useState<CustomModelInput>({
    providerId: "",
    id: "",
    label: "",
    enabled: true,
  });
  const [editProviderForm, setEditProviderForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });
  const [editApiKey, setEditApiKey] = useState("");
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
        setModelForm((prev) => {
          const stillExists = providerList.some((provider) => provider.id === prev.providerId);
          return stillExists ? prev : { ...prev, providerId: providerList[0]?.id ?? "" };
        });
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
    if (!settings.selectedModel || models.length === 0) return;
    const selected = models.find((model) => model.ref === settings.selectedModel);
    if (!selected || !selected.enabled) void update({ selectedModel: null });
  }, [models, settings.selectedModel, update]);

  const enabledProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.models.length > 0);

  const canSaveNewModel =
    modelForm.id.trim().length > 0 &&
    (addMode === "existing"
      ? modelForm.providerId.length > 0
      : providerForm.label.trim().length > 0 && providerForm.baseUrl.trim().length > 0);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return String(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const resetNewModelForm = (): void => {
    setProviderForm({ id: "", label: "", baseUrl: "", helpUrl: "" });
    setModelForm((prev) => ({
      providerId: addMode === "existing" ? prev.providerId : providers[0]?.id ?? "",
      id: "",
      label: "",
      enabled: true,
    }));
    setModelApiKey("");
  };

  const openEditor = (model: ManagedModelInfo): void => {
    setEditingModel(model);
    setEditModelForm({
      providerId: model.providerId,
      id: model.modelId,
      label: model.modelLabel ?? "",
      enabled: model.enabled,
    });
    setEditProviderForm({
      id: model.providerId,
      label: model.providerLabel,
      baseUrl: model.providerBaseUrl ?? "",
      helpUrl: model.providerHelpUrl,
    });
    setEditApiKey("");
  };

  const handleSaveModel = (): void => {
    if (!canSaveNewModel) return;
    const task = (async (): Promise<void> => {
      const providerId =
        addMode === "custom"
          ? (await api.providers.upsertCustomProvider(providerForm)).id
          : modelForm.providerId;
      await api.providers.upsertCustomModel({
        ...modelForm,
        providerId,
        enabled: true,
      });
      if (modelApiKey.trim()) {
        await api.providers.setModelApiKey(providerId, modelForm.id.trim(), modelApiKey.trim());
      }
    })();

    void notify
      .promise(task, {
        loading: t("toast.model.modelSaving"),
        success: t("toast.model.modelSaved"),
        error: t("toast.model.modelSaveFailed"),
      })
      .then(() => {
        resetNewModelForm();
        refreshModels();
      })
      .catch(() => undefined);
  };

  const handleSaveEdit = (): void => {
    if (!editingModel) return;
    const task = (async (): Promise<void> => {
      if (editingModel.providerSource === "custom") {
        await api.providers.upsertCustomProvider(editProviderForm);
      }
      if (editingModel.modelSource === "custom") {
        await api.providers.upsertCustomModel(editModelForm);
      } else {
        await api.providers.updateModelEnabled(
          editingModel.providerId,
          editingModel.modelId,
          editModelForm.enabled ?? true,
        );
      }
      if (editApiKey.trim()) {
        await api.providers.setModelApiKey(
          editingModel.providerId,
          editingModel.modelId,
          editApiKey.trim(),
        );
      }
      if (!editModelForm.enabled && settings.selectedModel === editingModel.ref) {
        await update({ selectedModel: null });
      }
    })();

    void notify
      .promise(task, {
        loading: t("toast.model.modelSaving"),
        success: t("toast.model.modelSaved"),
        error: t("toast.model.modelSaveFailed"),
      })
      .then(() => {
        setEditingModel(null);
        setEditApiKey("");
        refreshModels();
      })
      .catch(() => undefined);
  };

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

  const handleClearEditKey = (): void => {
    if (!editingModel) return;
    void notify
      .promise(api.providers.deleteModelApiKey(editingModel.providerId, editingModel.modelId), {
        loading: t("toast.apikey.clearing"),
        success: t("toast.apikey.cleared"),
        error: t("toast.apikey.clearFailed"),
      })
      .then(() => {
        setEditingModel((prev) => (prev ? { ...prev, hasApiKey: false } : prev));
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
        if (editingModel?.ref === model.ref) setEditingModel(null);
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

      <SettingRow title={t("model.default")} desc={t("model.default.desc")}>
        <select
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
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
      </SettingRow>

      <SettingRow title={t("model.catalog")} desc={t("model.catalog.desc")}>
        <div className="space-y-2">
          {models.map((model) => {
            const selected = settings.selectedModel === model.ref;
            return (
              <div
                key={model.ref}
                className={[
                  "grid gap-3 rounded-md border px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                  selected ? "border-accent bg-accent/10" : "border-foreground/10",
                  model.enabled ? "" : "opacity-65",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {model.modelLabel ?? model.modelId}
                    </span>
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                      {model.modelSource === "builtin"
                        ? t("model.provider.builtin")
                        : t("model.custom")}
                    </span>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-[11px]",
                        model.hasApiKey ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
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
                  <Button variant="secondary" size="sm" onPress={() => openEditor(model)}>
                    <IconKey className="mr-1 size-3.5" />
                    {model.modelSource === "custom" || model.providerSource === "custom"
                      ? t("common.edit")
                      : t("model.configureKey")}
                  </Button>
                  {model.modelSource === "custom" && (
                    <Button variant="tertiary" size="sm" onPress={() => setModelToDelete(model)}>
                      <IconTrash className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingRow>

      {editingModel && (
        <SettingRow title={t("model.editModel")} desc={t("model.editModel.desc")}>
          <div className="grid gap-3 md:grid-cols-2">
            {editingModel.providerSource === "custom" && (
              <>
                <TextField>
                  <Label>{t("model.providerName")}</Label>
                  <Input
                    value={editProviderForm.label}
                    onChange={(e) =>
                      setEditProviderForm((prev) => ({
                        ...prev,
                        label: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.baseUrl")}</Label>
                  <Input
                    value={editProviderForm.baseUrl}
                    onChange={(e) =>
                      setEditProviderForm((prev) => ({
                        ...prev,
                        baseUrl: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField className="md:col-span-2">
                  <Label>{t("model.helpUrl")}</Label>
                  <Input
                    value={editProviderForm.helpUrl ?? ""}
                    onChange={(e) =>
                      setEditProviderForm((prev) => ({
                        ...prev,
                        helpUrl: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
              </>
            )}

            <TextField>
              <Label>{t("model.modelId")}</Label>
              <Input value={editingModel.modelId} disabled />
            </TextField>
            <TextField>
              <Label>{t("model.modelName")}</Label>
              <Input
                value={editModelForm.label ?? ""}
                disabled={editingModel.modelSource !== "custom"}
                onChange={(e) =>
                  setEditModelForm((prev) => ({
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
                value={editApiKey}
                placeholder={
                  editingModel.hasApiKey ? t("apikey.placeholder.replace") : t("model.placeholder.apiKey")
                }
                onChange={(e) => setEditApiKey((e.target as HTMLInputElement).value)}
              />
              <Description className="mt-1">
                <a
                  href={editingModel.providerHelpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  {t("apikey.getKey")}
                </a>
              </Description>
            </TextField>
            <div className="flex items-center gap-3 md:col-span-2">
              <Switch
                size="sm"
                isSelected={editModelForm.enabled !== false}
                onChange={(enabled) => setEditModelForm((prev) => ({ ...prev, enabled }))}
              >
                {t("model.enabled")}
              </Switch>
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button variant="primary" onPress={handleSaveEdit}>
                {t("common.save")}
              </Button>
              {editingModel.hasApiKey && (
                <Button variant="tertiary" onPress={handleClearEditKey}>
                  {t("common.clear")}
                </Button>
              )}
              <Button variant="secondary" onPress={() => setEditingModel(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </SettingRow>
      )}

      <SettingRow title={t("model.addModel")} desc={t("model.addModel.desc")}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-foreground/60">{t("model.provider")}</span>
            <select
              className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
              value={addMode}
              onChange={(e) => setAddMode(e.target.value === "custom" ? "custom" : "existing")}
            >
              <option value="existing">{t("model.addToProvider")}</option>
              <option value="custom">{t("model.addWithProvider")}</option>
            </select>
          </label>
          {addMode === "existing" && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-foreground/60">{t("model.provider")}</span>
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
          {addMode === "custom" && (
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
          <TextField>
            <Label>{t("model.modelId")}</Label>
            <Input
              value={modelForm.id}
              placeholder={t("model.placeholder.modelId")}
              onChange={(e) =>
                setModelForm((prev) => ({ ...prev, id: (e.target as HTMLInputElement).value }))
              }
            />
          </TextField>
          <TextField>
            <Label>{t("model.modelName")}</Label>
            <Input
              value={modelForm.label ?? ""}
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
              value={modelApiKey}
              placeholder={t("model.placeholder.apiKey")}
              onChange={(e) => setModelApiKey((e.target as HTMLInputElement).value)}
            />
          </TextField>
          <div className="md:col-span-2">
            <Button variant="primary" onPress={handleSaveModel} isDisabled={!canSaveNewModel}>
              <IconPlus className="mr-1 size-3.5" />
              {t("model.addModel")}
            </Button>
          </div>
        </div>
      </SettingRow>

      <SettingRow title={t("model.params")} desc={t("model.params.desc")}>
        <div className="space-y-4">
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

      <SettingRow title={t("model.cache")} desc={t("model.cache.desc")}>
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
                  width: String(Math.min(100, (cacheBytes / (cacheLimit * 1024 * 1024)) * 100)) + "%",
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

// ============================================================
// Trash Tab
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
