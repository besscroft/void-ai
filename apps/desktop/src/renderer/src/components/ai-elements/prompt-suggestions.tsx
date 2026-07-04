/**
 * AI Elements - PromptSuggestions 组件
 *
 * 设计目标：
 *  - 在空态（无消息）时提供建议 prompt
 *  - 点击建议自动填充到输入框或直接发送
 *  - 视觉上：水平排列的 chip 式按钮，带 hover 动效
 *
 * 用法：
 *   <PromptSuggestions
 *     suggestions={["解释量子计算", "写一首诗", ...]}
 *     onSelect={(s) => setInput(s)}
 *   />
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { IconArrowUp } from "../icons";

interface PromptSuggestionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  /** 标题（可选） */
  title?: string;
}

export function PromptSuggestions({
  suggestions,
  onSelect,
  title,
  className,
  ...rest
}: PromptSuggestionsProps): React.JSX.Element {
  if (suggestions.length === 0) return <></>;

  return (
    <div
      data-slot="prompt-suggestions"
      className={cn("flex w-full flex-col items-start gap-2", className)}
      {...rest}
    >
      {title && (
        <p className="px-1 text-xs font-medium uppercase tracking-wider text-foreground/40">
          {title}
        </p>
      )}
      <div className="flex w-full flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "group/sug flex items-center gap-2 rounded-full border border-foreground/10 bg-background/60 px-3 py-1.5 text-left text-xs text-foreground/75",
              "transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/5 hover:text-foreground",
              "active:translate-y-0",
            )}
          >
            <span className="line-clamp-1 max-w-[280px]">{s}</span>
            <IconArrowUp
              className={cn(
                "size-3 -rotate-45 text-foreground/30 transition",
                "group-hover/sug:text-accent",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
