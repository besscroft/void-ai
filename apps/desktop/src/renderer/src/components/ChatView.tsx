/**
 * ChatView
 *
 * 娓叉煋灞傦細鎶?浼氳瘽"鍜?娑堟伅"涓や欢浜嬩覆璧锋潵
 *
 * 鑱岃矗锛?
 *  - 鍔犺浇鍘嗗彶娑堟伅 -> 浜ょ粰 useChat
 *  - 鍙戦€侊細鎶婄敤鎴锋秷鎭啓鍏?DB锛坧re-save锛夊悗鍐?sendMessage
 *  - 娴佸紡缁撴潫 -> 鎶婃渶鏂板揩鐓у啓鍥?DB
 *  - 澶撮儴灞曠ず锛氬璇濈姸鎬佸窘绔狅紙娴佸紡 / 灏辩华 / 閿欒 / 鍋滄锛? 涓婁笅鏂囩敤閲?
 *  - 鏍囬鑷姩鐢熸垚锛氶娆?user + assistant 瀹屾暣鍑虹幇鍚庤皟鐢?/api/title
 *  - 娑堟伅鍔ㄤ綔锛圗dit / Resend / Delete锛夌敱鏈粍浠跺疄鐜帮紝浼犻€掔粰 MessageList
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { api, type RuntimeSnapshot } from "../lib/api";
import { hasMeaningfulConversationTitle } from "../lib/conversation-title";
import { getChatErrorMessage } from "../lib/errors";
import {
  appendOrReplaceMessage,
  buildUserMessage,
  hydrateStoredMessage,
  toFileUIParts,
  updateMessageReaction,
} from "../lib/chat-messages";
import { persistMessagesSnapshot } from "../lib/chat-persistence";
import {
  buildMediaErrorMessage,
  buildMediaGenerationRequest,
  buildMediaPendingMessage,
  buildMediaResultMessage,
  detectMediaIntent,
  parseMediaGenerationSettings,
  serializeMediaGenerationSettings,
  type MediaGenerationSelection,
} from "../lib/chat-media";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import {
  ConversationStatus,
  PromptSuggestions,
  type ConversationStatusKind,
  type FilePartLike,
} from "./ai-elements";
import { estimateTokens } from "./ai-elements/context";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_CHAT_TOOL_SELECTION,
  DEFAULT_SETTINGS,
  DEFAULT_MEDIA_GENERATION_SETTINGS,
  DEFAULT_AGENT_ID,
  SettingKey,
  getChatToolSelectionForConversation,
  isChatReasoningLevel,
  withChatToolSelectionForConversation,
  type ChatReasoningLevel,
  type ChatToolSelectionRequest,
  type LocalServerInfo,
  type MediaGenerationErrorResponse,
  type MediaGenerationKind,
  type MediaGenerationResponse,
  type MediaGenerationSettings,
  type ProviderInfo,
} from "@shared/types";

interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo;
}

/**
 * 妯″瀷涓婁笅鏂囩獥鍙ｆ煡鎵撅紙绮楃暐锛夈€?
 *  - 閮ㄥ垎涓绘祦妯″瀷浠庡凡鐭ョ殑"鍘傚晢鎯緥"缁欓粯璁ゅ€?
 *  - 鎵句笉鍒板垯鍥炶惤鍒?32K
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

function getContextWindowForModel(
  modelRef: string | null | undefined,
  configuredContextWindow?: number,
): number {
  if (configuredContextWindow && Number.isFinite(configuredContextWindow)) {
    return configuredContextWindow;
  }
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
  const [reasoningLevel, setReasoningLevel] = useState<ChatReasoningLevel>(
    DEFAULT_SETTINGS.chatReasoningLevel,
  );
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isStopped, setIsStopped] = useState(false);
  const [isMediaGenerating, setIsMediaGenerating] = useState(false);
  const [mediaSettings, setMediaSettings] = useState<MediaGenerationSettings>(
    DEFAULT_MEDIA_GENERATION_SETTINGS,
  );
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<Pick<
    RuntimeSnapshot,
    | "runtimeRuns"
    | "runtimeSteps"
    | "agentRuntimeStates"
    | "conversationAgentStates"
    | "sandboxSessions"
    | "sandboxSnapshots"
    | "sandboxArtifacts"
  > | null>(null);
  const [modelContextWindows, setModelContextWindows] = useState<Map<string, number>>(new Map());
  const [toolSelection, setToolSelection] = useState<ChatToolSelectionRequest>(
    DEFAULT_CHAT_TOOL_SELECTION,
  );
  /** 鏄惁宸蹭负鏈璇濈敓鎴愯繃鏍囬锛堥槻姝㈤噸澶嶇敓鎴愶級 */
  const titledRef = useRef<Set<string>>(new Set());
  /** 涓婁竴娆″彂閫佹椂鐨勬秷鎭暟锛堢敤浜庤瘑鍒?鏈疆鍥炲瀹屾垚"锛?*/
  const lastSentCountRef = useRef(0);
  const createdAtRef = useRef<Map<string, number>>(new Map());
  const selectedModelRef = useRef<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const reasoningLevelRef = useRef<ChatReasoningLevel>(DEFAULT_SETTINGS.chatReasoningLevel);
  const toolSelectionRef = useRef<ChatToolSelectionRequest>(DEFAULT_CHAT_TOOL_SELECTION);
  const mediaSettingsRef = useRef<MediaGenerationSettings>(DEFAULT_MEDIA_GENERATION_SETTINGS);
  const latestMessagesRef = useRef<UIMessage[]>([]);
  const hydratedConversationRef = useRef<string | null>(null);
  const emptyStateSuggestions = useMemo(
    () => [
      t("chat.suggestions.quantum"),
      t("chat.suggestions.typescript"),
      t("chat.suggestions.agenda"),
      t("chat.suggestions.books"),
    ],
    [t],
  );
  const followupSuggestions = useMemo(
    () => [
      t("chat.followups.nextSteps"),
      t("chat.followups.summarize"),
      t("chat.followups.examples"),
      t("chat.followups.alternatives"),
    ],
    [t],
  );

  useEffect(() => {
    void api.settings.get(SettingKey.SelectedModel).then((model) => {
      if (model) setSelectedModel(model);
    });
    void api.settings.get(SettingKey.ActiveAgentId).then((agentId) => {
      setSelectedAgentId(agentId || DEFAULT_AGENT_ID);
    });
    void api.settings.get(SettingKey.ChatReasoningLevel).then((level) => {
      if (isChatReasoningLevel(level)) setReasoningLevel(level);
    });
    void api.settings.get(SettingKey.MediaGeneration).then((raw) => {
      const parsed = parseMediaGenerationSettings(raw);
      mediaSettingsRef.current = parsed;
      setMediaSettings(parsed);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.providers.list().then((providerList: ProviderInfo[]) => {
      if (cancelled) return;
      setProviders(providerList);
      setModelContextWindows(
        new Map(
          providerList.flatMap((provider) =>
            provider.models.map(
              (model) => [`${provider.id}/${model.id}`, model.contextWindow] as const,
            ),
          ),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedModel]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    reasoningLevelRef.current = reasoningLevel;
  }, [reasoningLevel]);

  useEffect(() => {
    toolSelectionRef.current = toolSelection;
  }, [toolSelection]);

  useEffect(() => {
    mediaSettingsRef.current = mediaSettings;
  }, [mediaSettings]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `http://127.0.0.1:${serverInfo.port}/api/chat`,
        headers: () => ({ [CHAT_SESSION_HEADER]: serverInfo.token }),
        body: () => ({
          model: selectedModelRef.current ?? undefined,
          agentId: selectedAgentIdRef.current ?? DEFAULT_AGENT_ID,
          conversationId,
          reasoning: reasoningLevelRef.current,
          toolSelection: toolSelectionRef.current,
        }),
      }),
    [conversationId, serverInfo.port, serverInfo.token],
  );

  useEffect(() => {
    setHistoryLoaded(false);
    setChatError(null);
    setIsStopped(false);
    setToolSelection(DEFAULT_CHAT_TOOL_SELECTION);
    createdAtRef.current = new Map();
    hydratedConversationRef.current = null;
    // 涓嶉噸缃?titledRef锛氫繚鐣欒法浼氳瘽璁板綍锛岄伩鍏嶉噸澶嶇敓鎴愶紙鍒囨崲鍥炲埌鏃у璇濅篃涓嶉噸鐢熸垚锛?
    lastSentCountRef.current = 0;

    void api.messages.list(conversationId).then((rows) => {
      const messages = rows.map(hydrateStoredMessage);
      createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
      setInitialMessages(messages);
      setHistoryLoaded(true);
      // 濡傛灉鍘嗗彶涓凡缁忔湁鏍囬锛圖B 宸叉湁锛夛紝鏍囪涓哄凡鐢熸垚锛岄伩鍏嶅啀娆¤Е鍙?
      void api.conversations.get(conversationId).then((conv) => {
        if (hasMeaningfulConversationTitle(conv?.title)) {
          titledRef.current.add(conversationId);
        }
      });
    });

    void api.settings.get(SettingKey.ChatTools).then((raw) => {
      setToolSelection(getChatToolSelectionForConversation(raw, conversationId));
    });
  }, [conversationId]);

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages, isError }) => {
      if (!isError) setChatError(null);
      setIsStopped(false);
      void persistMessagesSnapshot(conversationId, messages, createdAtRef.current)
        .then(() => api.agents.queueLearning(conversationId))
        .catch((err) => console.error("[chat] failed to persist messages or queue learning:", err));
      void api.conversations.touch(conversationId);
      // 鑷姩鐢熸垚鏍囬锛氭湰杞彂閫佷簡娑堟伅 + assistant 瀹屾暣浜х敓 + 杩樻病鐢熸垚杩?
      tryAutoTitle(conversationId, messages, lastSentCountRef.current, titledRef);
    },
    onError: (err) => {
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      console.error("[chat] streaming error:", err);
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
      notify.error(t("toast.chat.failed"), detail, locale);
    },
  });

  latestMessagesRef.current = chat.messages;

  useEffect(() => {
    if (!historyLoaded || hydratedConversationRef.current === conversationId) return;
    chat.setMessages(initialMessages);
    hydratedConversationRef.current = conversationId;
  }, [chat, conversationId, historyLoaded, initialMessages]);

  const isChatLoading = chat.status === "submitted" || chat.status === "streaming";
  const isLoading = isChatLoading || isMediaGenerating;

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.agents.runtimeSnapshot().then((snapshot) => {
        if (!cancelled) setRuntimeSnapshot(snapshot);
      });
    };
    load();
    if (!isLoading) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(load, 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [conversationId, isLoading]);

  /* ---------- 鐘舵€佹槧灏?---------- */
  const statusKind: ConversationStatusKind = chat.error
    ? "error"
    : isMediaGenerating
      ? "submitted"
      : isChatLoading
        ? chat.status === "submitted"
          ? "submitted"
          : "streaming"
        : isStopped
          ? "stopped"
          : "ready";

  /* ---------- Context usage ---------- */
  const contextMetrics = useMemo(() => {
    const usedTokens = chat.messages.reduce((sum, m) => {
      const text = (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      return sum + estimateTokens(text);
    }, 0);
    const maxTokens = getContextWindowForModel(
      selectedModel,
      selectedModel ? modelContextWindows.get(selectedModel) : undefined,
    );
    return { usedTokens, maxTokens, costUsd: undefined as number | undefined };
  }, [chat.messages, modelContextWindows, selectedModel]);

  /* ---------- 鍙戦€?---------- */
  const handleMediaSettingsChange = (next: MediaGenerationSettings): void => {
    mediaSettingsRef.current = next;
    setMediaSettings(next);
    void api.settings
      .set(SettingKey.MediaGeneration, serializeMediaGenerationSettings(next))
      .catch((err) => console.error("[chat] failed to persist media settings:", err));
  };

  const handleMediaSend = async ({
    text,
    files,
    media,
    userMessageId,
    assistantMessageId: requestedAssistantMessageId,
    baseMessages,
  }: {
    text: string;
    files: ReturnType<typeof toFileUIParts>;
    media: MediaGenerationSelection;
    userMessageId?: string;
    assistantMessageId?: string;
    baseMessages?: UIMessage[];
  }): Promise<void> => {
    let request;
    try {
      request = buildMediaGenerationRequest({
        kind: media.kind,
        text,
        files,
        providers,
        settings: mediaSettingsRef.current,
        modelRef: media.modelRef,
        options: media.options,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      notify.error(t("toast.media.failed"), detail, locale);
      return;
    }

    const messageId = userMessageId ?? crypto.randomUUID();
    const assistantMessageId = requestedAssistantMessageId ?? crypto.randomUUID();
    let userMessage: UIMessage;

    try {
      userMessage = buildUserMessage({ id: messageId, text, files });
    } catch {
      return;
    }

    setChatError(null);
    setIsStopped(false);
    setIsMediaGenerating(true);
    chat.clearError();

    const userMessages = appendOrReplaceMessage(
      baseMessages ?? latestMessagesRef.current,
      userMessage,
    );
    const pendingMessage = buildMediaPendingMessage(assistantMessageId, media.kind, media);
    const pendingMessages = appendOrReplaceMessage(userMessages, pendingMessage);
    chat.setMessages(pendingMessages);
    latestMessagesRef.current = pendingMessages;
    lastSentCountRef.current = userMessages.length;

    void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current).catch(
      (err) => console.error("[chat] failed to pre-save media messages:", err),
    );
    void api.conversations.touch(conversationId);

    try {
      const response = await fetch(`http://127.0.0.1:${serverInfo.port}/api/media/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: serverInfo.token,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const mediaError = await readMediaErrorResponse(response);
        throw new Error(formatMediaError(mediaError, request.kind, t));
      }
      const result = (await response.json()) as MediaGenerationResponse;
      const resultMessage = buildMediaResultMessage(assistantMessageId, result);
      const nextMessages = appendOrReplaceMessage(pendingMessages, resultMessage);
      chat.setMessages(nextMessages);
      latestMessagesRef.current = nextMessages;
      void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);
      void api.conversations.touch(conversationId);
      tryAutoTitle(conversationId, nextMessages, lastSentCountRef.current, titledRef);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const errorMessage = buildMediaErrorMessage(assistantMessageId, media.kind, detail, media);
      const nextMessages = appendOrReplaceMessage(pendingMessages, errorMessage);
      chat.setMessages(nextMessages);
      latestMessagesRef.current = nextMessages;
      void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);
      void api.conversations.touch(conversationId);
      notify.error(t("toast.media.failed"), detail, locale);
    } finally {
      setIsMediaGenerating(false);
    }
  };

  const handleSend = async ({
    text,
    files,
    media,
  }: {
    text: string;
    files: FilePartLike[];
    media?: MediaGenerationSelection;
  }): Promise<void> => {
    const finalFiles = toFileUIParts(files);
    const detected = media ? null : detectMediaIntent(text, finalFiles);
    const mediaSelection = media ?? (detected ? { kind: detected.kind } : undefined);

    if (mediaSelection) {
      await handleMediaSend({ text, files: finalFiles, media: mediaSelection });
      return;
    }

    if (!selectedModel) return;

    const messageId = crypto.randomUUID();
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
      notify.error(t("toast.chat.failed"), detail, locale);
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

  const handleRetryMediaMessage = async (messageId: string): Promise<void> => {
    const messages = latestMessagesRef.current;
    const assistantIndex = messages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0) return;
    const metadata = readMediaGenerationMetadata(messages[assistantIndex]);
    if (!metadata || metadata.status !== "error") return;

    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }

    const userMessage = userIndex >= 0 ? messages[userIndex] : undefined;
    if (!userMessage) {
      notify.error(
        t("toast.media.failed"),
        "Original media request is no longer available.",
        locale,
      );
      return;
    }

    const text = (userMessage.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n\n");
    const files = (userMessage.parts ?? []).filter(
      (part): part is ReturnType<typeof toFileUIParts>[number] => part.type === "file",
    );

    await handleMediaSend({
      text,
      files,
      media: { kind: metadata.kind, modelRef: metadata.modelRef, options: metadata.options },
      userMessageId: userMessage.id,
      assistantMessageId: messageId,
      baseMessages: messages.slice(0, userIndex + 1),
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

  const handleToolSelectionChange = (next: ChatToolSelectionRequest): void => {
    setToolSelection(next);
    toolSelectionRef.current = next;
    void api.settings
      .get(SettingKey.ChatTools)
      .then((raw) =>
        api.settings.set(
          SettingKey.ChatTools,
          JSON.stringify(withChatToolSelectionForConversation(raw, conversationId, next)),
        ),
      )
      .catch((err) => console.error("[chat] failed to persist tool selection:", err));
  };

  /* ---------- 娑堟伅鍔ㄤ綔锛氱紪杈?---------- */
  const handleReactMessage = (messageId: string, emoji: string, label: string): void => {
    const nextMessages = updateMessageReaction({
      messages: latestMessagesRef.current,
      messageId,
      reaction: { emoji, label, createdAt: Date.now() },
    });
    chat.setMessages(nextMessages);
    latestMessagesRef.current = nextMessages;
    void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);
    void api.conversations.touch(conversationId);
  };
  const handleEditMessage = async (messageId: string, newText: string): Promise<void> => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    if (target.role !== "user") return;

    // 1. 鎵惧埌璇?user 娑堟伅锛屾浛鎹?text part锛屽垹闄ゅ悗缁墍鏈夋秷鎭?
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

    // 2. 鎸佷箙鍖栨柊蹇収锛堝垹闄ゅ悗缁秷鎭級
    void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 3. 瑙﹀彂閲嶆柊鐢熸垚
    lastSentCountRef.current = nextMessages.length;
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      console.error("[chat] edit regenerate failed:", err);
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      notify.error(t("toast.chat.failed"), detail, locale);
    }
  };

  /* ---------- 娑堟伅鍔ㄤ綔锛氶噸鏂板彂閫?---------- */
  const handleResendMessage = async (messageId: string): Promise<void> => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    if (target.role !== "user") return;

    // 1. 鎴柇鍒拌 user 娑堟伅
    const nextMessages = chat.messages.slice(0, idx + 1);
    chat.setMessages(nextMessages);
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 2. 鎸佷箙鍖栵紙鍒犻櫎鍚庣画娑堟伅锛?
    void persistMessagesSnapshot(conversationId, nextMessages, createdAtRef.current);

    // 3. 瑙﹀彂閲嶆柊鐢熸垚
    lastSentCountRef.current = nextMessages.length;
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      console.error("[chat] resend failed:", err);
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      notify.error(t("toast.chat.failed"), detail, locale);
    }
  };

  /* ---------- 娑堟伅鍔ㄤ綔锛氬垹闄?---------- */
  const handleDeleteMessage = (messageId: string): void => {
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = chat.messages[idx];
    const confirmed = window.confirm(t("msg.delete.confirm"));
    if (!confirmed) return;

    // 1. 鍒犻櫎鐩爣 + 濡傛灉鐩爣鏄?user 娑堟伅锛岀揣璺熺殑 assistant 涔熶竴骞跺垹闄?
    const next = [...chat.messages];
    next.splice(idx, 1);
    if (target.role === "user" && next[idx]?.role === "assistant") {
      next.splice(idx, 1);
    }
    chat.setMessages(next);
    createdAtRef.current.delete(messageId);
    if (next[idx - 1]?.role === "user") {
      // 鍚屾鍒犻櫎鍙兘瀛樺湪鐨?createdAt
    }

    // 2. 鎸佷箙鍖栵紙鐩爣娑堟伅涓庡彲鑳界殑 assistant 鍚屾浠?DB 涓垹闄わ級
    void persistMessagesSnapshot(conversationId, next, createdAtRef.current);
    notify.success(t("chat.messageDeleted"));
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
      <ChatHeader
        status={statusKind}
        runtimeSummary={formatRuntimeSummary(runtimeSnapshot, conversationId, t)}
      />

      {isEmpty ? (
        <EmptyState
          title={t("chat.empty.title")}
          subtitle={t("chat.empty.subtitle")}
          suggestions={emptyStateSuggestions}
          onSuggestion={handleSuggestion}
        />
      ) : (
        <MessageList
          messages={chat.messages}
          isLoading={isLoading}
          status={statusKind}
          error={chat.error}
          errorDetail={chatError}
          emptySuggestions={emptyStateSuggestions}
          followupSuggestions={followupSuggestions}
          onRetry={handleRetry}
          onRetryMessage={handleRetryMediaMessage}
          onDismissError={handleDismissError}
          onEditMessage={handleEditMessage}
          onResendMessage={handleResendMessage}
          onDeleteMessage={handleDeleteMessage}
          onToolApprovalResponse={chat.addToolApprovalResponse}
          onReactMessage={handleReactMessage}
          onSuggestion={handleSuggestion}
        />
      )}

      <MessageInput
        isLoading={isLoading}
        onSend={handleSend}
        onStop={isChatLoading ? handleStop : undefined}
        selectedModel={selectedModel}
        selectedAgentId={selectedAgentId}
        reasoningLevel={reasoningLevel}
        onModelChange={setSelectedModel}
        onAgentChange={setSelectedAgentId}
        onReasoningLevelChange={setReasoningLevel}
        toolSelection={toolSelection}
        onToolSelectionChange={handleToolSelectionChange}
        providers={providers}
        mediaSettings={mediaSettings}
        onMediaSettingsChange={handleMediaSettingsChange}
        contextMetrics={contextMetrics}
      />
    </div>
  );
}

/* ---------- 澶撮儴 ---------- */

interface ChatHeaderProps {
  status: ConversationStatusKind;
  runtimeSummary?: string;
}

/**
 * 澶撮儴鍙睍绀?瀵硅瘽鍚?+ 鐘舵€佸窘绔?锛涗笂涓嬫枃鐢ㄩ噺宸茶縼鑷宠緭鍏ユ鐨?ContextPopover銆?
 */
function ChatHeader({ status, runtimeSummary }: ChatHeaderProps): React.JSX.Element {
  const { t } = useT();
  return (
    <header
      className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 sm:px-6"
      data-streaming={status === "streaming" || status === "submitted"}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-2 rounded-full bg-success/80 ring-2 ring-success/20"
          aria-hidden
        />
        <h1 className="text-sm font-medium text-foreground/80">{t("chat.header.title")}</h1>
        <ConversationStatus status={status} />
        {runtimeSummary ? (
          <span className="hidden max-w-[32rem] truncate text-xs text-foreground/50 sm:inline">
            {runtimeSummary}
          </span>
        ) : null}
      </div>
      <span className="text-[10.5px] uppercase tracking-wider text-foreground/40">
        {t("chat.header.runtime")}
      </span>
    </header>
  );
}

/* ---------- 鎸佷箙鍖?---------- */

function formatRuntimeSummary(
  snapshot: Pick<
    RuntimeSnapshot,
    | "runtimeRuns"
    | "runtimeSteps"
    | "agentRuntimeStates"
    | "conversationAgentStates"
    | "sandboxSessions"
    | "sandboxSnapshots"
    | "sandboxArtifacts"
  > | null,
  conversationId: string,
  t: ReturnType<typeof useT>["t"],
): string | undefined {
  if (!snapshot) return undefined;
  const conversationState = snapshot.conversationAgentStates.find(
    (state) => state.conversation_id === conversationId,
  );
  if (conversationState?.status === "reviewing") {
    return conversationState.summary || t("chat.runtime.waitingApproval");
  }
  if (conversationState?.summary) return conversationState.summary;

  const run =
    snapshot.runtimeRuns.find(
      (item) => item.conversation_id === conversationId && item.status === "running",
    ) ??
    snapshot.runtimeRuns.find(
      (item) => item.conversation_id === conversationId && item.status === "queued",
    );
  if (!run) return undefined;

  const currentStep = conversationState?.current_step_id
    ? snapshot.runtimeSteps.find((step) => step.id === conversationState.current_step_id)
    : undefined;
  if (currentStep) return currentStep.title;

  const latestStep = snapshot.runtimeSteps
    .filter((step) => step.run_id === run.id)
    .sort((a, b) => b.started_at - a.started_at)[0];
  if (latestStep) return latestStep.title;
  return t("chat.runtime.preparing");
}

/* ---------- 鑷姩鏍囬鐢熸垚 ---------- */

/**
 * 褰撴湰杞?user + assistant 瀹屾暣鍑虹幇鍚庯紝璋冪敤 /api/title 鐢熸垚鏍囬
 *  - 浠呴娆★紙宸茬敓鎴愯繃鐨勫璇濅笉鍐嶇敓鎴愶級
 *  - 浠呭湪瀵硅瘽鐨勫墠 2 鏉℃秷鎭负 user + assistant 涓斿綋鍓嶆鍦ㄥ畬鎴愮涓€涓?assistant 鏃?
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

  // 鍙栫涓€涓?user + 绗竴涓?assistant 鐨勭函鏂囨湰浣滀负 prompt
  const excerpt: UIMessage[] = [first, second];
  void api.server
    .info()
    .then((info) => {
      // 鑻?DB 涓凡鏈夋爣棰樺垯璺宠繃 LLM 璋冪敤
      return api.conversations.get(conversationId).then((conv) => {
        if (hasMeaningfulConversationTitle(conv?.title)) {
          titledRef.current.add(conversationId);
          return null;
        }
        return fetchTitle(info, excerpt);
      });
    })
    .then((title) => {
      if (!title) return;
      titledRef.current.add(conversationId);
      return api.conversations.touch(conversationId, title).then(() => title);
    })
    .then((title) => {
      // 閫氱煡渚ф爮鍒锋柊锛堟惡甯︽渶鏂?title锛岄伩鍏嶉噸鏂版媺鍙栨暣寮犲垪琛級
      window.dispatchEvent(
        new CustomEvent("void-ai:conversation-renamed", {
          detail: { id: conversationId, title },
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

/* ---------- 绌烘€?---------- */

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
  const { t } = useT();
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-10 text-center">
        <div
          className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-2xl"
          aria-hidden
        >
          {t("chat.empty.icon")}
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground/85">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-foreground/55">{subtitle}</p>
        </div>
        <PromptSuggestions
          title={t("chat.suggestions.title")}
          suggestions={suggestions}
          onSelect={onSuggestion}
          className="mt-2"
        />
      </div>
    </div>
  );
}
function readMediaGenerationMetadata(message: UIMessage | undefined): {
  kind: MediaGenerationKind;
  status?: string;
  modelRef?: string | null;
  options?: MediaGenerationSelection["options"];
} | null {
  const metadata = message?.metadata as
    | {
        mediaGeneration?: {
          kind?: unknown;
          status?: unknown;
          modelRef?: unknown;
          options?: unknown;
        };
      }
    | null
    | undefined;
  const media = metadata?.mediaGeneration;
  if (!media || !isMediaGenerationKind(media.kind)) return null;
  return {
    kind: media.kind,
    status: typeof media.status === "string" ? media.status : undefined,
    modelRef: typeof media.modelRef === "string" ? media.modelRef : null,
    options:
      media.options && typeof media.options === "object" && !Array.isArray(media.options)
        ? (media.options as MediaGenerationSelection["options"])
        : undefined,
  };
}

function isMediaGenerationKind(value: unknown): value is MediaGenerationKind {
  return value === "image" || value === "speech" || value === "transcription" || value === "video";
}

async function readMediaErrorResponse(response: Response): Promise<MediaGenerationErrorResponse> {
  try {
    const data = (await response.json()) as Partial<MediaGenerationErrorResponse>;
    if (typeof data.error === "string" && data.error.trim()) {
      return {
        error: data.error.trim(),
        code: isMediaGenerationErrorCode(data.code) ? data.code : "upstream_error",
        kind: isMediaGenerationKind(data.kind) ? data.kind : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      };
    }
  } catch {
    // Fall back to text below.
  }
  try {
    const text = await response.text();
    if (text.trim()) return { error: text.trim(), code: "upstream_error" };
  } catch {
    // Fall through to status text.
  }
  return { error: response.statusText || `HTTP ${response.status}`, code: "upstream_error" };
}

function isMediaGenerationErrorCode(value: unknown): value is MediaGenerationErrorResponse["code"] {
  return (
    value === "unauthorized" ||
    value === "invalid_request" ||
    value === "no_model" ||
    value === "unsupported_model" ||
    value === "permission_denied" ||
    value === "upstream_error"
  );
}

function formatMediaError(
  error: MediaGenerationErrorResponse,
  fallbackKind: MediaGenerationKind,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const kind = t(mediaKindLabelKey(error.kind ?? fallbackKind));
  switch (error.code) {
    case "no_model":
      return t("media.error.noModel", { kind });
    case "unsupported_model":
      return t("media.error.unsupported", { kind });
    case "permission_denied":
      return t("media.error.permission");
    case "unauthorized":
    case "invalid_request":
    case "upstream_error":
      return t("media.error.upstream", { message: error.error });
  }
}

function mediaKindLabelKey(kind: MediaGenerationKind): string {
  switch (kind) {
    case "image":
      return "input.media.image";
    case "speech":
      return "input.media.speech";
    case "transcription":
      return "input.media.transcription";
    case "video":
      return "input.media.video";
  }
}
