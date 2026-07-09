import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AppShell, type AppView } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { MainPanelView } from "./components/MainPanelView";
import { api } from "./lib/api";
import { SettingsProvider, useSettings } from "./lib/settings";
import { AppI18nProvider, useT } from "./lib/i18n";
import { SettingKey, type LocalServerInfo } from "@shared/types";
import { Toaster } from "sonner";
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
      <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
    </AppI18nProvider>
  );
}

function AppContent(): React.JSX.Element {
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 鏈嶅姟绔彛锛歶seChat 蹇呴』鍦ㄩ娆℃覆鏌撳氨鎷垮埌姝ｇ‘ transport锛?
  // 鍥犳绔彛灏辩华鍓嶄笉鎸傝浇 ChatView銆?
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);

  const createNewConversation = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const conv = await api.conversations.create(id, t("shell.newConversation"));
    setActiveId(conv.id);
    setActiveView("chat");
    await api.settings.set(SettingKey.ActiveConversationId, conv.id);
  }, [t]);

  useEffect(() => {
    // 鎻愭棭鎷夊彇鏈湴鏈嶅姟绔彛锛岄伩鍏?ChatView 鍐呴儴 useEffect 鎶㈣窇
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

  // 托盘 / 桌宠右键菜单触发的"打开设置"和"关于"
  useEffect(() => {
    const offSettings = (
      api.system as unknown as { onPetOpenSettings?: (cb: () => void) => () => void }
    ).onPetOpenSettings?.(() => setSettingsOpen(true));
    const offAbout = (
      api.system as unknown as { onPetOpenAbout?: (cb: () => void) => () => void }
    ).onPetOpenAbout?.(() => {
      // 简化：直接弹出 toast 展示应用版本信息
      // 后续可扩展为独立 AboutDialog
      // eslint-disable-next-line no-console
      console.info("[about] Void desktop pet · v0.0.1");
    });
    return () => {
      offSettings?.();
      offAbout?.();
    };
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
          <MainPanelView section={activeView} />
        )}
      </AppShell>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}

export default App;
