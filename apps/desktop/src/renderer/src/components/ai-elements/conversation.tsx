/**
 * AI Elements - Conversation 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/conversation
 *
 * 简化实现：
 *  - 原版使用 `use-stick-to-bottom` 库做自动滚动 + 手动滚动按钮
 *  - 此处用 useEffect + scrollIntoView + IntersectionObserver 模拟
 *  - 视觉风格尽量贴近原版，主题用项目自身的 oklch 变量
 *
 * 数据流：
 *  - Conversation           → 外层容器，负责滚动行为
 *  - ConversationContent    → 内部 flex 列布局
 *  - ConversationEmptyState → 空态展示
 *  - ConversationScrollButton → 非底部时显示的"跳到底部"按钮
 */
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { IconArrowDown } from "../icons";

export function Conversation({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoStick, setAutoStick] = useState(true);

  /**
   * 监听用户滚动：用户主动向上滚动时取消自动吸附；
   * 接近底部时恢复自动吸附。
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleScroll = (): void => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      // 阈值 32px：贴近底部即视为"已读最新"
      setAutoStick(distance < 32);
    };
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => node.removeEventListener("scroll", handleScroll);
  }, []);

  /** 子树变化时（流式新增 token）自动贴底 */
  useEffect(() => {
    if (!autoStick) return;
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [autoStick, children]);

  return (
    <div
      ref={containerRef}
      data-slot="conversation"
      className={cn(
        "relative flex-1 overflow-y-auto",
        "scroll-smooth",
        // 项目全局滚动条样式
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ConversationContent({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="conversation-content"
      // 容器在 ≤1400px 屏上几乎填满；更大屏则居中。padding 收紧到 px-3 / sm:px-4。
      className={cn(
        "mx-auto flex w-full max-w-[min(1400px,100%)] flex-col gap-6 px-3 py-8 sm:px-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface ConversationEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

/**
 * 空态展示：当 messages.length === 0 时使用
 */
export function ConversationEmptyState({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}: ConversationEmptyStateProps): React.JSX.Element {
  return (
    <div
      data-slot="conversation-empty"
      className={cn(
        "mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
      {...rest}
    >
      {icon ? <div className="text-foreground/40 [&_svg]:size-10">{icon}</div> : null}
      {title ? <p className="text-base font-medium text-foreground/80">{title}</p> : null}
      {description ? (
        <p className="text-sm leading-relaxed text-foreground/45">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  className,
  ...rest
}: HTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const container = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 找到外层 Conversation 容器
    const node = document.querySelector<HTMLElement>('[data-slot="conversation"]');
    container.current = node;
    if (!node) return;
    const update = (): void => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setVisible(distance > 200);
    };
    node.addEventListener("scroll", update, { passive: true });
    update();
    return () => node.removeEventListener("scroll", update);
  }, []);

  const scrollToBottom = (): void => {
    const node = container.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  if (!visible) return <></>;

  return (
    <button
      type="button"
      aria-label="跳到最新消息"
      onClick={scrollToBottom}
      className={cn(
        "absolute bottom-4 left-1/2 z-10 -translate-x-1/2",
        "flex size-8 items-center justify-center rounded-full",
        "border border-foreground/15 bg-background/90 shadow-lg backdrop-blur",
        "text-foreground/70 transition hover:bg-background hover:text-foreground",
        className,
      )}
      {...rest}
    >
      <IconArrowDown className="size-4" />
    </button>
  );
}
