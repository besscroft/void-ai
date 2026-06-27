import { useState, type KeyboardEvent } from "react";
import { IconSend } from "./icons";
import { useT } from "../lib/i18n";

interface MessageInputProps {
  /** 是否正在生成中（禁用发送） */
  isLoading: boolean;
  /** 发送回调 */
  onSend: (text: string) => void;
  /** 当前选中的模型（null 时禁用发送并提示） */
  modelSelected: boolean;
}

/**
 * 消息输入框
 *
 * - Enter 发送，Shift+Enter 换行
 * - 文本为空或正在生成时禁用发送
 * - 未选模型时给出提示
 */
export function MessageInput({
  isLoading,
  onSend,
  modelSelected,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [value, setValue] = useState("");

  const canSend = value.trim().length > 0 && !isLoading && modelSelected;

  const submit = (): void => {
    if (!canSend) return;
    const text = value.trim();
    setValue("");
    onSend(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter 发送（不带 Shift），Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-foreground/10 bg-background/50 p-4 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {!modelSelected && (
          <p className="mb-2 text-center text-xs text-warning">{t("input.noModel")}</p>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-foreground/15 bg-background px-3 py-2 focus-within:border-accent/50">
          <textarea
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
            placeholder={isLoading ? t("input.generating") : t("input.placeholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
            aria-label={t("input.placeholder")}
          />
          <button
            type="button"
            className={[
              "flex size-8 shrink-0 items-center justify-center rounded-full transition",
              canSend
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "bg-foreground/10 text-foreground/40",
            ].join(" ")}
            onClick={submit}
            disabled={!canSend}
            aria-label={t("input.send")}
          >
            <IconSend className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
