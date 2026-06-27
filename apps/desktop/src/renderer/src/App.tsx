import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { api } from "./lib/api";
import { SettingKey } from "@shared/types";

/**
 * 应用根组件
 *
 * 职责：
 *  - 管理当前激活的会话 ID
 *  - 协调侧边栏、聊天视图、设置弹窗之间的交互
 *  - 启动时恢复上次会话
 */
function App(): React.JSX.Element {
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
    const conv = await api.conversations.create(id, "新会话");
    setActiveId(conv.id);
    await api.settings.set(SettingKey.ActiveConversationId, conv.id);
  }, []);

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
            正在初始化...
          </div>
        )}
      </AppShell>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
