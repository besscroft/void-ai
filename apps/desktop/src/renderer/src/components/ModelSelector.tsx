import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { IconChevronDown, IconCheck } from "./icons";
import type { ProviderInfo } from "@shared/types";
import { SettingKey } from "@shared/types";

interface ModelSelectorProps {
  /** 当前选中的模型引用（"provider/model" 格式） */
  value: string | null;
  /** 选择变更回调 */
  onChange: (modelRef: string) => void;
}

/**
 * 模型选择下拉
 *
 * 显示所有 provider 及其模型，用户可切换。
 * 选中值持久化到 settings 表。
 *
 * 示意：
 * ┌─────────────────────────┐
 * │ OpenAI / GPT-4o    ▼    │
 * └─────────────────────────┘
 *   ┌─ OpenAI ─────────────┐
 *   │  ✓ GPT-4o            │
 *   │    GPT-4o mini       │
 *   ├─ Anthropic ──────────┤
 *   │    Claude 3.5 Sonnet│
 *   └──────────────────────┘
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.providers.list().then(setProviders);
  }, []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (modelRef: string): void => {
    onChange(modelRef);
    void api.settings.set(SettingKey.SelectedModel, modelRef);
    setOpen(false);
  };

  // 显示当前选中模型的友好名
  const selectedLabel = (): string => {
    if (!value) return t("chat.selectModel");
    const slashIdx = value.indexOf("/");
    const pid = slashIdx >= 0 ? value.slice(0, slashIdx) : value;
    const mid = slashIdx >= 0 ? value.slice(slashIdx + 1) : "";
    const p = providers.find((x) => x.id === pid);
    const m = p?.models.find((x) => x.id === mid);
    return `${p?.label ?? pid} / ${m?.label ?? mid}`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-foreground/15 bg-background px-3 py-1.5 text-sm transition hover:bg-foreground/5"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="max-w-[200px] truncate">{selectedLabel()}</span>
        <IconChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-foreground/15 bg-background shadow-lg"
        >
          {providers
            .filter((p) => p.models.length > 0)
            .map((p) => (
              <div key={p.id}>
                <div className="border-b border-foreground/10 px-3 py-1.5 text-xs font-semibold text-foreground/50">
                  {p.label}
                </div>
                {p.models.map((m) => {
                  const ref = `${p.id}/${m.id}`;
                  const selected = ref === value;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                        selected ? "bg-accent/10 text-accent" : "hover:bg-foreground/5",
                      ].join(" ")}
                      onClick={() => handleChange(ref)}
                    >
                      <span className="flex-1">{m.label ?? m.id}</span>
                      {selected && <IconCheck className="size-3.5" />}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
