import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { api } from "../lib/api";
import { getChatErrorMessage } from "../lib/errors";
import { notify } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import { PromptSuggestions } from "./ai-elements";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_AGENT_ID,
  SettingKey,
  type LocalServerInfo,
} from "@shared/types";
import type { FilePartLike } from "./ai-elements";

interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo;
}

/** 空态建议（用户可点击直接发送） */
const EMPTY_STATE_SUGGESTIONS: string[] = [
  "用一句话解释量子计算",
  "帮我把这段代码改成 TypeScript",
  "为团队周会写一份议程",
  "推荐 3 本关于系统设计的好书",
];

export function ChatView({ conversationId, serverInfo }: ChatViewProps): React.JSX.Element {
  const { t, locale } = useT();
  const { settings } = useSettings();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const savedRef = useRef<Set<string>>(new Set());
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
    setSelectedModel(settings.selectedModel);
  }, [settings.selectedModel]);

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
    savedRef.current = new Set();
    hydratedConversationRef.current = null;
    void api.messages.list(conversationId).then((rows) => {
      const msgs: UIMessage[] = rows.map((row) => {
        try {
          return JSON.parse(row.content) as UIMessage;
        } catch {
          return {
            id: row.id,
            role: row.role as UIMessage["role"],
            parts: [{ type: "text", text: row.content }],
          } as UIMessage;
        }
      });
      savedRef.current = new Set(msgs.map((message) => message.id));
      setInitialMessages(msgs);
      setHistoryLoaded(true);
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: ({ messages: allMessages }) => {
      setChatError(null);
      void persistMessages(conversationId, allMessages, savedRef.current);
      void api.conversations.touch(conversationId);
    },
    onError: (err) => {
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      console.error("[chat] streaming error:", err);
      void persistMessages(conversationId, latestMessagesRef.current, savedRef.current);
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

  /**
   * 发送消息（支持附件）
   *
   * 流程：
   *  1. MessageInput 已把每个 File 读成 base64 dataURL，组装为 FileUIPart
   *  2. 预保存用户消息到 DB（UIMessage 全量序列化，含 file parts）
   *  3. 调用 chat.sendMessage 触发流式响应
   */
  const handleSend = async ({
    text,
    files,
  }: {
    text: string;
    files: FilePartLike[];
  }): Promise<void> => {
    if (!selectedModel) return;
    const messageId = crypto.randomUUID();

    // 构造 ai-sdk FileUIPart（url 已经是 base64 dataURL，由 MessageInput 完成）
    const finalFiles: FileUIPart[] = files.map((f, i) => ({
      type: "file",
      mediaType: f.mediaType ?? "application/octet-stream",
      filename: f.filename ?? `file-${i}`,
      url: f.url ?? f.data ?? "",
    }));

    const userMessage: UIMessage = {
      id: messageId,
      role: "user",
      // 当用户只发了文件时，parts 至少含一个空文本占位（ai-sdk 要求）
      parts: [
        ...(text ? [{ type: "text" as const, text }] : [{ type: "text" as const, text: "" }]),
        ...finalFiles.map((f) => ({
          type: "file" as const,
          mediaType: f.mediaType,
          filename: f.filename,
          url: f.url,
        })),
      ],
    } as unknown as UIMessage;

    setChatError(null);
    chat.clearError();

    // 预保存到 DB（UIMessage 全量序列化，保留 file parts 便于渲染历史）
    void api.messages
      .save({
        id: messageId,
        conversation_id: conversationId,
        role: "user",
        content: JSON.stringify(userMessage),
        created_at: Date.now(),
      })
      .then(() => {
        savedRef.current.add(messageId);
      })
      .catch((err) => {
        console.error("[chat] failed to pre-save user message:", err);
      });

    void api.conversations.touch(conversationId);

    // 触发流式响应
    void chat.sendMessage({
      text: text || "(附件消息)",
      files: finalFiles,
      messageId,
    });
  };

  const handleStop = (): void => {
    void chat.stop();
  };

  const handleRetry = (): void => {
    setChatError(null);
    chat.clearError();
    void chat.regenerate();
  };

  const handleDismissError = (): void => {
    setChatError(null);
    chat.clearError();
  };

  /**
   * 处理空态建议：直接把建议文本通过 MessageInput 触发表单
   * 这里我们只把建议文本回填到 MessageInput 的 input state
   * 简化：把建议直接发送（更直观）
   */
  const handleSuggestion = (suggestion: string): void => {
    if (!selectedModel) {
      notify.error(t("input.noModel"));
      return;
    }
    void handleSend({ text: suggestion, files: [] });
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
      <header className="flex shrink-0 items-center border-b border-foreground/10 px-5 py-3">
        <h1 className="text-sm font-medium text-foreground/70">{t("chat.title")}</h1>
      </header>

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
          onRetry={handleRetry}
          onDismissError={handleDismissError}
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

async function persistMessages(
  conversationId: string,
  messages: UIMessage[],
  savedSet: Set<string>,
): Promise<void> {
  const toSave = messages.filter((message) => !savedSet.has(message.id));
  if (toSave.length === 0) return;

  const now = Date.now();
  const rows = toSave.map((message, index) => ({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: JSON.stringify(message),
    created_at: now + index,
  }));
  await api.messages.saveBatch(rows);
  for (const message of toSave) savedSet.add(message.id);
}

/**
 * 空态：欢迎语 + 智能建议
 *
 * 创意：在没有历史消息时，把 Composer 上方露出一段引导文案 + 建议气泡。
 * 建议点击后直接发送，降低首次使用门槛。
 */
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
          ✨
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground/85">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-foreground/55">{subtitle}</p>
        </div>
        <PromptSuggestions
          title="试试这些问题"
          suggestions={suggestions}
          onSelect={onSuggestion}
          className="mt-2"
        />
      </div>
    </div>
  );
}
