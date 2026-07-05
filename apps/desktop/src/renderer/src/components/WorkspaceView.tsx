import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { api, type WorkspaceSnapshot } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import type { WorkflowStep } from "@shared/types";
import {
  IconCheck,
  IconCpu,
  IconDatabase,
  IconGlobe,
  IconLayout,
  IconRotateCcw,
  IconSettings,
  IconSliders,
} from "./icons";

export type WorkspaceSection =
  | "dashboard"
  | "agents"
  | "workflows"
  | "memory"
  | "harness"
  | "server"
  | "interactions"
  | "sync";

interface WorkspaceViewProps {
  section: WorkspaceSection;
}

const sectionTitleKey: Record<WorkspaceSection, TranslationKey> = {
  dashboard: "workspace.title.dashboard",
  agents: "workspace.title.agents",
  workflows: "workspace.title.workflows",
  memory: "workspace.title.memory",
  harness: "workspace.title.harness",
  server: "workspace.title.server",
  interactions: "workspace.title.interactions",
  sync: "workspace.title.sync",
};

const sectionSubtitleKey: Record<WorkspaceSection, TranslationKey> = {
  dashboard: "workspace.subtitle.dashboard",
  agents: "workspace.subtitle.agents",
  workflows: "workspace.subtitle.workflows",
  memory: "workspace.subtitle.memory",
  harness: "workspace.subtitle.harness",
  server: "workspace.subtitle.server",
  interactions: "workspace.subtitle.interactions",
  sync: "workspace.subtitle.sync",
};

const statusKeys: Record<string, TranslationKey> = {
  active: "status.agent.active",
  archived: "status.agent.archived",
  blocked: "status.interaction.blocked",
  cancelled: "status.run.cancelled",
  disabled: "status.server.disabled",
  draft: "status.agent.draft",
  enabled: "status.workflow.enabled",
  error: "status.sync.error",
  failed: "status.run.failed",
  idle: "status.sync.idle",
  offline: "status.server.offline",
  online: "status.server.online",
  paused: "status.workflow.paused",
  prototype: "status.interaction.prototype",
  queued: "status.run.queued",
  ready: "status.interaction.ready",
  running: "status.run.running",
  succeeded: "status.run.succeeded",
  syncing: "status.sync.syncing",
};

const workspaceKindKeys: Record<string, TranslationKey> = {
  cloud: "workspace.kind.cloud",
  local: "workspace.kind.local",
  mcp: "workspace.kind.mcp",
  sync: "workspace.kind.sync",
};

const memoryScopeKeys: Record<string, TranslationKey> = {
  agent: "workspace.memory.scope.agent",
  conversation: "workspace.memory.scope.conversation",
  global: "workspace.memory.scope.global",
};

const memoryKindKeys: Record<string, TranslationKey> = {
  episode: "workspace.memory.kind.episode",
  fact: "workspace.memory.kind.fact",
  preference: "workspace.memory.kind.preference",
  profile: "workspace.memory.kind.profile",
  skill: "workspace.memory.kind.skill",
};

const interactionKindKeys: Record<string, TranslationKey> = {
  chat: "workspace.interaction.chat",
  desktop_pet: "workspace.interaction.desktop_pet",
  mouse: "workspace.interaction.mouse",
  video: "workspace.interaction.video",
  voice: "workspace.interaction.voice",
};

const syncModeKeys: Record<string, TranslationKey> = {
  cloud: "workspace.sync.mode.cloud",
  local_only: "workspace.sync.mode.local_only",
  manual: "workspace.sync.mode.manual",
};

const syncConflictKeys: Record<string, TranslationKey> = {
  last_write_wins: "workspace.sync.conflict.last_write_wins",
  merge_with_review: "workspace.sync.conflict.merge_with_review",
};

export function WorkspaceView({ section }: WorkspaceViewProps): React.JSX.Element {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = (): void => {
    setLoading(true);
    void api.workspace
      .snapshot()
      .then(setSnapshot)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-normal">
            {t(sectionTitleKey[section])}
          </h1>
          <p className="mt-1 text-sm text-foreground/55">{t(sectionSubtitleKey[section])}</p>
        </div>
        <Button variant="secondary" size="sm" onPress={refresh} isPending={loading}>
          <IconRotateCcw className="size-3.5" />
          {loading ? t("common.loading") : t("workspace.refresh")}
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-5">
        {!snapshot ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground/45">
            {t("workspace.loading")}
          </div>
        ) : (
          <WorkspaceContent section={section} snapshot={snapshot} />
        )}
      </main>
    </div>
  );
}

function WorkspaceContent({
  section,
  snapshot,
}: {
  section: WorkspaceSection;
  snapshot: WorkspaceSnapshot;
}): React.JSX.Element {
  if (section === "agents") return <AgentsPanel snapshot={snapshot} />;
  if (section === "workflows") return <WorkflowsPanel snapshot={snapshot} />;
  if (section === "memory") return <MemoryPanel snapshot={snapshot} />;
  if (section === "harness") return <HarnessPanel snapshot={snapshot} />;
  if (section === "server") return <ServerPanel snapshot={snapshot} />;
  if (section === "interactions") return <InteractionsPanel snapshot={snapshot} />;
  if (section === "sync") return <SyncPanel snapshot={snapshot} />;
  return <DashboardPanel snapshot={snapshot} />;
}

function DashboardPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t, f } = useT();
  const activeAgents = snapshot.agents.filter((agent) => agent.status === "active").length;
  const enabledWorkflows = snapshot.workflows.filter(
    (workflow) => workflow.status === "enabled",
  ).length;
  const enabledInteractions = snapshot.interactionProfiles.filter((item) => item.enabled).length;
  const architecture = [
    ["workspace.arch.client.title", "workspace.arch.client.detail"],
    ["workspace.arch.runtime.title", "workspace.arch.runtime.detail"],
    ["workspace.arch.state.title", "workspace.arch.state.detail"],
    ["workspace.arch.cloud.title", "workspace.arch.cloud.detail"],
  ] satisfies Array<[TranslationKey, TranslationKey]>;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconCpu />}
          label={t("workspace.metric.activeAgents")}
          value={f.number(activeAgents)}
          detail={t("workspace.metric.total", { count: f.number(snapshot.agents.length) })}
        />
        <MetricCard
          icon={<IconSliders />}
          label={t("workspace.metric.workflows")}
          value={f.number(enabledWorkflows)}
          detail={t("workspace.metric.runs", { count: f.number(snapshot.workflowRuns.length) })}
        />
        <MetricCard
          icon={<IconDatabase />}
          label={t("workspace.metric.memories")}
          value={f.number(snapshot.memories.length)}
          detail={t("workspace.metric.pinned", {
            count: f.number(snapshot.memories.filter((m) => m.pinned).length),
          })}
        />
        <MetricCard
          icon={<IconLayout />}
          label={t("workspace.metric.inputs")}
          value={f.number(enabledInteractions)}
          detail={t("workspace.metric.surfaces", {
            count: f.number(snapshot.interactionProfiles.length),
          })}
        />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <SectionHeading title={t("workspace.section.architectureLayers")} />
          <div className="grid gap-3 md:grid-cols-2">
            {architecture.map(([titleKey, detailKey]) => (
              <Card key={titleKey} className="min-h-32">
                <Card.Header>
                  <Card.Title>{t(titleKey)}</Card.Title>
                  <Card.Description>{t(detailKey)}</Card.Description>
                </Card.Header>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <SectionHeading title={t("workspace.section.recentHarness")} />
          <Timeline items={snapshot.harnessEvents.slice(0, 5)} />
        </div>
      </section>
    </div>
  );
}

function AgentsPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t } = useT();
  if (snapshot.agents.length === 0) return <EmptyPanel />;

  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {snapshot.agents.map((agent) => (
        <Card key={agent.id}>
          <Card.Header>
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                {agent.avatar}
              </span>
              <StatusChip status={agent.status} />
            </div>
            <Card.Title>{agent.name}</Card.Title>
            <Card.Description>{agent.role}</Card.Description>
          </Card.Header>
          <Card.Content>
            <p className="text-sm text-foreground/70">{agent.description}</p>
            <div className="mt-4 grid gap-2 text-xs text-foreground/55">
              <InfoRow label={t("workspace.info.personality")} value={agent.personality} />
              <InfoRow label={t("workspace.info.soul")} value={agent.soul_prompt} />
              <InfoRow
                label={t("workspace.info.voice")}
                value={agent.voice ?? t("workspace.value.notSet")}
              />
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function WorkflowsPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t, f } = useT();
  if (snapshot.workflows.length === 0 && snapshot.workflowRuns.length === 0) return <EmptyPanel />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-2">
        {snapshot.workflows.map((workflow) => {
          const steps = parseJson<WorkflowStep[]>(workflow.steps_json, []);
          return (
            <Card key={workflow.id}>
              <Card.Header>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <StatusChip status={workflow.status} />
                  <span className="text-xs text-foreground/45">{workflow.trigger}</span>
                </div>
                <Card.Title>{workflow.name}</Card.Title>
                <Card.Description>{workflow.description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <ol className="space-y-2">
                  {steps.map((step, index) => (
                    <li
                      key={step.id}
                      className="flex gap-3 rounded-md border border-foreground/10 px-3 py-2"
                    >
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px]">
                        {f.number(index + 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{step.title}</span>
                        <span className="block text-xs text-foreground/55">{step.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card.Content>
            </Card>
          );
        })}
      </div>

      <SectionHeading title={t("workspace.section.runs")} />
      <div className="grid gap-2">
        {snapshot.workflowRuns.map((run) => (
          <div
            key={run.id}
            className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto]"
          >
            <span className="font-medium">{run.workflow_id}</span>
            <StatusChip status={run.status} />
            <span className="text-xs text-foreground/45">{f.dateTime(run.started_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t, f } = useT();
  if (snapshot.memories.length === 0) return <EmptyPanel />;

  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {snapshot.memories.map((memory) => (
        <Card key={memory.id}>
          <Card.Header>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Chip size="sm" color={memory.pinned ? "accent" : "default"} variant="soft">
                {labelFor(t, memoryScopeKeys, memory.scope)} /{" "}
                {labelFor(t, memoryKindKeys, memory.kind)}
              </Chip>
              <span className="text-xs text-foreground/45">{f.number(memory.salience)}</span>
            </div>
            <Card.Title>{memory.title}</Card.Title>
            <Card.Description>{memory.content}</Card.Description>
          </Card.Header>
        </Card>
      ))}
    </div>
  );
}

function HarnessPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  if (snapshot.harnessEvents.length === 0) return <EmptyPanel />;
  return <Timeline items={snapshot.harnessEvents} />;
}

function ServerPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t } = useT();
  if (snapshot.serverNodes.length === 0) return <EmptyPanel />;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {snapshot.serverNodes.map((node) => {
        const capabilities = parseJson<string[]>(node.capabilities_json, []);
        return (
          <Card key={node.id}>
            <Card.Header>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Chip
                  size="sm"
                  color={node.status === "online" ? "success" : "default"}
                  variant="soft"
                >
                  {labelFor(t, workspaceKindKeys, node.kind)} /{" "}
                  {labelFor(t, statusKeys, node.status)}
                </Chip>
                <IconGlobe className="size-4 text-foreground/45" />
              </div>
              <Card.Title>{node.name}</Card.Title>
              <Card.Description>{node.url}</Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="flex flex-wrap gap-2">
                {capabilities.map((capability) => (
                  <Chip key={capability} size="sm" variant="secondary">
                    {capability}
                  </Chip>
                ))}
              </div>
            </Card.Content>
          </Card>
        );
      })}
    </div>
  );
}

function InteractionsPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t } = useT();
  if (snapshot.interactionProfiles.length === 0) return <EmptyPanel />;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {snapshot.interactionProfiles.map((profile) => {
        const config = parseJson<Record<string, string>>(profile.config_json, {});
        return (
          <Card key={profile.id}>
            <Card.Header>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Chip size="sm" color={profile.enabled ? "success" : "default"} variant="soft">
                  {profile.enabled ? t("workspace.value.enabled") : t("workspace.value.off")}
                </Chip>
                <StatusChip status={profile.status} />
              </div>
              <Card.Title>{profile.label}</Card.Title>
              <Card.Description>{labelFor(t, interactionKindKeys, profile.kind)}</Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="grid gap-2 text-xs text-foreground/55">
                {Object.entries(config).map(([key, value]) => (
                  <InfoRow key={key} label={key} value={String(value)} />
                ))}
              </div>
            </Card.Content>
          </Card>
        );
      })}
    </div>
  );
}

function SyncPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { t, f } = useT();
  const sync = snapshot.syncState;
  const syncCards = [
    ["workspace.sync.localVault.title", "workspace.sync.localVault.detail"],
    ["workspace.sync.outbox.title", "workspace.sync.outbox.detail"],
    ["workspace.sync.merge.title", "workspace.sync.merge.detail"],
  ] satisfies Array<[TranslationKey, TranslationKey]>;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <Card.Header>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Chip size="sm" color="accent" variant="soft">
              {labelFor(t, syncModeKeys, sync.mode)}
            </Chip>
            <StatusChip
              status={
                sync.status === "error"
                  ? "failed"
                  : sync.status === "syncing"
                    ? "running"
                    : "succeeded"
              }
            />
          </div>
          <Card.Title>{t("workspace.sync.deviceSync")}</Card.Title>
          <Card.Description>
            {sync.endpoint ?? t("workspace.value.localVaultOnly")}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="grid gap-2 text-xs text-foreground/60">
            <InfoRow label={t("workspace.info.device")} value={sync.device_id} />
            <InfoRow
              label={t("workspace.info.encryption")}
              value={
                sync.encryption_enabled
                  ? t("workspace.value.enabled")
                  : t("workspace.value.disabled")
              }
            />
            <InfoRow
              label={t("workspace.info.conflicts")}
              value={labelFor(t, syncConflictKeys, sync.conflict_strategy)}
            />
            <InfoRow
              label={t("workspace.info.lastSync")}
              value={
                sync.last_synced_at ? f.dateTime(sync.last_synced_at) : t("workspace.value.never")
              }
            />
          </div>
        </Card.Content>
      </Card>

      <div className="space-y-3">
        <SectionHeading title={t("workspace.section.syncPlan")} />
        <div className="grid gap-3 md:grid-cols-3">
          {syncCards.map(([titleKey, detailKey]) => (
            <Card key={titleKey}>
              <Card.Header>
                <Card.Title>{t(titleKey)}</Card.Title>
                <Card.Description>{t(detailKey)}</Card.Description>
              </Card.Header>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
}): React.JSX.Element {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-normal text-foreground/45">
              {label}
            </p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-foreground/50">{detail}</p>
          </div>
          <span className="flex size-9 items-center justify-center rounded-md bg-accent/10 text-accent [&>svg]:size-4">
            {icon}
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}

function Timeline({ items }: { items: WorkspaceSnapshot["harnessEvents"] }): React.JSX.Element {
  const { f } = useT();
  if (items.length === 0) return <EmptyPanel />;

  return (
    <div className="space-y-2">
      {items.map((event) => (
        <div
          key={event.id}
          className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2.5 sm:grid-cols-[auto_1fr_auto]"
        >
          <span className="mt-1 flex size-6 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground/55">
            {event.status === "succeeded" ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconSettings className="size-3.5" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{event.title}</span>
            <span className="block truncate text-xs text-foreground/50">{event.kind}</span>
          </span>
          <span className="flex items-center gap-2">
            <StatusChip status={event.status} />
            <span className="text-xs text-foreground/40">{f.dateTime(event.created_at)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title }: { title: string }): React.JSX.Element {
  return <h2 className="text-sm font-semibold text-foreground/70">{title}</h2>;
}

function EmptyPanel(): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="rounded-md border border-dashed border-foreground/15 px-4 py-10 text-center text-sm text-foreground/45">
      {t("common.empty")}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <p className="grid gap-1 sm:grid-cols-[120px_1fr]">
      <span className="text-foreground/40">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}

function StatusChip({ status }: { status: string }): React.JSX.Element {
  const { t } = useT();
  const color =
    status === "succeeded" || status === "active" || status === "enabled" || status === "online"
      ? "success"
      : status === "failed" || status === "error" || status === "blocked"
        ? "danger"
        : status === "running" || status === "syncing"
          ? "accent"
          : "default";
  return (
    <Chip size="sm" color={color} variant="soft">
      {labelFor(t, statusKeys, status)}
    </Chip>
  );
}

type TFunction = ReturnType<typeof useT>["t"];

function labelFor(t: TFunction, keys: Record<string, TranslationKey>, value: string): string {
  const key = keys[value];
  return key ? t(key) : value;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
