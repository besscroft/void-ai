import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ModelSelector } from "./ModelSelector";
import { api } from "../lib/api";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import { SettingKey } from "@shared/types";

interface ChatViewProps {
  /** 当前会话 ID（用于隔离不同会话的消息） */
  conversationId: string;
}

/**
 * 聊天主视图：消息列表 + 输入框 + 模型选择器
 *
 * 数据流：
 *  - useChat (Hook)：管理消息状态、流式接收、发送
 *  - DefaultChatTransport：通过 fetch 与本地 Hono 服务通信
 *  - 本地服务 (127.0.0.1:port)：调用 AI SDK streamText 并返回 SSE 流
 *
 * 会话切换时：
 *  - 从 DB 加载历史消息填充 useChat.messages
 *  - 流式完成后将消息保存到 DB
 */
export function ChatView({ conversationId }: ChatViewProps): React.JSX.Element {
  const { t } = useT();
  const { settings } = useSettings();
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // 防止同一会话内 onFinish 重复保存
  const savedRef = useRef<Set<string>>(new Set());

  // 启动时获取本地服务端口和已选模型
  useEffect(() => {
    void api.server.port().then(setServerPort);
    void api.settings.get(SettingKey.SelectedModel).then((m) => {
      if (m) setSelectedModel(m);
    });
  }, []);

  // 构造 transport：当端口就绪后启用
  // 透传模型参数（温度/Top-P/最大输出长度）到后端，参数变更即生效
  const transport = useMemo(() => {
    if (!serverPort) return null;
    return new DefaultChatTransport({
      api: `http://127.0.0.1:${serverPort}/api/chat`,
      body: {
        model: selectedModel ?? undefined,
        temperature: settings.modelTemperature,
        topP: settings.modelTopP,
        maxOutputTokens: settings.modelMaxTokens,
      },
    });
  }, [
    serverPort,
    selectedModel,
    settings.modelTemperature,
    settings.modelTopP,
    settings.modelMaxTokens,
  ]);

  // 加载该会话的历史消息作为初始值
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    setHistoryLoaded(false);
    savedRef.current = new Set();
    void api.messages.list(conversationId).then((rows) => {
      const msgs: UIMessage[] = rows.map((r) => {
        try {
          return JSON.parse(r.content) as UIMessage;
        } catch {
          // 兼容老数据：将纯文本包装成 UIMessage
          return {
            id: r.id,
            role: r.role as UIMessage["role"],
            parts: [{ type: "text", text: r.content }],
          } as UIMessage;
        }
      });
      setInitialMessages(msgs);
      setHistoryLoaded(true);
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId, // 不同会话用不同 id，便于 useChat 内部隔离状态
    messages: initialMessages,
    transport: transport ?? undefined,
    onFinish: ({ messages: allMessages }) => {
      // 流式完成后，将新增/变更的消息持久化到 DB
      void persistMessages(conversationId, allMessages, savedRef.current);
      // 触发会话时间戳更新
      void api.conversations.touch(conversationId);
    },
    onError: (err) => {
      console.error("[chat] 流式错误:", err);
    },
  });

  // status: 'submitted' | 'streaming' | 'ready' | 'error'
  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  const handleSend = (text: string): void => {
    if (!selectedModel) return;
    void chat.sendMessage({ text });
  };

  // 历史未加载完不渲染（避免空列表闪烁）
  if (!historyLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
        {t("chat.loadingHistory")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 顶栏：模型选择器 */}
      <header className="flex items-center justify-between border-b border-foreground/10 px-4 py-2.5">
        <h1 className="text-sm font-medium text-foreground/70">{t("chat.title")}</h1>
        <ModelSelector value={selectedModel} onChange={setSelectedModel} />
      </header>

      <MessageList messages={chat.messages} isLoading={isLoading} error={chat.error} />

      <MessageInput isLoading={isLoading} onSend={handleSend} modelSelected={!!selectedModel} />
    </div>
  );
}

/**
 * 将消息数组持久化到 DB。
 * 只保存尚未保存的消息（基于 savedSet 跟踪）。
 */
async function persistMessages(
  conversationId: string,
  messages: UIMessage[],
  savedSet: Set<string>,
): Promise<void> {
  const toSave = messages.filter((m) => !savedSet.has(m.id));
  if (toSave.length === 0) return;

  const rows = toSave.map((m) => ({
    id: m.id,
    conversation_id: conversationId,
    role: m.role,
    content: JSON.stringify(m),
    created_at: Date.now(),
  }));
  await api.messages.saveBatch(rows);
  for (const m of toSave) savedSet.add(m.id);
}
