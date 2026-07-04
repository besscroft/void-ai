import { Fragment, useState, type ReactNode } from "react";
import type { UIMessage } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Message,
  MessageContent,
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

type MessagePart = UIMessage["parts"][number];
type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
type SourcePart = Extract<MessagePart, { type: "source-url" | "source-document" }>;

interface RenderableToolPart {
  type: string;
  toolName?: string;
  title?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function MessageList({
  messages,
  isLoading,
  error,
  errorDetail,
  onRetry,
  onDismissError,
}: MessageListProps): React.JSX.Element {
  const { t } = useT();

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
            <MessageContent data-from={message.role}>
              <MessageParts
                message={message}
                isLastMessage={index === messages.length - 1}
                isStreaming={isLoading}
                onReact={handleReaction}
              />
            </MessageContent>
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
  const parts = message.parts ?? [];
  const messageStreaming = isLastMessage && isStreaming;
  const reasoningParts = parts.filter(isReasoningPart);
  const reasoningText = reasoningParts.map((part) => part.text).join("\n\n");
  const lastPart = parts.at(-1);
  const isReasoningStreaming = messageStreaming && lastPart?.type === "reasoning";
  const fileParts = parts.filter(isAttachmentPart) as unknown as FilePartLike[];
  const sourceParts = parts.filter(isSourcePart);
  const textParts = parts.filter(isTextPart).map((part) => part.text);
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
      {reasoningParts.length > 0 && (
        <Reasoning isStreaming={isReasoningStreaming} defaultOpen={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningText}</ReasoningContent>
        </Reasoning>
      )}

      {fileParts.length > 0 && <MessageAttachments parts={fileParts} />}
      {sourceParts.length > 0 && <SourceList sources={sourceParts} />}

      {parts.map((part, index) => {
        const key = message.id + "-" + index;
        if (
          part.type === "reasoning" ||
          part.type === "reasoning-file" ||
          part.type === "file" ||
          part.type === "source-url" ||
          part.type === "source-document" ||
          part.type === "step-start" ||
          part.type === "custom" ||
          part.type.startsWith("data-")
        ) {
          return <Fragment key={key} />;
        }

        if (part.type === "text") {
          return <MessageResponse key={key}>{part.text}</MessageResponse>;
        }

        if (isToolPart(part)) {
          const state = normalizeToolState(part.state);
          return (
            <Tool key={key} defaultOpen={state === "output-available" || state === "output-error"}>
              <ToolHeader
                type={part.type}
                toolName={part.type === "dynamic-tool" ? part.toolName : undefined}
                title={part.title}
                state={state}
              />
              <ToolContent>
                <ToolInput input={part.input} />
                <ToolOutput output={renderToolOutput(part.output)} errorText={part.errorText} />
              </ToolContent>
            </Tool>
          );
        }

        return <Fragment key={key} />;
      })}

      {message.role === "assistant" && fullText && !messageStreaming && (
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

      {message.role === "assistant" && !messageStreaming && (
        <QuickReactions onReact={onReact} placement="top-right" />
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: SourcePart[] }): React.JSX.Element {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
      {sources.map((source) => {
        const label = source.type === "source-url" ? source.title || source.url : source.title;
        const key = source.type + "-" + source.sourceId;
        if (source.type === "source-url") {
          return (
            <a
              key={key}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-foreground/70 underline-offset-2 hover:underline"
            >
              {label}
            </a>
          );
        }
        return (
          <span
            key={key}
            className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-foreground/70"
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function isTextPart(part: MessagePart): part is Extract<MessagePart, { type: "text" }> {
  return part.type === "text";
}

function isReasoningPart(part: MessagePart): part is ReasoningPart {
  return part.type === "reasoning";
}

function isSourcePart(part: MessagePart): part is SourcePart {
  return part.type === "source-url" || part.type === "source-document";
}

function isAttachmentPart(part: MessagePart): boolean {
  return part.type === "file" || part.type === "reasoning-file";
}

function isToolPart(part: MessagePart): part is MessagePart & RenderableToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
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

function renderToolOutput(output: unknown): ReactNode {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string" || typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  return <pre className="m-0 whitespace-pre-wrap font-mono">{safeJsonStringify(output)}</pre>;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function handleReaction(emoji: string): void {
  console.log("[chat] reaction:", emoji);
  notify.success(emoji);
}
