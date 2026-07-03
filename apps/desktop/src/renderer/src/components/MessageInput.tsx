import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@heroui/react";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { IconArrowUp, IconSliders } from "./icons";
import { useT } from "../lib/i18n";

interface MessageInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
  modelParametersLabel: string;
}

export function MessageInput({
  isLoading,
  onSend,
  selectedModel,
  selectedAgentId,
  onModelChange,
  onAgentChange,
  modelParametersLabel,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelSelected = !!selectedModel;
  const canSend = value.trim().length > 0 && !isLoading && modelSelected;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const maxHeight = 176;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 80)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  const submit = (): void => {
    if (!canSend) return;
    const text = value.trim();
    setValue("");
    onSend(text);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-foreground/10 bg-background/70 px-4 pb-4 pt-3 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-4xl">
        <div
          className={[
            "rounded-[28px] border bg-background/95 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.65)] transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            modelSelected ? "border-foreground/15" : "border-warning/35",
          ].join(" ")}
        >
          <div className="px-5 pb-3 pt-5">
            <textarea
              ref={textareaRef}
              className="block max-h-44 min-h-20 w-full resize-none overflow-hidden bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-foreground/35 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder={isLoading ? t("input.generating") : t("input.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading}
              aria-label={t("input.placeholder")}
              aria-describedby={!modelSelected ? "message-input-model-warning" : undefined}
            />
            {!modelSelected && (
              <p
                id="message-input-model-warning"
                className="mt-3 inline-flex max-w-full rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
              >
                {t("input.noModel")}
              </p>
            )}
          </div>

          <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-t border-foreground/10 px-3 py-3 sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AgentSelector value={selectedAgentId} onChange={onAgentChange} placement="top" />
              <ModelSelector value={selectedModel} onChange={onModelChange} placement="top" />
              <span
                className="inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.025] px-3 text-xs font-medium text-foreground/60"
                title={modelParametersLabel}
              >
                <IconSliders className="size-3.5 shrink-0" />
                <span className="truncate">{modelParametersLabel}</span>
              </span>
            </div>

            <Button
              type="button"
              isIconOnly
              size="sm"
              variant={canSend ? "primary" : "secondary"}
              className={[
                "size-10 shrink-0 rounded-2xl transition",
                canSend ? "shadow-lg shadow-accent/20" : "opacity-70",
              ].join(" ")}
              onPress={submit}
              isDisabled={!canSend}
              aria-label={t("input.send")}
            >
              <IconArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
