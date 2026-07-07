import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AppShell, type AppView } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WorkspaceView } from "./components/WorkspaceView";
import { api } from "./lib/api";
import { SettingsProvider, useSettings } from "./lib/settings";
import { AppI18nProvider, useT } from "./lib/i18n";
import { SettingKey, type LocalServerInfo } from "@shared/types";
import { Toaster } from "sonner";
import { I18nProvider } from "@heroui/react";
import { MotionConfig } from "motion/react";

function App(): React.JSX.Element {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SettingsProvider>
      <AppRoot>{children}</AppRoot>
    </SettingsProvider>
  );
}

function AppRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const { resolvedLanguage, settings } = useSettings();
  const reducedMotion =
    settings.reduceMotion === "on" ? "always" : settings.reduceMotion === "off" ? "never" : "user";
  return (
    <AppI18nProvider locale={resolvedLanguage}>
      <I18nProvider locale={resolvedLanguage}>
        <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
      </I18nProvider>
    </AppI18nProvider>
  );
}

function AppContent(): React.JSX.Element {
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 服务端口：useChat 必须在首次渲染就拿到正确 transport，
  // 因此端口就绪前不挂载 ChatView。
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);

  const createNewConversation = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const conv = await api.conversations.create(id, t("shell.newConversation"));
    setActiveId(conv.id);
    setActiveView("chat");
    await api.settings.set(SettingKey.ActiveConversationId, conv.id);
  }, [t]);

  useEffect(() => {
    // 提早拉取本地服务端口，避免 ChatView 内部 useEffect 抢跑
    void api.server.info().then(setServerInfo);
  }, []);

  useEffect(() => {
    void (async () => {
      const last = await api.settings.get(SettingKey.ActiveConversationId);
      if (last) {
        setActiveId(last);
        return;
      }
      const list = await api.conversations.list();
      if (list.length > 0) {
        setActiveId(list[0].id);
        return;
      }
      await createNewConversation();
    })();
  }, [createNewConversation]);

  const handleSelect = useCallback((id: string): void => {
    setActiveId(id);
    void api.settings.set(SettingKey.ActiveConversationId, id);
  }, []);

  const handleSelectView = useCallback((view: AppView): void => {
    setActiveView(view);
  }, []);

  const handleDelete = useCallback(
    (id: string): void => {
      setActiveId((current) => {
        if (current === id) {
          void api.conversations.list().then((list) => {
            const next = list.find((c) => c.id !== id);
            if (next) {
              setActiveId(next.id);
              void api.settings.set(SettingKey.ActiveConversationId, next.id);
            } else {
              void createNewConversation();
            }
          });
        }
        return current;
      });
    },
    [createNewConversation],
  );

  useEffect(() => {
    return api.desktopPet.onOpenConversation((conversationId) => {
      if (conversationId) {
        setActiveId(conversationId);
        void api.settings.set(SettingKey.ActiveConversationId, conversationId);
      }
      setActiveView("chat");
    });
  }, []);

  return (
    <>
      <AppShell
        activeView={activeView}
        activeConversationId={activeId}
        onSelectView={handleSelectView}
        onSelectConversation={handleSelect}
        onCreateConversation={() => void createNewConversation()}
        onDeleteConversation={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {activeView === "chat" ? (
          activeId && serverInfo !== null ? (
            <ChatView key={activeId} conversationId={activeId} serverInfo={serverInfo} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
              {t("chat.initializing")}
            </div>
          )
        ) : (
          <WorkspaceView section={activeView} onSelectView={handleSelectView} />
        )}
      </AppShell>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}

export default App;
