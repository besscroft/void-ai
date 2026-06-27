import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";
import {
  IconMessage,
  IconPlus,
  IconSettings,
  IconSun,
  IconMoon,
  IconMonitor,
  IconTrash,
} from "./icons";
import type { Conversation } from "@shared/types";
import type { ThemeMode } from "../lib/theme";

interface AppShellProps {
  /** 当前激活的会话 ID */
  activeConversationId: string | null;
  /** 切换会话回调 */
  onSelectConversation: (id: string) => void;
  /** 新建会话回调 */
  onCreateConversation: () => void;
  /** 删除会话回调 */
  onDeleteConversation: (id: string) => void;
  /** 打开设置回调 */
  onOpenSettings: () => void;
  /** 主区内容 */
  children: ReactNode;
}

/**
 * 应用外壳：左侧栏 + 主区
 *
 * 布局示意（ASCII）：
 * ┌──────────┬───────────────────────────────┐
 * │ + 新会话 │                               │
 * │──────────│          主区（聊天）          │
 * │ 会话1    │                               │
 * │ 会话2 ● │                               │
 * │ 会话3    │                               │
 * │──────────│                               │
 * │ 主题切换 │                               │
 * │ 设置     │                               │
 * └──────────┴───────────────────────────────┘
 */
export function AppShell({
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenSettings,
  children,
}: AppShellProps): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { mode, setMode } = useTheme();

  // 加载会话列表
  const refresh = (): void => {
    void api.conversations.list().then(setConversations);
  };

  useEffect(() => {
    refresh();
  }, []);

  // 当外部新建/删除会话后，刷新列表
  useEffect(() => {
    refresh();
  }, [activeConversationId]);

  const handleDelete = (id: string): void => {
    if (id === activeConversationId) {
      // 删除当前会话后，清空激活态（App 层会处理后续选择）
    }
    void api.conversations.delete(id).then(() => {
      refresh();
      onDeleteConversation(id);
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 侧边栏 */}
      <aside className="flex w-64 flex-col border-r border-foreground/10 bg-foreground/[0.02]">
        {/* 新建会话 */}
        <div className="p-3">
          <Button
            variant="primary"
            className="w-full justify-start gap-2"
            onPress={onCreateConversation}
          >
            <IconPlus className="size-4" />
            新建会话
          </Button>
        </div>

        {/* 会话列表 */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-foreground/50">
              暂无会话
              <br />
              点击上方按钮开始
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                return (
                  <li key={conv.id}>
                    <div
                      className={[
                        "group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                        isActive ? "bg-accent/15 text-accent" : "hover:bg-foreground/5",
                      ].join(" ")}
                      onClick={() => onSelectConversation(conv.id)}
                    >
                      <IconMessage className="size-4 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{conv.title}</span>
                      <button
                        type="button"
                        className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(conv.id);
                        }}
                        aria-label={`删除会话 ${conv.title}`}
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* 底部：主题 + 设置 */}
        <div className="border-t border-foreground/10 p-2">
          <ThemeSwitcher mode={mode} onModeChange={(m) => void setMode(m)} />
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start gap-2"
            onPress={onOpenSettings}
          >
            <IconSettings className="size-4" />
            设置
          </Button>
        </div>
      </aside>

      {/* 主区 */}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

/**
 * 主题切换器：light / dark / system 三选一
 */
function ThemeSwitcher({
  mode,
  onModeChange,
}: {
  mode: ThemeMode;
  onModeChange: (m: ThemeMode) => void;
}): React.JSX.Element {
  const options: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
    { value: "light", label: "浅色", Icon: IconSun },
    { value: "dark", label: "深色", Icon: IconMoon },
    { value: "system", label: "跟随系统", Icon: IconMonitor },
  ];
  return (
    <div className="flex items-center gap-1 rounded-md bg-foreground/5 p-1">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={[
            "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs transition",
            mode === value
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground",
          ].join(" ")}
          onClick={() => onModeChange(value)}
          aria-label={label}
          aria-pressed={mode === value}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
