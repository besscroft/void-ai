import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@heroui/react";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { IconArrowUp } from "./icons";
import { useT } from "../lib/i18n";

interface MessageInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
}

export function MessageInput({
  isLoading,
  onSend,
  selectedModel,
  selectedAgentId,
  onModelChange,
  onAgentChange,
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
    const maxHeight = 152;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 64)}px`;
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
    <div className="shrink-0 bg-background/70 px-4 pb-3 pt-2 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-4xl">
        <div
          className={[
            "rounded-[24px] border bg-background/95 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.65)] transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            modelSelected ? "border-foreground/15" : "border-warning/35",
          ].join(" ")}
        >
          <div className="px-4 pb-2 pt-4">
            <textarea
              ref={textareaRef}
              className="block max-h-[152px] min-h-16 w-full resize-none overflow-hidden bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-foreground/35 disabled:cursor-not-allowed disabled:opacity-70"
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
                className="mt-2 inline-flex max-w-full rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              >
                {t("input.noModel")}
              </p>
            )}
          </div>

          <div className="flex min-h-11 flex-wrap items-center justify-between gap-1.5 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <AgentSelector value={selectedAgentId} onChange={onAgentChange} placement="top" />
              <ModelSelector value={selectedModel} onChange={onModelChange} placement="top" />
            </div>

            <Button
              type="button"
              isIconOnly
              size="sm"
              variant={canSend ? "primary" : "secondary"}
              className={[
                "size-8 min-w-8 shrink-0 rounded-xl transition",
                canSend ? "shadow-lg shadow-accent/20" : "opacity-70",
              ].join(" ")}
              onPress={submit}
              isDisabled={!canSend}
              aria-label={t("input.send")}
            >
              <IconArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
