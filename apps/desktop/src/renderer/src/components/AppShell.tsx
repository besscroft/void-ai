import { useEffect, useState, type ReactNode } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";
import {
  IconMessage,
  IconPlus,
  IconSettings,
  IconSun,
  IconMoon,
  IconMonitor,
  IconTrash,
  IconCpu,
  IconSliders,
  IconDatabase,
  IconLayout,
  IconGlobe,
  IconKey,
} from "./icons";
import type { Conversation } from "@shared/types";
import type { ThemeMode } from "../lib/theme";
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

  const refresh = (): void => {
    void api.conversations.list().then(setConversations);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    refresh();
  }, [activeConversationId]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-foreground/10 bg-foreground/[0.025]">
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
              Conversations
            </span>
            <Button isIconOnly size="sm" variant="tertiary" onPress={onCreateConversation}>
              <IconPlus className="size-4" />
            </Button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversations">
            {conversations.length === 0 ? (
              <p className="whitespace-pre-line px-3 py-8 text-center text-sm text-foreground/50">
                {t("shell.noConversation")}
              </p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conv) => {
                  const isActive = conv.id === activeConversationId && activeView === "chat";
                  return (
                    <li key={conv.id}>
                      <div
                        className={[
                          "group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                          isActive ? "bg-accent/10 text-accent" : "hover:bg-foreground/5",
                        ].join(" ")}
                        onClick={() => {
                          onSelectConversation(conv.id);
                          onSelectView("chat");
                        }}
                      >
                        <IconMessage className="size-4 shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{conv.title}</span>
                        <button
                          type="button"
                          className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(conv);
                          }}
                          aria-label={`${t("common.delete")} ${conv.title}`}
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
        </div>

        <div className="border-t border-foreground/10 p-2">
          <ThemeSwitcher />
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start gap-2"
            onPress={onOpenSettings}
          >
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

function ThemeSwitcher(): React.JSX.Element {
  const { t } = useT();
  const { settings, update } = useSettings();
  const mode = settings.theme;

  const options: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
    { value: "light", label: t("shell.theme.light"), Icon: IconSun },
    { value: "dark", label: t("shell.theme.dark"), Icon: IconMoon },
    { value: "system", label: t("shell.theme.system"), Icon: IconMonitor },
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
          onClick={() => void update({ theme: value })}
          aria-label={label}
          aria-pressed={mode === value}
          title={label}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
