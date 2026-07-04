import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { api } from "../lib/api";
import { getChatErrorMessage } from "../lib/errors";
import { notify } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
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

  const handleSend = (text: string): void => {
    if (!selectedModel) return;
    const messageId = crypto.randomUUID();
    const userMessage: UIMessage = {
      id: messageId,
      role: "user",
      parts: [{ type: "text", text }],
    } as UIMessage;
    setChatError(null);
    chat.clearError();
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
    void chat.sendMessage({ text, messageId });
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

  if (!historyLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
        {t("chat.loadingHistory")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center border-b border-foreground/10 px-5 py-3">
        <h1 className="text-sm font-medium text-foreground/70">{t("chat.title")}</h1>
      </header>

      <MessageList
        messages={chat.messages}
        isLoading={isLoading}
        error={chat.error}
        errorDetail={chatError}
        onRetry={handleRetry}
        onDismissError={handleDismissError}
      />

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
