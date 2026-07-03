import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { IconChevronDown, IconCheck } from "./icons";
import type { ProviderInfo } from "@shared/types";
import { SettingKey } from "@shared/types";

interface ModelSelectorProps {
  value: string | null;
  onChange: (modelRef: string) => void;
  placement?: "top" | "bottom";
}

export function ModelSelector({
  value,
  onChange,
  placement = "bottom",
}: ModelSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.providers.list().then(setProviders);
  }, []);

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

  const selectedLabel = (): string => {
    if (!value) return t("chat.selectModel");
    const slashIdx = value.indexOf("/");
    const pid = slashIdx >= 0 ? value.slice(0, slashIdx) : value;
    const mid = slashIdx >= 0 ? value.slice(slashIdx + 1) : "";
    const p = providers.find((x) => x.id === pid);
    const m = p?.models.find((x) => x.id === mid);
    return `${p?.label ?? pid} / ${m?.label ?? mid}`;
  };

  const menuPlacement = placement === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0";

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.035] px-2.5 text-[13px] shadow-sm transition hover:bg-foreground/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="size-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)]" />
        <span className="max-w-[160px] truncate font-medium">{selectedLabel()}</span>
        <IconChevronDown className={`size-3 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 max-h-80 w-72 overflow-y-auto rounded-lg border border-foreground/15 bg-background shadow-xl ${menuPlacement}`}
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
                      <span className="min-w-0 flex-1 truncate">{m.label ?? m.id}</span>
                      {selected && <IconCheck className="size-3.5 shrink-0" />}
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
