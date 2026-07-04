import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import {
  IconMessage,
  IconPlus,
  IconSettings,
  IconSun,
  IconMonitor,
  IconTrash,
  IconCpu,
  IconSliders,
  IconDatabase,
  IconLayout,
  IconGlobe,
  IconKey,
  IconSearch,
  IconClose,
} from "./icons";
import type { Conversation } from "@shared/types";
import type { WorkspaceSection } from "./WorkspaceView";
import { ConfirmDialog } from "./ConfirmDialog";

export type AppView = "chat" | WorkspaceSection;

interface AppShellProps {
  activeView: AppView;
  activeConversationId: string | null;
  onSelectView: (view: AppView) => void;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  children: ReactNode;
}

const primaryNav: { id: AppView; label: string; Icon: typeof IconMessage }[] = [
  { id: "dashboard", label: "Void OS", Icon: IconLayout },
  { id: "chat", label: "Chat", Icon: IconMessage },
  { id: "agents", label: "Agents", Icon: IconCpu },
  { id: "workflows", label: "Workflows", Icon: IconSliders },
  { id: "memory", label: "Memory", Icon: IconDatabase },
  { id: "harness", label: "Harness", Icon: IconKey },
  { id: "server", label: "Server", Icon: IconGlobe },
  { id: "interactions", label: "Interactions", Icon: IconMonitor },
  { id: "sync", label: "Sync", Icon: IconSun },
];

export function AppShell({
  activeView,
  activeConversationId,
  onSelectView,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenSettings,
  children,
}: AppShellProps): React.JSX.Element {
  const { t } = useT();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = (): void => {
    void api.conversations.list().then(setConversations);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    refresh();
  }, [activeConversationId]);

  // 监听自动/手动重命名：优先用事件携带的 title 直接更新本地 state；
  // 若没有 title（例如来自其他渠道），则降级为全量 refresh。
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ id: string; title?: string }>).detail;
      if (detail?.id && typeof detail.title === "string" && detail.title.length > 0) {
        setConversations((prev) =>
          prev.map((c) => (c.id === detail.id ? { ...c, title: detail.title as string } : c)),
        );
      } else {
        refresh();
      }
    };
    window.addEventListener("void-ai:conversation-renamed", handler);
    return () => window.removeEventListener("void-ai:conversation-renamed", handler);
  }, []);

  const confirmDeleteConversation = (): void => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    void notify
      .promise(api.conversations.delete(id), {
        loading: t("toast.conversation.deleting"),
        success: t("toast.conversation.deleted"),
        error: t("toast.conversation.deleteFailed"),
      })
      .then(() => {
        refresh();
        onDeleteConversation(id);
      })
      .catch(() => undefined);
    setPendingDelete(null);
  };

  /**
   * 过滤 + 分组（按 updated_at 倒序）
   *
   * 分组策略：
   *  - 今天：updated_at 与今天在同一天
   *  - 昨天：相差 1 天且跨日
   *  - 本周：7 天内
   *  - 更早：其他
   */
  const groupedConversations = useMemo<Array<{ label: string; items: Conversation[] }>>(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    if (filtered.length === 0) return [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    const startOfYesterday = startOfToday - oneDay;
    const startOfWeek = startOfToday - 7 * oneDay;

    const groups: Record<string, Conversation[]> = {};
    const labelFor = (ts: number): string => {
      if (ts >= startOfToday) return t("shell.group.today");
      if (ts >= startOfYesterday) return t("shell.group.yesterday");
      if (ts >= startOfWeek) return t("shell.group.thisWeek");
      return t("shell.group.earlier");
    };
    for (const c of filtered) {
      const ts = c.updated_at ?? c.created_at ?? 0;
      const label = labelFor(ts);
      (groups[label] ??= []).push(c);
    }

    // 固定分组顺序：今天 → 昨天 → 本周 → 更早
    const order = [
      t("shell.group.today"),
      t("shell.group.yesterday"),
      t("shell.group.thisWeek"),
      t("shell.group.earlier"),
    ];
    return order
      .filter((label) => groups[label]?.length)
      .map((label) => ({ label, items: groups[label] }));
  }, [conversations, searchQuery, t]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="app-sidebar flex w-[280px] shrink-0 flex-col border-r border-foreground/10 bg-foreground/[0.025]">
        <div className="border-b border-foreground/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Void AI</p>
              <p className="truncate text-xs text-foreground/45">Local-first agent desktop</p>
            </div>
            <Chip size="sm" color="success" variant="soft">
              local
            </Chip>
          </div>
        </div>

        <nav className="space-y-1 px-2 py-3" aria-label="Workspace">
          {primaryNav.map(({ id, label, Icon }) => {
            const active = activeView === id;
            return (
              <button
                key={id}
                type="button"
                className={[
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
                ].join(" ")}
                onClick={() => onSelectView(id)}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col border-t border-foreground/10">
          <div className="flex items-center justify-between gap-2 px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-normal text-foreground/45">
              {t("shell.conversations")}
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={onCreateConversation}
              aria-label={t("shell.newConversation")}
            >
              <IconPlus className="size-4" />
            </Button>
          </div>

          {/* 创意：搜索框（仅在有会话时显示） */}
          {conversations.length > 0 && (
            <div className="relative px-3 pb-2">
              <IconSearch className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder={t("shell.searchPlaceholder")}
                aria-label={t("shell.searchPlaceholder")}
                className="h-7 w-full rounded-md border border-foreground/10 bg-background/60 pl-7 pr-7 text-xs text-foreground/80 outline-none transition placeholder:text-foreground/35 focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={t("common.close")}
                  className="absolute right-5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground/40 transition hover:text-foreground"
                >
                  <IconClose className="size-3" />
                </button>
              )}
            </div>
          )}

          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversations">
            {groupedConversations.length === 0 ? (
              <p className="whitespace-pre-line px-3 py-8 text-center text-sm text-foreground/50">
                {searchQuery ? t("shell.noSearchResult") : t("shell.noConversation")}
              </p>
            ) : (
              <ul className="space-y-3">
                {groupedConversations.map((group) => (
                  <li key={group.label}>
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/35">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((conv) => {
                        const isActive = conv.id === activeConversationId && activeView === "chat";
                        return (
                          <li key={conv.id}>
                            <div
                              className={[
                                "group/conv flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
                                isActive ? "bg-accent/10 text-accent" : "hover:bg-foreground/5",
                              ].join(" ")}
                              onClick={() => {
                                onSelectConversation(conv.id);
                                onSelectView("chat");
                              }}
                            >
                              <IconMessage className="size-3.5 shrink-0 opacity-60" />
                              <span className="flex-1 truncate text-xs">{conv.title}</span>
                              <button
                                type="button"
                                className="opacity-0 transition group-hover/conv:opacity-100 hover:text-danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPendingDelete(conv);
                                }}
                                aria-label={`${t("common.delete")} ${conv.title}`}
                              >
                                <IconTrash className="size-3" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </div>

        <div className="border-t border-foreground/10 p-2">
          <Button variant="ghost" className="w-full justify-start gap-2" onPress={onOpenSettings}>
            <IconSettings className="size-4" />
            {t("shell.settings")}
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("conversation.delete.title")}
        message={t("conversation.delete.confirm", { title: pendingDelete?.title ?? "" })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={confirmDeleteConversation}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
