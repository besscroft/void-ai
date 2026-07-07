import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { Button } from "@heroui/react";
import { api } from "../lib/api";
import { buildUserMessage, hydrateStoredMessage } from "../lib/chat-messages";
import { persistMessagesSnapshot } from "../lib/chat-persistence";
import { getChatErrorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_AGENT_ID,
  type DesktopPetMood,
  type DesktopPetSnapshot,
  type LocalServerInfo,
} from "@shared/types";
import { IconClose, IconMessage, IconSend, IconSettings, IconSparkles } from "./icons";

const PET_TOOL_SELECTION = { mode: "off" as const, selectedToolIds: [] };

export function DesktopPetApp(): React.JSX.Element {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<DesktopPetSnapshot | null>(null);
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.desktopPet.getSnapshot().then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };
    load();
    void api.server.info().then((info) => {
      if (!cancelled) setServerInfo(info);
    });
    const id = window.setInterval(load, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!snapshot || !serverInfo) {
    return (
      <div className="desktop-pet-drag flex h-full items-center justify-center bg-transparent text-xs text-foreground/55">
        {t("common.loading")}
      </div>
    );
  }

  return <DesktopPetChat snapshot={snapshot} serverInfo={serverInfo} />;
}

function DesktopPetChat({
  snapshot,
  serverInfo,
}: {
  snapshot: DesktopPetSnapshot;
  serverInfo: LocalServerInfo;
}): React.JSX.Element {
  const { t, locale } = useT();
  const conversationId = snapshot.config.conversationId!;
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const createdAtRef = useRef<Map<string, number>>(new Map());
  const hydratedConversationRef = useRef<string | null>(null);
  const latestMessagesRef = useRef<UIMessage[]>([]);
  const selectedModelRef = useRef<string | null>(snapshot.selectedModel);

  useEffect(() => {
    selectedModelRef.current = snapshot.selectedModel;
  }, [snapshot.selectedModel]);

  useEffect(() => {
    setHistoryLoaded(false);
    hydratedConversationRef.current = null;
    createdAtRef.current = new Map();
    void api.messages.list(conversationId).then((rows) => {
      createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
      setInitialMessages(rows.map(hydrateStoredMessage));
      setHistoryLoaded(true);
    });
  }, [conversationId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `http://127.0.0.1:${serverInfo.port}/api/chat`,
        headers: () => ({ [CHAT_SESSION_HEADER]: serverInfo.token }),
        body: () => ({
          model: selectedModelRef.current ?? undefined,
          agentId: DEFAULT_AGENT_ID,
          conversationId,
          reasoning: "provider-default",
          toolSelection: PET_TOOL_SELECTION,
        }),
      }),
    [conversationId, serverInfo.port, serverInfo.token],
  );

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages, isError }) => {
      if (!isError) setChatError(null);
      void persistMessagesSnapshot(conversationId, messages, createdAtRef.current)
        .then(() => api.agents.queueLearning(conversationId))
        .catch((err) => console.error("[desktop-pet] failed to persist messages:", err));
      void api.conversations.touch(conversationId);
    },
    onError: (err) => {
      const detail = getChatErrorMessage(err, locale);
      setChatError(detail);
      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);
      void api.conversations.touch(conversationId);
    },
  });

  latestMessagesRef.current = chat.messages;

  useEffect(() => {
    if (!historyLoaded || hydratedConversationRef.current === conversationId) return;
    chat.setMessages(initialMessages);
    hydratedConversationRef.current = conversationId;
  }, [chat, conversationId, historyLoaded, initialMessages]);

  const isLoading = chat.status === "submitted" || chat.status === "streaming";
  const hasModel = Boolean(snapshot.selectedModel);
  const mood: DesktopPetMood = chatError ? "error" : isLoading ? "thinking" : snapshot.mood;
  const assistantText = latestAssistantText(chat.messages) ?? t("desktopPet.emptyReply");
  const statusText = chatError
    ? t("desktopPet.status.error")
    : isLoading
      ? t("desktopPet.status.thinking")
      : moodLabel(t, mood);

  const handleSend = (): void => {
    const text = input.trim();
    if (!text || !hasModel || isLoading) return;

    let userMessage: UIMessage;
    try {
      userMessage = buildUserMessage({ id: crypto.randomUUID(), text, files: [] });
    } catch {
      return;
    }

    setInput("");
    setChatError(null);
    chat.clearError();

    const pendingMessages = [...latestMessagesRef.current, userMessage];
    void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current).catch(
      (err) => console.error("[desktop-pet] failed to pre-save user message:", err),
    );
    void api.conversations.touch(conversationId);
    void chat.sendMessage(userMessage).catch((err) => {
      setChatError(getChatErrorMessage(err, locale));
      void persistMessagesSnapshot(conversationId, pendingMessages, createdAtRef.current);
      void api.conversations.touch(conversationId);
    });
  };

  const handleOpenMain = (): void => {
    void api.desktopPet.openMain(conversationId);
  };

  const handleClose = (): void => {
    void api.desktopPet.hide();
  };

  return (
    <div className="desktop-pet-drag flex h-full w-full flex-col justify-end bg-transparent p-3 text-foreground">
      <div className="desktop-pet-no-drag self-end">
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          className="size-7 rounded-full bg-background/70 shadow-sm backdrop-blur"
          aria-label={t("common.close")}
          onPress={handleClose}
        >
          <IconClose className="size-3.5" />
        </Button>
      </div>

      <button
        type="button"
        className="desktop-pet-no-drag mx-auto mt-auto flex flex-col items-center gap-2 outline-none"
        onClick={() => setExpanded((next) => !next)}
        aria-label={t("desktopPet.toggle")}
      >
        <span className={`desktop-pet-orb desktop-pet-mood-${mood}`}>
          <span className="desktop-pet-orb-glow" />
          <span className="relative z-10 text-4xl font-semibold">
            {snapshot.agent?.avatar ?? "V"}
          </span>
        </span>
        <span className="rounded-full border border-foreground/10 bg-background/75 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur">
          {snapshot.agent?.name ?? "Void"} · {statusText}
        </span>
      </button>

      {expanded ? (
        <section className="desktop-pet-no-drag mt-3 rounded-lg border border-foreground/10 bg-background/90 p-3 shadow-xl backdrop-blur-xl">
          <div className="flex items-start gap-2">
            <IconSparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="line-clamp-4 min-h-10 flex-1 text-sm leading-5 text-foreground/80">
              {chatError ?? assistantText}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={input}
              disabled={!hasModel || isLoading}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                hasModel ? t("desktopPet.input.placeholder") : t("desktopPet.input.noModel")
              }
              className="h-9 min-w-0 flex-1 rounded-md border border-foreground/10 bg-background px-3 text-sm outline-none transition placeholder:text-foreground/35 focus:border-accent/50"
            />
            <Button
              isIconOnly
              size="sm"
              variant="primary"
              aria-label={t("desktopPet.send")}
              isDisabled={!input.trim() || !hasModel || isLoading}
              isPending={isLoading}
              onPress={handleSend}
            >
              <IconSend className="size-3.5" />
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <Button size="sm" variant="secondary" onPress={handleOpenMain}>
              <IconMessage className="size-3.5" />
              {t("desktopPet.openChat")}
            </Button>
            <Button size="sm" variant="tertiary" onPress={() => void api.desktopPet.openMain()}>
              <IconSettings className="size-3.5" />
              {t("desktopPet.settings")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function latestAssistantText(messages: UIMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return null;
}

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("")
    .trim();
}

function moodLabel(t: ReturnType<typeof useT>["t"], mood: DesktopPetMood): string {
  if (mood === "thinking") return t("desktopPet.status.thinking");
  if (mood === "working") return t("desktopPet.status.working");
  if (mood === "learning") return t("desktopPet.status.learning");
  if (mood === "error") return t("desktopPet.status.error");
  return t("desktopPet.status.idle");
}
