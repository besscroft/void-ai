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

const EMPTY_STATE_SUGGESTIONS: string[] = [
  "Explain quantum computing in one sentence",
  "Help me rewrite this code in TypeScript",
  "Draft an agenda for a team weekly meeting",
  "Recommend 3 books about system design",
];

export function ChatView({ conversationId, serverInfo }: ChatViewProps): React.JSX.Element {
  const { t, locale } = useT();
  const { settings } = useSettings();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
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
    createdAtRef.current = new Map();
    hydratedConversationRef.current = null;

    void api.messages.list(conversationId).then((rows) => {
      const messages = rows.map(hydrateStoredMessage);
      createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
      setInitialMessages(messages);
      setHistoryLoaded(true);
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: ({ messages }) => {
      setChatError(null);
      void persistMessagesSnapshot(conversationId, messages, createdAtRef.current);
      void api.conversations.touch(conversationId);
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
    chat.clearError();

    const pendingMessages = appendOrReplaceMessage(latestMessagesRef.current, userMessage);
    void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current).catch(
      (err) => {
        console.error("[chat] failed to pre-save user message:", err);
      },
    );
    void api.conversations.touch(conversationId);

    const trimmedText = text.trim();
    void (trimmedText
      ? chat.sendMessage({
          text: trimmedText,
          files: finalFiles.length > 0 ? finalFiles : undefined,
          messageId,
        })
      : chat.sendMessage({ files: finalFiles, messageId }));
  };

  const handleStop = (): void => {
    void chat.stop().finally(() => {
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
    });
  };

  const handleRetry = (): void => {
    setChatError(null);
    chat.clearError();
    void chat.regenerate().finally(() => {
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
    });
  };

  const handleDismissError = (): void => {
    setChatError(null);
    chat.clearError();
  };

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
