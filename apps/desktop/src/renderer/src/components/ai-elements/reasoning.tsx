/**
 * AI Elements - Reasoning 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/reasoning
 *
 * 简化实现：
 *  - 原版基于 Radix Collapsible
 *  - 此处用 HTML5 <details>/<summary> 实现：浏览器原生，无依赖
 *  - isStreaming 时自动展开（defaultOpen），结束后保持当前状态
 *
 * 数据流（与 AI Elements 兼容）：
 *  <Reasoning isStreaming={isReasoningStreaming}>
 *    <ReasoningTrigger />  ← 显示 "Thinking..." 或 "Thought for Xs"
 *    <ReasoningContent>{text}</ReasoningContent>
 *  </Reasoning>
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { IconBrain, IconChevronDown, IconDots } from "../icons";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoningContext(): ReasoningContextValue {
  const ctx = useContext(ReasoningContext);
  if (!ctx) {
    throw new Error("Reasoning components must be used inside <Reasoning>");
  }
  return ctx;
}

interface ReasoningProps extends HTMLAttributes<HTMLDetailsElement> {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
  children?: ReactNode;
}

/**
 * 推理容器（HTML5 <details>）
 * - isStreaming 时强制 defaultOpen=true，便于用户看到流式输出
 * - 结束后由用户自由折叠
 */
export function Reasoning({
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  className,
  children,
  ...rest
}: ReasoningProps): React.JSX.Element {
  // duration 计时：组件挂载开始，isStreaming 变 false 时冻结
  const startRef = useRef<number>(Date.now());
  const [duration, setDuration] = useState<number>(durationProp ?? 0);
  const [internalOpen, setInternalOpen] = useState<boolean>(defaultOpen ?? isStreaming);

  useEffect(() => {
    if (isStreaming) {
      startRef.current = Date.now();
      // 计时器：每秒更新一次
      const timer = window.setInterval(() => {
        setDuration(Math.round((Date.now() - startRef.current) / 1000));
      }, 1000);
      return () => window.clearInterval(timer);
    }
    setDuration(Math.round((Date.now() - startRef.current) / 1000));
    return undefined;
  }, [isStreaming]);

  const isOpen = open ?? internalOpen;
  const setIsOpen = (next: boolean): void => {
    if (onOpenChange) onOpenChange(next);
    if (open === undefined) setInternalOpen(next);
  };

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, duration }}>
      <details
        data-slot="reasoning"
        data-streaming={isStreaming ? "true" : "false"}
        open={isOpen}
        onToggle={(e) => setIsOpen((e.currentTarget as HTMLDetailsElement).open)}
        className={cn("rounded-xl border border-foreground/10 bg-foreground/[0.03]", className)}
        {...rest}
      >
        {children}
      </details>
    </ReasoningContext.Provider>
  );
}

interface ReasoningTriggerProps extends HTMLAttributes<HTMLElement> {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
}

export function ReasoningTrigger({
  getThinkingMessage,
  className,
  children,
  ...rest
}: ReasoningTriggerProps): React.JSX.Element {
  const { isStreaming, duration } = useReasoningContext();
  const message =
    getThinkingMessage?.(isStreaming, duration) ??
    (isStreaming ? "Thinking..." : `Thought for ${duration}s`);

  return (
    <summary
      data-slot="reasoning-trigger"
      className={cn(
        "flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-foreground/65",
        "[&::-webkit-details-marker]:hidden",
        "hover:text-foreground/90",
        className,
      )}
      {...(rest as HTMLAttributes<HTMLElement>)}
    >
      {isStreaming ? (
        <IconDots className="size-3.5 animate-pulse text-accent" />
      ) : (
        <IconBrain className="size-3.5" />
      )}
      <span className="flex-1 truncate">{message}</span>
      <IconChevronDown
        className={cn("size-3.5 transition-transform", "[details[open]_&]:rotate-180")}
      />
      {children}
    </summary>
  );
}

interface ReasoningContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function ReasoningContent({
  className,
  children,
  ...rest
}: ReasoningContentProps): React.JSX.Element {
  return (
    <div
      data-slot="reasoning-content"
      className={cn(
        "border-t border-foreground/10 px-3 py-2.5 text-xs leading-relaxed text-foreground/75",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 拿到 reasoning 上下文（用于业务层在流式时调整 UI）
 */
export function useReasoning(): ReasoningContextValue {
  return useReasoningContext();
}
