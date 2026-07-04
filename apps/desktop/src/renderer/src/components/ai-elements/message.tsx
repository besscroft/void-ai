/**
 * AI Elements - Message 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/message
 *
 * 简化实现：
 *  - 原版有 MessageBranch / MessageResponse / MessageActions 等
 *  - 本项目只用到 Message / MessageContent / MessageResponse
 *  - MessageResponse 简化为：保留换行的轻量 markdown 渲染（**bold** * `code`）
 *    不引入 streamdown 库
 *
 * 数据流：
 *  <Message from="user|assistant">
 *    <MessageContent>
 *      <MessageResponse>{text}</MessageResponse>
 *    </MessageContent>
 *  </Message>
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type MessageRole = "user" | "assistant" | "system";

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: MessageRole;
}

/**
 * 消息外壳
 * - user: 右侧贴边，右对齐
 * - assistant: 左侧贴边，左对齐（无头像，原版由用户自添加）
 */
export function Message({ from, className, children, ...rest }: MessageProps): React.JSX.Element {
  const isUser = from === "user";
  return (
    <div
      data-slot="message"
      data-from={from}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start", className)}
      {...rest}
    >
      <div className={cn("flex max-w-[80%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        {children}
      </div>
    </div>
  );
}

interface MessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * 消息内容容器
 * - 统一气泡样式：圆角 / 内边距 / 边框
 * - user 走强调色，assistant 走中性色
 */
export function MessageContent({
  className,
  children,
  ...rest
}: MessageContentProps): React.JSX.Element {
  // 通过 data-from 区分样式：父组件已设；这里再次读取以应用 bubble 样式
  const fromAttr = (rest as { "data-from"?: string })["data-from"];
  const isUser = fromAttr === "user";
  return (
    <div
      data-slot="message-content"
      className={cn(
        "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
        isUser ? "bg-accent text-accent-foreground" : "bg-foreground/[0.06] text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface MessageResponseProps extends HTMLAttributes<HTMLDivElement> {
  children?: string;
}

/**
 * 极简 Markdown 渲染
 *
 * 支持语法（足够日常对话需要，不引入 streamdown）：
 *  - **bold**     → <strong>
 *  - *italic*     → <em>
 *  - `code`       → <code>
 *  - 行内换行     → <br>
 *  - 段落分隔（连续空行）→ 段落
 *
 * 性能：纯字符串 split + map，无递归调用。
 * 安全：仅匹配预定义模式，不解析 HTML。
 */
export function MessageResponse({
  children,
  className,
  ...rest
}: MessageResponseProps): React.JSX.Element {
  const html = children ? renderInlineMarkdown(children) : "";
  return (
    <div
      data-slot="message-response"
      className={cn("whitespace-pre-wrap break-words", className)}
      // html 是受控的 markdown 渲染结果，不含用户原始 HTML
      dangerouslySetInnerHTML={{ __html: html }}
      {...rest}
    />
  );
}

/**
 * 简化版 markdown：处理 **bold** *italic* `code` 和换行
 * 段落按空行（\n\n）切分
 */
function renderInlineMarkdown(text: string): string {
  const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const paragraphs = text.split(/\n{2,}/);
  return paragraphs
    .map((para) => {
      let p = escape(para);
      // 行内 code
      p = p.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
      // bold
      p = p.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
      // italic
      p = p.replace(/(^|[^*])\*([^*]+)\*/g, (_, pre, em) => `${pre}<em>${em}</em>`);
      // 单换行 → <br>
      p = p.replace(/\n/g, "<br>");
      return `<p>${p}</p>`;
    })
    .join("");
}
