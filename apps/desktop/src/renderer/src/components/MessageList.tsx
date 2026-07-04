import { Fragment, type ReactNode } from "react";
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
} from "./ai-elements";
import { useT } from "../lib/i18n";

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
            <MessageParts
              message={message}
              isLastMessage={index === messages.length - 1}
              isStreaming={isLoading}
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
}

function MessageParts({
  message,
  isLastMessage,
  isStreaming,
}: MessagePartsProps): React.JSX.Element {
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning") as Array<{
    type: "reasoning";
    text: string;
    state?: "streaming" | "done";
  }>;
  const reasoningText = reasoningParts.map((p) => p.text).join("\n\n");
  const hasReasoning = reasoningParts.length > 0;
  const lastPart = message.parts.at(-1);
  const isReasoningStreaming = isLastMessage && isStreaming && lastPart?.type === "reasoning";

  return (
    <>
      {hasReasoning && (
        <Reasoning isStreaming={isReasoningStreaming} defaultOpen={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningText}</ReasoningContent>
        </Reasoning>
      )}

      {message.parts.map((part, i) => {
        if (part.type === "reasoning") return null;

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
    </>
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
