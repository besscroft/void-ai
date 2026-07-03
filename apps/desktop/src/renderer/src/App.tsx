import { useCallback, useEffect, useState } from "react";
import { AppShell, type AppView } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WorkspaceView } from "./components/WorkspaceView";
import { api } from "./lib/api";
import { SettingsProvider, useSettings } from "./lib/settings";
import { AppI18nProvider, useT } from "./lib/i18n";
import { SettingKey } from "@shared/types";
import { Toaster } from "sonner";

function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <AppRoot />
    </SettingsProvider>
  );
}

function AppRoot(): React.JSX.Element {
  const { settings } = useSettings();
  return (
    <AppI18nProvider locale={settings.language}>
      <AppContent />
    </AppI18nProvider>
  );
}

function AppContent(): React.JSX.Element {
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const createNewConversation = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const conv = await api.conversations.create(id, t("shell.newConversation"));
    setActiveId(conv.id);
    setActiveView("chat");
    await api.settings.set(SettingKey.ActiveConversationId, conv.id);
  }, [t]);

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

  return (
    <>
      <AppShell
        activeView={activeView}
        activeConversationId={activeId}
        onSelectView={setActiveView}
        onSelectConversation={handleSelect}
        onCreateConversation={() => void createNewConversation()}
        onDeleteConversation={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {activeView === "chat" ? (
          activeId ? (
            <ChatView key={activeId} conversationId={activeId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
              {t("chat.initializing")}
            </div>
          )
        ) : (
          <WorkspaceView section={activeView} />
        )}
      </AppShell>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}

export default App;
