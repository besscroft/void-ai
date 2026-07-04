import { Fragment, useState, type ReactNode } from "react";
import type { UIMessage } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Message,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolState,
  QuickReactions,
  MessageAttachments,
  type FilePartLike,
} from "./ai-elements";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { IconCopy } from "./icons";

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error;
  errorDetail?: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}

export function MessageList({
  messages,
  isLoading,
  error,
  errorDetail,
  onRetry,
  onDismissError,
}: MessageListProps): React.JSX.Element {
  const { t, locale } = useT();

  if (messages.length === 0 && !isLoading) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState title={t("msg.empty.title")} description={t("msg.empty.desc")} />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent>
        {messages.map((message, index) => (
          <Message key={message.id} from={message.role}>
            <MessageParts
              message={message}
              isLastMessage={index === messages.length - 1}
              isStreaming={isLoading}
              onReact={(emoji) => handleReaction(emoji, locale)}
            />
          </Message>
        ))}

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-medium">{t("msg.error.title")}</p>
            <p className="mt-1 leading-relaxed opacity-85">{errorDetail || error.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md border border-danger/30 bg-background/70 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-background"
                >
                  {t("common.retry")}
                </button>
              )}
              {onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-danger/75 transition hover:bg-danger/10"
                >
                  {t("common.close")}
                </button>
              )}
            </div>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

interface MessagePartsProps {
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
  /** 表情反应回调（由父组件统一处理，例如写入本地记忆） */
  onReact: (emoji: string) => void;
}

function MessageParts({
  message,
  isLastMessage,
  isStreaming,
  onReact,
}: MessagePartsProps): React.JSX.Element {
  const { t } = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const reasoningParts = message.parts.filter((part) => part.type === "reasoning") as Array<{
    type: "reasoning";
    text: string;
    state?: "streaming" | "done";
  }>;
  const reasoningText = reasoningParts.map((p) => p.text).join("\n\n");
  const hasReasoning = reasoningParts.length > 0;
  const lastPart = message.parts.at(-1);
  const isReasoningStreaming = isLastMessage && isStreaming && lastPart?.type === "reasoning";

  // 收集 file 类型 part（用于 MessageAttachments 渲染）
  const fileParts = message.parts.filter((p) => p.type === "file") as unknown as FilePartLike[];

  // 收集纯文本（用于复制）
  const textParts = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text);
  const fullText = textParts.join("\n\n");

  const handleCopy = async (): Promise<void> => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyState("copied");
      notify.success(t("msg.copied"));
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      console.error("[chat] copy failed:", err);
    }
  };

  return (
    <div className="group/msg relative w-full">
      {hasReasoning && (
        <Reasoning isStreaming={isReasoningStreaming} defaultOpen={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningText}</ReasoningContent>
        </Reasoning>
      )}

      {fileParts.length > 0 && <MessageAttachments parts={fileParts} />}

      {message.parts.map((part, i) => {
        if (part.type === "reasoning") return null;
        if (part.type === "file") return null; // 已由 MessageAttachments 处理

        if (part.type === "text") {
          return <MessageResponse key={`${message.id}-${i}`}>{part.text}</MessageResponse>;
        }

        if (part.type.startsWith("tool-")) {
          const tool = part as unknown as {
            type: string;
            state?: string;
            input?: unknown;
            output?: unknown;
            errorText?: string;
            toolCallId?: string;
          };
          const state = normalizeToolState(tool.state);
          return (
            <Tool
              key={`${message.id}-${i}`}
              defaultOpen={state === "output-available" || state === "output-error"}
            >
              <ToolHeader type={tool.type} state={state} />
              <ToolContent>
                <ToolInput input={tool.input} />
                <ToolOutput output={tool.output as ReactNode} errorText={tool.errorText} />
              </ToolContent>
            </Tool>
          );
        }

        return <Fragment key={`${message.id}-${i}`} />;
      })}

      {/* 创意交互：消息底部 hover 出现的复制 + 表情反应条 */}
      {message.role === "assistant" && fullText && !isStreaming && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={t("msg.copy")}
            title={t("msg.copy")}
            className="flex size-6 items-center justify-center rounded text-foreground/40 transition hover:bg-foreground/10 hover:text-foreground"
          >
            <IconCopy className="size-3" />
          </button>
          {copyState === "copied" && (
            <span className="text-[10px] text-success">{t("msg.copied")}</span>
          )}
        </div>
      )}

      {/* QuickReactions 浮在气泡右上角，hover 时显示 */}
      {message.role === "assistant" && !isStreaming && (
        <QuickReactions onReact={onReact} placement="top-right" />
      )}
    </div>
  );
}

function normalizeToolState(raw: string | undefined): ToolState {
  const known: ToolState[] = [
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
    "output-available",
    "output-error",
    "output-denied",
  ];
  return known.includes(raw as ToolState) ? (raw as ToolState) : "input-available";
}

/** 默认的表情反应处理：写入本地存储 + toast 提示 */
function handleReaction(emoji: string, _locale: string): void {
  // 此处可扩展：写入 memories / 反馈信号等
  console.log("[chat] reaction:", emoji);
  notify.success(emoji);
}
