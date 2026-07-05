/**
 * AI Elements - QuickReactions 组件
 *
 * 设计目标：
 *  - 消息气泡 hover 时浮现的表情反应条（6 个常用 emoji）
 *  - 点击 emoji 触发 onReact 回调
 *  - 不可见时使用 display:none 而非条件渲染，避免布局抖动
 *
 * 视觉：
 *  - 绝对定位悬浮在消息气泡上方/下方
 *  - 玻璃拟态：半透明背景 + backdrop-blur + 圆角 + 阴影
 *  - 入场动画：scale + fade
 *
 * 用法：
 *   <QuickReactions onReact={(emoji) => console.log(emoji)} />
 */
import { useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";

/** 6 个常用反应 emoji（按使用频次排序） */
export const DEFAULT_REACTIONS: readonly string[] = ["👍", "❤️", "🎉", "😂", "🤔", "🔥"];

interface QuickReactionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  onReact: (emoji: string) => void;
  /** 自定义反应列表 */
  reactions?: readonly string[];
  /** 贴附位置：消息气泡的相对位置 */
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

const PLACEMENT_CLASS: Record<NonNullable<QuickReactionsProps["placement"]>, string> = {
  "top-right": "-top-3 right-3",
  "top-left": "-top-3 left-3",
  "bottom-right": "-bottom-3 right-3",
  "bottom-left": "-bottom-3 left-3",
};

export function QuickReactions({
  onReact,
  reactions = DEFAULT_REACTIONS,
  placement = "top-right",
  className,
  ...rest
}: QuickReactionsProps): React.JSX.Element {
  const { t } = useT();
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      data-slot="quick-reactions"
      data-placement={placement}
      role="toolbar"
      aria-label={t("ai.quickReactions.toolbar")}
      className={cn(
        "absolute z-10 flex items-center gap-0.5 rounded-full",
        "border border-foreground/10 bg-background/85 px-1 py-0.5 shadow-lg backdrop-blur",
        "opacity-0 transition-all duration-150",
        // 当父元素 hover 时显示（通过 group 机制在 Message 容器上控制）
        "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        "scale-95 group-hover/msg:scale-100 group-focus-within/msg:scale-100",
        PLACEMENT_CLASS[placement],
        className,
      )}
      onMouseDown={(e) => e.stopPropagation()}
      {...rest}
    >
      {reactions.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReact(emoji);
          }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          aria-label={t("ai.quickReactions.reactWith", { emoji })}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-base transition",
            "hover:bg-foreground/10",
            hovered === i ? "scale-110" : "scale-100",
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
