/**
 * 消息列表
 *
 * 渲染 AI SDK 5 的 UIMessage 数组，使用 AI Elements 组件：
 *  - <Conversation>          滚动容器
 *  - <Message>               单条消息外壳
 *  - <MessageContent>        消息气泡
 *  - <MessageResponse>       正文（轻量 markdown 渲染）
 *  - <Reasoning>             推理折叠块
 *  - <Tool> / <ToolHeader> / <ToolContent> / <ToolInput> / <ToolOutput>  工具调用
 *
 * 布局示意（AI Elements 默认风格）：
 *
 *  ┌────────────────────────────────────────────────┐
 *  │                                                │
 *  │                          你好，请帮我...  [我] │  user
 *  │                                                │
 *  │  Let me think about it...                      │  assistant
 *  │   └ ▼ Thinking...                             │  reasoning（折叠）
 *  │   └ ▼ web_search  Running                      │  tool（折叠）
 *  │   Hi! What can I help you with?                │  正文
 *  │                                                │
 *  │  [Q: 你好]  [model: openai/gpt-4o]  [send ▴]   │
 *  └────────────────────────────────────────────────┘
 */
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
  /** 是否正在生成中（显示加载指示） */
  isLoading: boolean;
  /** 出错信息（来自 useChat.error） */
  error?: Error | null;
}

export function MessageList({ messages, isLoading, error }: MessageListProps): React.JSX.Element {
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

        {/* 错误提示（使用 AI Elements 风格的 banner） */}
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-medium">{t("msg.error.title")}</p>
            <p className="mt-1 opacity-80">{error.message}</p>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/**
 * 单条消息内容分发器
 *
 * AI SDK 5 的 UIMessage.parts 是一个异构数组，每个 part 都有自己的 type：
 *  - "text"        → <MessageResponse>
 *  - "reasoning"   → <Reasoning>（多段时合并展示）
 *  - "tool-xxx"    → <Tool>（state 来自 toolUIPart.state）
 *  - "source-url"  → <Source>（暂不实现，保留扩展位）
 *  - 其它          → 忽略
 */
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
  // 合并多段 reasoning 文本：AI Elements 推荐做法，避免出现多个 "Thinking..." 块
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning") as Array<{
    type: "reasoning";
    text: string;
    state?: "streaming" | "done";
  }>;
  const reasoningText = reasoningParts.map((p) => p.text).join("\n\n");
  const hasReasoning = reasoningParts.length > 0;

  // 是否处于 reasoning 仍在流式阶段：最后一条消息 + 整体仍在生成 + 最后一个 part 是 reasoning
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
        // reasoning 已在上方统一渲染，此处跳过
        if (part.type === "reasoning") return null;

        if (part.type === "text") {
          return <MessageResponse key={`${message.id}-${i}`}>{part.text}</MessageResponse>;
        }

        // tool 调用：以 "tool-" 前缀识别（AI SDK 5 标准）
        if (part.type.startsWith("tool-")) {
          // 部分类型（dynamic-tool）也走同一渲染路径
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

        // 其它 part（file / source-url / data-* 等）暂不渲染，后续按需扩展
        return <Fragment key={`${message.id}-${i}`} />;
      })}
    </>
  );
}

/**
 * 兜底：未知的 state 字符串映射到 input-available
 * AI SDK 5 的 ToolUIPart.state 枚举见 ai@5 类型定义
 */
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
