/**
 * 消息列表
 *
 * 负责：
 *  - 渲染消息气泡、reasoning（思维链）、tool、source、附件
 *  - 提供每条消息的 hover 动作条：复制 / 编辑 / 重新发送 / 删除
 *  - 编辑态：把消息气泡替换为 EditableMessage
 *  - 错误展示与重试
 *
 * 与 ChatView 的契约：
 *  - onEditMessage(messageId, newText)  把指定 user 消息改为 newText，
 *    并触发后续 assistant 的重新生成
 *  - onResendMessage(messageId)  从该 user 消息开始重新生成
 *  - onDeleteMessage(messageId)  删除该消息；如果删的是 user 消息，
 *    紧跟其后的 assistant 消息也会被一并删除（保持角色交替）
 */
import { Fragment, useState, type ReactNode } from "react";
import type { UIMessage } from "ai";
import {
  ChainOfThought,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  EditableMessage,
  Message,
  MessageActions,
  MessageAttachments,
  MessageContent,
  MessageResponse,
  PromptSuggestions,
  QuickReactions,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type FilePartLike,
  type ToolState,
} from "./ai-elements";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { IconCopy } from "./icons";

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error;
  errorDetail?: string | null;
  /** 后备建议（empty 状态） */
  emptySuggestions?: string[];
  onRetry?: () => void;
  onDismissError?: () => void;
  /** 用户消息编辑回调：编辑后重新发送 */
  onEditMessage?: (messageId: string, newText: string) => Promise<void> | void;
  /** 用户消息重新发送回调 */
  onResendMessage?: (messageId: string) => Promise<void> | void;
  /** 消息删除回调 */
  onDeleteMessage?: (messageId: string) => void;
  /** 建议被点击时 */
  onSuggestion?: (prompt: string) => void;
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
  emptySuggestions,
  onRetry,
  onDismissError,
  onEditMessage,
  onResendMessage,
  onDeleteMessage,
  onSuggestion,
}: MessageListProps): React.JSX.Element {
  const { t } = useT();

  if (messages.length === 0 && !isLoading) {
    return (
      <Conversation>
        <ConversationContent>
          {emptySuggestions && emptySuggestions.length > 0 && onSuggestion ? (
            <ConversationEmptyState title={t("msg.empty.title")} description={t("msg.empty.desc")}>
              <PromptSuggestions
                title={t("chat.suggestions.title")}
                suggestions={emptySuggestions}
                onSelect={onSuggestion}
                className="mt-4 w-full"
              />
            </ConversationEmptyState>
          ) : (
            <ConversationEmptyState
              title={t("msg.empty.title")}
              description={t("msg.empty.desc")}
            />
          )}
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent>
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            isLastMessage={index === messages.length - 1}
            isStreaming={isLoading}
            onEdit={onEditMessage}
            onResend={onResendMessage}
            onDelete={onDeleteMessage}
          />
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

/* ---------- 单条消息 ---------- */

interface MessageItemProps {
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
  onEdit?: (messageId: string, newText: string) => Promise<void> | void;
  onResend?: (messageId: string) => Promise<void> | void;
  onDelete?: (messageId: string) => void;
}

/**
 * 单条消息容器
 *  - 渲染 Message（外壳）+ MessageContent（气泡）+ MessageActions（操作条）
 *  - 操作条放在气泡下方，hover 时浮现
 *  - 编辑态：整个替换为 EditableMessage
 */
function MessageItem({
  message,
  isLastMessage,
  isStreaming,
  onEdit,
  onResend,
  onDelete,
}: MessageItemProps): React.JSX.Element {
  const { t, f } = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const parts = message.parts ?? [];
  const messageStreaming = isLastMessage && isStreaming;
  const reasoningParts = parts.filter(isReasoningPart);
  const reasoningText = reasoningParts.map((part) => part.text).join("\n\n");
  const lastPart = parts.at(-1);
  const isReasoningStreaming = messageStreaming && lastPart?.type === "reasoning";
  const fileParts = parts.filter(isAttachmentPart) as unknown as FilePartLike[];
  const sourceParts = parts.filter(isSourcePart);
  const imageParts = fileParts.filter((p) => (p.mediaType ?? "").startsWith("image/"));
  const textParts = parts.filter(isTextPart).map((part) => part.text);
  const fullText = textParts.join("\n\n");
  const isUser = message.role === "user";
  // 是否允许 hover 动作（仅在非流式中）
  const actionsEnabled = !messageStreaming;

  /* ---------- 复制 ---------- */
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

  /* ---------- 进入编辑态 ---------- */
  const startEdit = (): void => {
    if (isUser) {
      setEditValue(fullText);
      setEditing(true);
    }
  };

  const cancelEdit = (): void => {
    setEditing(false);
    setEditValue("");
  };

  /* ---------- 保存编辑：调用 onEdit 回调 ---------- */
  const handleEditSave = async (): Promise<void> => {
    if (!onEdit) return;
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === fullText) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await onEdit(message.id, trimmed);
      setEditing(false);
      setEditValue("");
    } catch (err) {
      console.error("[chat] edit failed:", err);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 重新发送：仅 user 消息 ---------- */
  const handleResend = async (): Promise<void> => {
    if (!onResend || !isUser) return;
    try {
      await onResend(message.id);
    } catch (err) {
      console.error("[chat] resend failed:", err);
    }
  };

  /* ---------- 删除：user 同时删除紧跟其后的 assistant ---------- */
  const handleDelete = (): void => {
    if (!onDelete) return;
    onDelete(message.id);
  };

  /* ---------- 编辑态：替换为 EditableMessage（无操作条） ---------- */
  if (editing && isUser) {
    return (
      <Message from={message.role}>
        <EditableMessage
          value={editValue}
          onChange={setEditValue}
          onSave={handleEditSave}
          onCancel={cancelEdit}
          isSaving={saving}
        />
      </Message>
    );
  }

  return (
    <Message from={message.role}>
      {/* 气泡本体：思维链、附件、各类 part */}
      <MessageContent data-from={message.role}>
        {(reasoningParts.length > 0 || sourceParts.length > 0 || imageParts.length > 0) && (
          <ChainOfThought
            defaultOpen={isReasoningStreaming}
            title={isReasoningStreaming ? t("msg.cot.reasoningActive") : t("msg.cot.reasoning")}
          >
            {reasoningParts.length > 0 ? (
              <ChainOfThoughtStep
                icon="think"
                status={isReasoningStreaming ? "active" : "complete"}
                label={isReasoningStreaming ? t("msg.cot.thinking") : t("msg.cot.reasoned")}
                description={
                  reasoningText
                    ? t("msg.cot.chars", { count: f.number(reasoningText.length) })
                    : undefined
                }
              />
            ) : null}

            {sourceParts.length > 0 ? (
              <ChainOfThoughtStep
                icon="search"
                status="complete"
                label={t("msg.cot.search", { count: f.number(sourceParts.length) })}
              >
                <ChainOfThoughtSearchResults>
                  {sourceParts.map((source) => {
                    const label =
                      source.type === "source-url" ? source.title || source.url : source.title;
                    const key = source.type + "-" + source.sourceId;
                    return (
                      <ChainOfThoughtSearchResult
                        key={key}
                        href={source.type === "source-url" ? source.url : undefined}
                        title={label}
                        description={
                          source.type === "source-url" ? source.url : t("msg.cot.document")
                        }
                      />
                    );
                  })}
                </ChainOfThoughtSearchResults>
              </ChainOfThoughtStep>
            ) : null}

            {imageParts.length > 0 ? (
              <ChainOfThoughtStep
                icon="image"
                status="complete"
                label={t("msg.cot.image", { count: f.number(imageParts.length) })}
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {imageParts.map((p, i) => (
                    <ChainOfThoughtImage
                      key={i}
                      src={p.url || p.data || ""}
                      alt={p.filename || t("msg.cot.imageAlt")}
                    />
                  ))}
                </div>
              </ChainOfThoughtStep>
            ) : null}
          </ChainOfThought>
        )}

        {fileParts.length > 0 && <MessageAttachments parts={fileParts} />}

        {parts.map((part, index) => {
          const key = message.id + "-" + index;
          if (
            part.type === "reasoning" ||
            part.type === "reasoning-file" ||
            part.type === "source-url" ||
            part.type === "source-document" ||
            part.type === "step-start" ||
            part.type === "custom" ||
            part.type.startsWith("data-")
          ) {
            return <Fragment key={key} />;
          }

          if (part.type === "file") {
            return <Fragment key={key} />;
          }

          if (part.type === "text") {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }

          if (isToolPart(part)) {
            const state = normalizeToolState(part.state);
            return (
              <Tool
                key={key}
                defaultOpen={state === "output-available" || state === "output-error"}
              >
                <ToolHeader
                  type={part.type}
                  toolName={part.type === "dynamic-tool" ? part.toolName : undefined}
                  title={part.title}
                  state={state}
                />
                <ToolContent>
                  <ToolInput input={part.input} />
                  <ToolOutput
                    output={renderToolOutput(part.output, t("tool.unserializable"))}
                    errorText={part.errorText}
                  />
                </ToolContent>
              </Tool>
            );
          }

          return <Fragment key={key} />;
        })}
      </MessageContent>

      {/* 操作条：放在气泡下方，hover 时浮现（仅气泡外的小行） */}
      {actionsEnabled && fullText && (
        <MessageActions
          placement={isUser ? "left" : "right"}
          onCopy={handleCopy}
          onEdit={isUser && onEdit ? startEdit : undefined}
          onResend={isUser && onResend ? handleResend : undefined}
          onDelete={onDelete ? handleDelete : undefined}
        />
      )}

      {message.role === "assistant" && !messageStreaming && copyState === "copied" && (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-success">
          <IconCopy className="size-2.5" />
          {t("msg.copied")}
        </span>
      )}

      {message.role === "assistant" && !messageStreaming && (
        <QuickReactions
          onReact={(emoji) => {
            console.log("[chat] reaction:", emoji);
            notify.success(emoji);
          }}
          placement="top-right"
        />
      )}
    </Message>
  );
}

/* ---------- 类型守卫 ---------- */

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

function renderToolOutput(output: unknown, unserializableLabel: string): ReactNode {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string" || typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  return (
    <pre className="m-0 whitespace-pre-wrap font-mono">
      {safeJsonStringify(output, unserializableLabel)}
    </pre>
  );
}

function safeJsonStringify(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}
