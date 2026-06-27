import { useEffect, useState } from "react";
import { Button, Input, Label, TextField, Description } from "@heroui/react";
import { api } from "../lib/api";
import { useTheme, type ThemeMode } from "../lib/theme";
import { IconClose, IconKey, IconCheck, IconSun, IconMoon, IconMonitor } from "./icons";
import type { ProviderInfo } from "@shared/types";

interface SettingsDialogProps {
  /** 控制显隐 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 设置弹窗
 *
 * 内容：
 *  - 主题切换
 *  - 各 Provider 的 API Key 配置（脱敏显示是否已设置）
 *
 * 布局示意：
 * ┌───────────────────────────────────────┐
 * │ 设置                              [✕] │
 * │───────────────────────────────────────│
 * │ 外观                                  │
 * │   主题：[☀ 浅] [🌙 深] [🖥 跟随系统]   │
 * │                                       │
 * │ API Key                               │
 * │ ┌ OpenAI ───────────────────────────┐│
 * │ │ [sk-•••••••••••]   [获取 key ↗]    ││
 * │ │ [保存] [清除]                     ││
 * │ │ ✓ 已保存                          ││
 * │ └───────────────────────────────────┘│
 * │ ┌ Anthropic ─────────────────────────┐│
 * │ │ ...                                ││
 * │ └───────────────────────────────────┘│
 * └───────────────────────────────────────┘
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.JSX.Element | null {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const { mode, setMode } = useTheme();

  useEffect(() => {
    if (open) void api.providers.list().then(setProviders);
  }, [open]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
          <h2 id="settings-title" className="text-lg font-semibold">
            设置
          </h2>
          <button
            type="button"
            className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 外观 */}
          <section className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-foreground/70">外观</h3>
            <div className="rounded-md border border-foreground/10 p-4">
              <p className="mb-2 text-xs text-foreground/50">主题</p>
              <div className="flex gap-2">
                <ThemeButton
                  current={mode}
                  value="light"
                  label="浅色"
                  Icon={IconSun}
                  onClick={(v) => void setMode(v)}
                />
                <ThemeButton
                  current={mode}
                  value="dark"
                  label="深色"
                  Icon={IconMoon}
                  onClick={(v) => void setMode(v)}
                />
                <ThemeButton
                  current={mode}
                  value="system"
                  label="跟随系统"
                  Icon={IconMonitor}
                  onClick={(v) => void setMode(v)}
                />
              </div>
            </div>
          </section>

          {/* API Key */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/70">
              <IconKey className="size-4" />
              API Key
            </h3>
            <p className="mb-3 text-xs text-foreground/50">
              密钥使用 AES-256-GCM 加密后本地存储，仅用于 main 进程内调用 AI
              服务，不会上传到任何服务器。
            </p>
            <div className="space-y-3">
              {providers.map((p) => (
                <ProviderKeyEditor key={p.id} provider={p} />
              ))}
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="flex justify-end border-t border-foreground/10 px-6 py-3">
          <Button variant="secondary" onPress={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 单个 Provider 的 API Key 编辑器
 */
function ProviderKeyEditor({ provider }: { provider: ProviderInfo }): React.JSX.Element {
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  // 初始加载是否已配置
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
    void api.apikeys
      .set(provider.id, value.trim())
      .then(() => {
        setHasKey(true);
        setValue("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .finally(() => setLoading(false));
  };

  const handleDelete = (): void => {
    setLoading(true);
    void api.apikeys
      .delete(provider.id)
      .then(() => {
        setHasKey(false);
        setValue("");
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{provider.label}</span>
        {hasKey ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <IconCheck className="size-3" /> 已配置
          </span>
        ) : (
          <span className="text-xs text-foreground/40">未配置</span>
        )}
      </div>

      <TextField className="mb-3">
        <Label className="sr-only">{provider.label} API Key</Label>
        <Input
          type="password"
          placeholder={
            hasKey ? "••••••••（已保存，输入新值替换）" : `粘贴 ${provider.label} API Key`
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
            获取 API Key ↗
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
          {saved ? "已保存" : "保存"}
        </Button>
        {hasKey && (
          <Button variant="tertiary" size="sm" onPress={handleDelete} isDisabled={loading}>
            清除
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 主题按钮
 */
function ThemeButton({
  current,
  value,
  label,
  Icon,
  onClick,
}: {
  current: ThemeMode;
  value: ThemeMode;
  label: string;
  Icon: typeof IconSun;
  onClick: (v: ThemeMode) => void;
}): React.JSX.Element {
  const active = current === value;
  return (
    <button
      type="button"
      className={[
        "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition",
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-foreground/15 text-foreground/70 hover:bg-foreground/5",
      ].join(" ")}
      onClick={() => onClick(value)}
      aria-pressed={active}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
