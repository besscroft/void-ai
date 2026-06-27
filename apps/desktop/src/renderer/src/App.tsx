import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { api } from "./lib/api";
import { SettingsProvider, useSettings } from "./lib/settings";
import { AppI18nProvider, useT } from "./lib/i18n";
import { SettingKey } from "@shared/types";

/**
 * 应用根组件
 *
 * Provider 嵌套顺序：
 *   SettingsProvider（设置/外观/语言数据源）
 *     └─ AppRoot（读取语言 → 提供 i18n）
 *          └─ AppContent（持有会话状态，渲染主体）
 *
 * 语言切换由 settings 驱动，变更后 AppI18nProvider 重建 context，
 * 所有消费 useT 的组件自动重渲染。
 */
function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <AppRoot />
    </SettingsProvider>
  );
}

/** 读取设置中的语言，向下提供 i18n */
function AppRoot(): React.JSX.Element {
  const { settings } = useSettings();
  return (
    <AppI18nProvider locale={settings.language}>
      <AppContent />
    </AppI18nProvider>
  );
}

/**
 * 应用主体
 *
 * 职责：
 *  - 管理当前激活的会话 ID
 *  - 协调侧边栏、聊天视图、设置弹窗之间的交互
 *  - 启动时恢复上次会话
 */
function AppContent(): React.JSX.Element {
  const { t } = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 启动时恢复上次会话；没有则自动创建一个
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
      // 首次启动：自动新建一个会话
      await createNewConversation();
    })();
  }, []);

  const createNewConversation = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const conv = await api.conversations.create(id, t("shell.newConversation"));
    setActiveId(conv.id);
    await api.settings.set(SettingKey.ActiveConversationId, conv.id);
  }, [t]);

  const handleSelect = useCallback((id: string): void => {
    setActiveId(id);
    void api.settings.set(SettingKey.ActiveConversationId, id);
  }, []);

  const handleDelete = useCallback(
    (id: string): void => {
      // 删除后切换到第一个剩余会话；没有则新建
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
        activeConversationId={activeId}
        onSelectConversation={handleSelect}
        onCreateConversation={() => void createNewConversation()}
        onDeleteConversation={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {activeId ? (
          <ChatView key={activeId} conversationId={activeId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
            {t("chat.initializing")}
          </div>
        )}
      </AppShell>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
