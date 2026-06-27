import { useEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";

interface MessageListProps {
  messages: UIMessage[];
  /** 是否正在生成中（显示加载指示） */
  isLoading: boolean;
  /** 出错信息（来自 useChat.error） */
  error?: Error | null;
}

/**
 * 消息列表
 *
 * 渲染 AI SDK 5 的 UIMessage 数组。
 * UIMessage.parts 数组按类型分别渲染（目前支持 text，后续可扩展 tool/reasoning 等）。
 *
 * 布局示意：
 * ┌─────────────────────────────────────────────┐
 * │  用户头像  你好，请帮我...                       │
 * │                                             │
 * │            你好！有什么我可以帮你的？  AI 头像│
 * │                                             │
 * │  用户头像  能详细说明吗？                      │
 * │                                             │
 * │            ▌（流式光标）              AI 头像│
 * └─────────────────────────────────────────────┘
 */
export function MessageList({ messages, isLoading, error }: MessageListProps): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  // 新消息到达或流式更新时自动滚动到底部
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-foreground/40">
        <div className="mb-3 text-5xl">✦</div>
        <p className="text-lg font-medium">开始一段新对话</p>
        <p className="mt-1 text-sm">输入你的问题，AI 会在这里回应你</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 加载指示 */}
        {isLoading &&
          (messages.at(-1)?.role === "user" ? (
            <div className="mb-4 flex gap-3">
              <Avatar role="assistant" />
              <div className="flex items-center gap-1 rounded-2xl bg-foreground/5 px-4 py-3">
                <span className="size-2 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.3s]" />
                <span className="size-2 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.15s]" />
                <span className="size-2 animate-bounce rounded-full bg-foreground/40" />
              </div>
            </div>
          ) : null)}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-medium">请求失败</p>
            <p className="mt-1 opacity-80">{error.message}</p>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

/**
 * 单条消息气泡
 */
function MessageBubble({ message }: { message: UIMessage }): React.JSX.Element {
  const isUser = message.role === "user";

  return (
    <div className={["mb-4 flex gap-3", isUser ? "flex-row-reverse" : "flex-row"].join(" ")}>
      <Avatar role={message.role} />
      <div
        className={[
          "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-accent text-accent-foreground" : "bg-foreground/[0.06] text-foreground",
        ].join(" ")}
      >
        {message.parts.map((part, i) => {
          // AI SDK 5: part.type 区分文本/工具调用/推理等
          if (part.type === "text") {
            return (
              <span key={`${message.id}-${i}`} className="block">
                {part.text}
                {/* 流式光标：assistant 最后一条文本末尾 */}
                {!isUser && i === message.parts.length - 1 && (
                  <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-current align-text-bottom" />
                )}
              </span>
            );
          }
          // 其余类型（tool-call / reasoning 等）暂不渲染，后续迭代
          return null;
        })}
      </div>
    </div>
  );
}

/**
 * 头像
 */
function Avatar({ role }: { role: "user" | "assistant" | "system" }): React.JSX.Element {
  const isUser = role === "user";
  return (
    <div
      className={[
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        isUser ? "bg-accent text-accent-foreground" : "bg-foreground/10 text-foreground",
      ].join(" ")}
      aria-hidden
    >
      {isUser ? "我" : "AI"}
    </div>
  );
}
