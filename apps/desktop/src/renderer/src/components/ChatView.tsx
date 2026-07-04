/**
 * ChatView
 *
 * 渲染层：把"会话"和"消息"两件事串起来
 *
 * 职责：
 *  - 加载历史消息 -> 交给 useChat
 *  - 发送：把用户消息写入 DB（pre-save）后再 sendMessage
 *  - 流式结束 -> 把最新快照写回 DB
 *  - 头部展示：对话状态徽章（流式 / 就绪 / 错误 / 停止）+ 上下文用量
 *  - 标题自动生成：首次 user + assistant 完整出现后调用 /api/title
 *  - 消息动作（Edit / Resend / Delete）由本组件实现，传递给 MessageList
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { api } from "../lib/api";
import { getChatErrorMessage } from "../lib/errors";
import {
  appendOrReplaceMessage,
  buildMessageSnapshotRows,
  buildUserMessage,
  hydrateStoredMessage,
  toFileUIParts,
} from "../lib/chat-messages";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import {
  Context,
  ConversationStatus,
  PromptSuggestions,
  type ConversationStatusKind,
  type FilePartLike,
} from "./ai-elements";
import { estimateTokens } from "./ai-elements/context";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_AGENT_ID,
  SettingKey,
  type LocalServerInfo,
} from "@shared/types";

interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo;
}

const EMPTY_STATE_SUGGESTIONS: string[] = [
  "Explain quantum computing in one sentence",
  "Help me rewrite this code in TypeScript",
  "Draft an agenda for a team weekly meeting",
  "Recommend 3 books about system design",
];

/**
 * 模型上下文窗口查找（粗略）。
 *  - 部分主流模型从已知的"厂商惯例"给默认值
 *  - 找不到则回落到 32K
 */
const CONTEXT_WINDOW_BY_MODEL: Array<{ match: RegExp; tokens: number }> = [
  { match: /^gpt-4o-mini|^gpt-4o$|^chatgpt-4o/i, tokens: 128_000 },
  { match: /^gpt-4-turbo/i, tokens: 128_000 },
  { match: /^gpt-4\b|^gpt-4-32k/i, tokens: 8_192 },
  { match: /^gpt-3\.5-turbo/i, tokens: 16_385 },
  { match: /^o1-mini|^o1-preview|^o1/i, tokens: 128_000 },
  { match: /^claude-3/i, tokens: 200_000 },
  { match: /^gemini-1\.5-pro/i, tokens: 1_000_000 },
  { match: /^gemini-1\.5-flash/i, tokens: 1_000_000 },
  { match: /^gemini-1\.0|^gemini-pro/i, tokens: 32_000 },
  { match: /^deepseek-chat|^deepseek-reasoner/i, tokens: 64_000 },
  { match: /^qwen-max|^qwen-plus/i, tokens: 32_000 },
  { match: /^qwen-turbo|^qwen-long/i, tokens: 1_000_000 },
  { match: /^glm-4-plus|^glm-4-air/i, tokens: 128_000 },
];

const DEFAULT_CONTEXT_WINDOW = 32_000;

function getContextWindowForModel(modelRef: string | null | undefined): number {
  if (!modelRef) return DEFAULT_CONTEXT_WINDOW;
  const id = modelRef.split("/").pop() ?? modelRef;
  for (const entry of CONTEXT_WINDOW_BY_MODEL) {
    if (entry.match.test(id)) return entry.tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export function ChatView({ conversationId, serverInfo }: ChatViewProps): React.JSX.Element {
  const { t, locale } = useT();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isStopped, setIsStopped] = useState(false);
  /** 是否已为本对话生成过标题（防止重复生成） */
  const titledRef = useRef<Set<string>>(new Set());
  /** 上一次发送时的消息数（用于识别"本轮回复完成"） */
  const lastSentCountRef = useRef(0);
  const createdAtRef = useRef<Map<string, number>>(new Map());
  const selectedModelRef = useRef<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const latestMessagesRef = useRef<UIMessage[]>([]);
  const hydratedConversationRef = useRef<string | null>(null);

  useEffect(() => {
    void api.settings.get(SettingKey.SelectedModel).then((model) => {
      if (model) setSelectedModel(model);
    });
    void api.settings.get(SettingKey.ActiveAgentId).then((agentId) => {
      setSelectedAgentId(agentId || DEFAULT_AGENT_ID);
    });
  }, []);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `http://127.0.0.1:${serverInfo.port}/api/chat`,
        headers: () => ({ [CHAT_SESSION_HEADER]: serverInfo.token }),
        body: () => ({
          model: selectedModelRef.current ?? undefined,
          agentId: selectedAgentIdRef.current ?? DEFAULT_AGENT_ID,
          conversationId,
        }),
      }),
    [conversationId, serverInfo.port, serverInfo.token],
  );

  useEffect(() => {
    setHistoryLoaded(false);
    setChatError(null);
    setIsStopped(false);
    createdAtRef.current = new Map();
    hydratedConversationRef.current = null;
    // 不重置 titledRef：保留跨会话记录，避免重复生成（切换回到旧对话也不重生成）
    lastSentCountRef.current = 0;

    void api.messages.list(conversationId).then((rows) => {
      const messages = rows.map(hydrateStoredMessage);
      createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
      setInitialMessages(messages);
      setHistoryLoaded(true);
      // 如果历史中已经有标题（DB 已有），标记为已生成，避免再次触发
      void api.conversations.get(conversationId).then((conv) => {
        if (conv?.title && conv.title.trim().length > 0) {
          titledRef.current.add(conversationId);
        }
      });
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: ({ messages, isError }) => {
      if (!isError) setChatError(null);
      setIsStopped(false);
      void persistMessagesSnapshot(conversationId, messages, createdAtRef.current);
      void api.conversations.touch(conversationId);
      // 自动生成标题：本轮发送了消息 + assistant 完整产生 + 还没生成过
      tryAutoTitle(conversationId, messages, lastSentCountRef.current, titledRef);
    },
    onError: (err) => {
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      console.error("[chat] streaming error:", err);
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
      notify.error(t("toast.chat.failed"), detail);
    },
  });

  latestMessagesRef.current = chat.messages;

  useEffect(() => {
    if (!historyLoaded || hydratedConversationRef.current === conversationId) return;
    chat.setMessages(initialMessages);
    hydratedConversationRef.current = conversationId;
  }, [chat, conversationId, historyLoaded, initialMessages]);

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  /* ---------- 状态映射 ---------- */
  const statusKind: ConversationStatusKind = chat.error
    ? "error"
    : isLoading
      ? chat.status === "submitted"
        ? "submitted"
        : "streaming"
      : isStopped
        ? "stopped"
        : "ready";

  /* ---------- 上下文用量（实时估算） ---------- */
  const contextMetrics = useMemo(() => {
    const usedTokens = chat.messages.reduce((sum, m) => {
      const text = (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      return sum + estimateTokens(text);
    }, 0);
    const maxTokens = getContextWindowForModel(selectedModel);
    return { usedTokens, maxTokens, costUsd: undefined as number | undefined };
  }, [chat.messages, selectedModel]);

  /* ---------- 发送 ---------- */
  const handleSend = async ({
    text,
    files,
  }: {
    text: string;
    files: FilePartLike[];
  }): Promise<void> => {
    if (!selectedModel) return;

    const messageId = crypto.randomUUID();
    const finalFiles = toFileUIParts(files);
    let userMessage: UIMessage;

    try {
      userMessage = buildUserMessage({ id: messageId, text, files: finalFiles });
    } catch {
      return;
    }

    setChatError(null);
    setIsStopped(false);
    chat.clearError();

    const pendingMessages = appendOrReplaceMessage(latestMessagesRef.current, userMessage);
    void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current).catch(
      (err) => {
        console.error("[chat] failed to pre-save user message:", err);
      },
    );
    void api.conversations.touch(conversationId);
    lastSentCountRef.current = pendingMessages.length;

    void chat.sendMessage(userMessage).catch((err) => {
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      console.error("[chat] failed to send message:", err);
      void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current);
      void api.conversations.touch(conversationId);
      notify.error(t("toast.chat.failed"), detail);
    });
  };

  const handleStop = (): void => {
    void chat.stop().finally(() => {
      setIsStopped(true);
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
    });
  };

  const handleRetry = (): void => {
    setChatError(null);
    setIsStopped(false);
    chat.clearError();
    void chat.regenerate().finally(() => {
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
    });
  };

  const handleDismissError = (): void => {
    setChatError(null);
    setIsStopped(false);
    chat.clearError();
  };

  const handleSuggestion = (suggestion: string): void => {
    if (!selectedModel) {
      notify.error(t("input.noModel"));
      return;
    }
    void handleSend({ text: suggestion, files: [] });
  };

  /* ---------- 消息动作：编辑 ---------- */
  const handleEditMessage = async (messageId: string, newText: string): Promise<void> => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    if (target.role !== "user") return;

    // 1. 找到该 user 消息，替换 text part，删除后续所有消息
    const updated: UIMessage = {
      ...target,
      parts: [
        { type: "text", text: newText },
        ...(target.parts ?? []).filter((p) => p.type !== "text"),
      ],
    };
    const nextMessages = [...chat.messages.slice(0, idx), updated];
    chat.setMessages(nextMessages);
    createdAtRef.current.delete(messageId);

    // 2. 持久化新快照（删除后续消息）
    void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 3. 触发重新生成
    lastSentCountRef.current = nextMessages.length;
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      console.error("[chat] edit regenerate failed:", err);
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      notify.error(t("toast.chat.failed"), detail);
    }
  };

  /* ---------- 消息动作：重新发送 ---------- */
  const handleResendMessage = async (messageId: string): Promise<void> => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    if (target.role !== "user") return;

    // 1. 截断到该 user 消息
    const nextMessages = chat.messages.slice(0, idx + 1);
    chat.setMessages(nextMessages);
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 2. 持久化（删除后续消息）
    void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);

    // 3. 触发重新生成
    lastSentCountRef.current = nextMessages.length;
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      console.error("[chat] resend failed:", err);
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      notify.error(t("toast.chat.failed"), detail);
    }
  };

  /* ---------- 消息动作：删除 ---------- */
  const handleDeleteMessage = (messageId: string): void => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    const confirmed = window.confirm(t("msg.delete.confirm"));
    if (!confirmed) return;

    // 1. 删除目标 + 如果目标是 user 消息，紧跟的 assistant 也一并删除
    const next = [...chat.messages];
    next.splice(idx, 1);
    if (target.role === "user" && next[idx]?.role === "assistant") {
      next.splice(idx, 1);
    }
    chat.setMessages(next);
    createdAtRef.current.delete(messageId);
    if (next[idx - 1]?.role === "user") {
      // 同步删除可能存在的 createdAt
    }

    // 2. 持久化（目标消息与可能的 assistant 同步从 DB 中删除）
    void persistMessagesSnapshot(conversationId, next, createdAtRef.current);
    notify.success(t("msg.action.delete") + " ✓");
  };

  if (!historyLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
        {t("chat.loadingHistory")}
      </div>
    );
  }

  const isEmpty = chat.messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatHeader status={statusKind} contextMetrics={contextMetrics} isLoading={isLoading} />

      {isEmpty ? (
        <EmptyState
          title={t("chat.empty.title")}
          subtitle={t("chat.empty.subtitle")}
          suggestions={EMPTY_STATE_SUGGESTIONS}
          onSuggestion={handleSuggestion}
        />
      ) : (
        <MessageList
          messages={chat.messages}
          isLoading={isLoading}
          error={chat.error}
          errorDetail={chatError}
          emptySuggestions={EMPTY_STATE_SUGGESTIONS}
          onRetry={handleRetry}
          onDismissError={handleDismissError}
          onEditMessage={handleEditMessage}
          onResendMessage={handleResendMessage}
          onDeleteMessage={handleDeleteMessage}
          onSuggestion={handleSuggestion}
        />
      )}

      <MessageInput
        isLoading={isLoading}
        onSend={handleSend}
        onStop={handleStop}
        selectedModel={selectedModel}
        selectedAgentId={selectedAgentId}
        onModelChange={setSelectedModel}
        onAgentChange={setSelectedAgentId}
      />
    </div>
  );
}

/* ---------- 头部 ---------- */

interface ChatHeaderProps {
  status: ConversationStatusKind;
  contextMetrics: {
    usedTokens: number;
    maxTokens: number;
    costUsd?: number;
  };
  isLoading: boolean;
}

function ChatHeader({ status, contextMetrics }: ChatHeaderProps): React.JSX.Element {
  return (
    <header
      className="flex shrink-0 flex-col gap-2 border-b border-foreground/10 px-5 py-3"
      data-streaming={status === "streaming" || status === "submitted"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-2 rounded-full bg-success/80 ring-2 ring-success/20"
            aria-hidden
          />
          <h1 className="text-sm font-medium text-foreground/80">Conversation</h1>
          <ConversationStatus status={status} />
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-foreground/40">
          local · loopback
        </span>
      </div>
      <Context
        metrics={contextMetrics}
        title="Context usage"
        className="border-none bg-transparent px-0 py-0"
      />
    </header>
  );
}

/* ---------- 持久化 ---------- */

async function persistMessagesSnapshot(
  conversationId: string,
  messages: UIMessage[],
  createdAtById: Map<string, number>,
): Promise<void> {
  if (messages.length === 0) return;

  const rows = buildMessageSnapshotRows({ conversationId, messages, createdAtById });
  await api.messages.saveBatch(rows);
  for (const row of rows) createdAtById.set(row.id, row.created_at);
}

/* ---------- 自动标题生成 ---------- */

/**
 * 当本轮 user + assistant 完整出现后，调用 /api/title 生成标题
 *  - 仅首次（已生成过的对话不再生成）
 *  - 仅在对话的前 2 条消息为 user + assistant 且当前正在完成第一个 assistant 时
 */
function tryAutoTitle(
  conversationId: string,
  messages: UIMessage[],
  _lastSentCount: number,
  titledRef: React.MutableRefObject<Set<string>>,
): void {
  if (titledRef.current.has(conversationId)) return;
  if (messages.length < 2) return;
  const first = messages[0];
  const second = messages[1];
  if (!first || !second) return;
  if (first.role !== "user" || second.role !== "assistant") return;

  // 标记为"已触发"避免重复；标题存在则不再生成
  titledRef.current.add(conversationId);

  // 取第一个 user + 第一个 assistant 的纯文本作为 prompt
  const excerpt: UIMessage[] = [first, second];
  void api.server
    .info()
    .then((info) => {
      // 若 DB 中已有标题则跳过 LLM 调用
      return api.conversations.get(conversationId).then((conv) => {
        if (conv?.title && conv.title.trim().length > 0) return null;
        return fetchTitle(info, excerpt);
      });
    })
    .then((title) => {
      if (!title) return;
      return api.conversations.touch(conversationId, title);
    })
    .then(() => {
      // 通知侧栏刷新
      window.dispatchEvent(
        new CustomEvent("void-ai:conversation-renamed", {
          detail: { id: conversationId },
        }),
      );
    })
    .catch((err) => console.error("[chat] auto title failed:", err));
}

async function fetchTitle(
  info: { port: number; token: string },
  messages: UIMessage[],
): Promise<string | null> {
  try {
    const settings = await api.settings.getAll([SettingKey.SelectedModel]);
    const model = settings[SettingKey.SelectedModel];
    if (!model) return null;
    const res = await fetch(`http://127.0.0.1:${info.port}/api/title`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: info.token,
      },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return typeof data.title === "string" && data.title.length > 0 ? data.title : null;
  } catch (err) {
    console.error("[chat] fetch title error:", err);
    return null;
  }
}

/* ---------- 空态 ---------- */

function EmptyState({
  title,
  subtitle,
  suggestions,
  onSuggestion,
}: {
  title: string;
  subtitle: string;
  suggestions: string[];
  onSuggestion: (s: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-10 text-center">
        <div
          className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-2xl"
          aria-hidden
        >
          AI
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground/85">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-foreground/55">{subtitle}</p>
        </div>
        <PromptSuggestions
          title="Try one of these"
          suggestions={suggestions}
          onSelect={onSuggestion}
          className="mt-2"
        />
      </div>
    </div>
  );
}
