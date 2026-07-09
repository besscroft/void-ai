import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { CHAT_REASONING_LEVELS, SettingKey, type ChatReasoningLevel } from "@shared/types";
import { IconBrain, IconCheck } from "./icons";

interface ReasoningSelectorProps {
  value: ChatReasoningLevel;
  onChange: (level: ChatReasoningLevel) => void;
  placement?: "top" | "bottom";
}

const REASONING_LABEL_KEYS: Record<ChatReasoningLevel, TranslationKey> = {
  "provider-default": "reasoning.level.provider-default",
  none: "reasoning.level.none",
  minimal: "reasoning.level.minimal",
  low: "reasoning.level.low",
  medium: "reasoning.level.medium",
  high: "reasoning.level.high",
  xhigh: "reasoning.level.xhigh",
};

export function ReasoningSelector({
  value,
  onChange,
  placement = "bottom",
}: ReasoningSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (level: ChatReasoningLevel): void => {
    onChange(level);
    void api.settings.set(SettingKey.ChatReasoningLevel, level);
    setOpen(false);
  };

  const menuPlacement = placement === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0";

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("reasoning.selector.label")}
        title={t("reasoning.selector.label")}
      >
        <IconBrain className="size-4" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("reasoning.selector.label")}
          className={`absolute z-50 w-56 overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl ${menuPlacement}`}
        >
          <div className="border-b border-foreground/10 px-3 py-1.5 text-xs font-semibold text-foreground/50">
            {t("reasoning.selector.title")}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {CHAT_REASONING_LEVELS.map((level) => {
              const selected = level === value;
              return (
                <button
                  key={level}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={[
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                    selected ? "bg-accent/10 text-accent" : "hover:bg-foreground/5",
                  ].join(" ")}
                  onClick={() => handleChange(level)}
                >
                  <span className="min-w-0 flex-1 truncate">{t(REASONING_LABEL_KEYS[level])}</span>
                  {selected && <IconCheck className="size-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
