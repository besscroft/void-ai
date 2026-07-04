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
  /**
   * 本地 AI HTTP 服务端口。
   * 必须在组件挂载前就绪：useChat 会在首次渲染时固化 transport，
   * 之后再传新 transport 不会生效。
   */
  serverPort: number;
}

export function ChatView({ conversationId, serverPort }: ChatViewProps): React.JSX.Element {
  const { t } = useT();
  const { settings } = useSettings();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const savedRef = useRef<Set<string>>(new Set());

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

  // transport 仅在 serverPort / 模型 / 会话变化时重建。
  // useChat 内部会缓存首次 options 里的 transport，因此 ChatView 必须在 serverPort 就绪后才挂载。
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `http://127.0.0.1:${serverPort}/api/chat`,
        body: {
          model: selectedModel ?? undefined,
          agentId: selectedAgentId ?? DEFAULT_AGENT_ID,
          conversationId,
        },
      }),
    [serverPort, selectedModel, selectedAgentId, conversationId],
  );

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
    transport,
    onFinish: ({ messages: allMessages }) => {
      void persistMessages(conversationId, allMessages, savedRef.current);
      void api.conversations.touch(conversationId);
    },
    onError: (err) => {
      // 打印完整错误对象（含 statusCode / responseBody / cause 等），方便排查
      console.error("[chat] streaming error:", err);
      if (err instanceof Error) {
        console.error("[chat] error.name:", err.name);
        console.error("[chat] error.cause:", (err as Error & { cause?: unknown }).cause);
        const anyErr = err as Error & {
          statusCode?: number;
          responseBody?: string;
          url?: string;
        };
        if (anyErr.statusCode !== undefined) console.error("[chat] statusCode:", anyErr.statusCode);
        if (anyErr.responseBody !== undefined)
          console.error("[chat] responseBody:", anyErr.responseBody);
        if (anyErr.url !== undefined) console.error("[chat] url:", anyErr.url);
      }
      notify.error(t("toast.chat.failed"), err);
    },
  });

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  const handleSend = (text: string): void => {
    if (!selectedModel) return;
    void chat.sendMessage({ text });
  };

  /**
   * 停止当前流式生成（AI SDK 5 useChat.stop 会 abort 底下的 fetch）
   * 注意：已经生成的部分仍会保留在 messages 数组中
   */
  const handleStop = (): void => {
    void chat.stop();
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
