import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import { DEFAULT_AGENT_ID, SettingKey } from "@shared/types";

interface ChatViewProps {
  conversationId: string;
}

export function ChatView({ conversationId }: ChatViewProps): React.JSX.Element {
  const { t } = useT();
  const { settings } = useSettings();
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const savedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void api.server.port().then(setServerPort);
    void api.settings.get(SettingKey.SelectedModel).then((model) => {
      if (model) setSelectedModel(model);
    });
    void api.settings.get(SettingKey.ActiveAgentId).then((agentId) => {
      setSelectedAgentId(agentId || DEFAULT_AGENT_ID);
    });
  }, []);

  const transport = useMemo(() => {
    if (!serverPort) return null;
    return new DefaultChatTransport({
      api: `http://127.0.0.1:${serverPort}/api/chat`,
      body: {
        model: selectedModel ?? undefined,
        temperature: settings.modelTemperature,
        topP: settings.modelTopP,
        maxOutputTokens: settings.modelMaxTokens,
        agentId: selectedAgentId ?? DEFAULT_AGENT_ID,
        conversationId,
      },
    });
  }, [
    serverPort,
    selectedModel,
    selectedAgentId,
    conversationId,
    settings.modelTemperature,
    settings.modelTopP,
    settings.modelMaxTokens,
  ]);

  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    setHistoryLoaded(false);
    savedRef.current = new Set();
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
      setInitialMessages(msgs);
      setHistoryLoaded(true);
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: transport ?? undefined,
    onFinish: ({ messages: allMessages }) => {
      void persistMessages(conversationId, allMessages, savedRef.current);
      void api.conversations.touch(conversationId);
    },
    onError: (err) => {
      console.error("[chat] streaming error:", err);
      notify.error(t("toast.chat.failed"), err);
    },
  });

  const isLoading = chat.status === "submitted" || chat.status === "streaming";
  const modelParametersLabel = useMemo(
    () =>
      t("input.params", {
        temperature: settings.modelTemperature.toFixed(1),
        maxTokens: settings.modelMaxTokens,
      }),
    [settings.modelMaxTokens, settings.modelTemperature, t],
  );

  const handleSend = (text: string): void => {
    if (!selectedModel) return;
    void chat.sendMessage({ text });
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

      <MessageList messages={chat.messages} isLoading={isLoading} error={chat.error} />

      <MessageInput
        isLoading={isLoading}
        onSend={handleSend}
        selectedModel={selectedModel}
        selectedAgentId={selectedAgentId}
        onModelChange={setSelectedModel}
        onAgentChange={setSelectedAgentId}
        modelParametersLabel={modelParametersLabel}
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

  const rows = toSave.map((message) => ({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: JSON.stringify(message),
    created_at: Date.now(),
  }));
  await api.messages.saveBatch(rows);
  for (const message of toSave) savedSet.add(message.id);
}
