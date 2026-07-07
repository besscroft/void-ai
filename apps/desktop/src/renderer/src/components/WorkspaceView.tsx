import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Drawer,
  Input,
  Label,
  Modal,
  Switch,
  Tabs,
  TextArea,
  Tooltip,
  useOverlayState,
} from "@heroui/react";
import { api, type WorkspaceSnapshot } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_ID,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  type AgentHandoffConfig,
  type AgentInput,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentRuntimeStatus,
  type AgentToolPolicy,
  type ChatToolId,
  type ChatToolReference,
  type ManagedModelInfo,
  type WorkflowStep,
} from "@shared/types";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconEdit,
  IconGlobe,
  IconLayout,
  IconPlus,
  IconRotateCcw,
  IconSettings,
  IconSliders,
  IconTrash,
} from "./icons";

export type WorkspaceSection =
  | "dashboard"
  | "agents"
  | "workflows"
  | "memory"
  | "sandbox"
  | "harness"
  | "server"
  | "interactions"
  | "sync";

interface WorkspaceViewProps {
  section: WorkspaceSection;
  onSelectView?: (view: WorkspaceSection | "chat") => void;
}

const sectionTitleKey: Record<WorkspaceSection, TranslationKey> = {
  dashboard: "workspace.title.dashboard",
  agents: "workspace.title.agents",
  workflows: "workspace.title.workflows",
  memory: "workspace.title.memory",
  sandbox: "workspace.title.sandbox",
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
  sandbox: "workspace.subtitle.sandbox",
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

const runtimeStatusKeys: Record<AgentRuntimeStatus, TranslationKey> = {
  idle: "status.sync.idle",
  queued: "status.run.queued",
  running: "status.run.running",
  reviewing: "status.agentRuntime.reviewing",
  handoff: "status.agentRuntime.handoff",
  tool_calling: "status.agentRuntime.toolCalling",
  sandbox: "status.agentRuntime.sandbox",
  learning: "status.agentRuntime.learning",
  failed: "status.run.failed",
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

const agentHandoffModeKeys: Record<AgentHandoffConfig["mode"], TranslationKey> = {
  both: "workspace.agent.option.handoff.both",
  consult: "workspace.agent.option.handoff.consult",
  handoff: "workspace.agent.option.handoff.handoff",
};

const agentHandoffPriorityKeys: Record<AgentHandoffConfig["priority"], TranslationKey> = {
  high: "workspace.agent.option.priority.high",
  low: "workspace.agent.option.priority.low",
  normal: "workspace.agent.option.priority.normal",
};

export function WorkspaceView({ section, onSelectView }: WorkspaceViewProps): React.JSX.Element {
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
          <WorkspaceErrorBoundary resetKey={section} onRetry={refresh}>
            <WorkspaceContent
              section={section}
              snapshot={snapshot}
              refresh={refresh}
              onSelectView={onSelectView}
            />
          </WorkspaceErrorBoundary>
        )}
      </main>
    </div>
  );
}

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; resetKey: WorkspaceSection; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[workspace] render failed:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: { resetKey: WorkspaceSection }): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="max-w-lg rounded-md border border-danger/25 bg-danger/10 px-4 py-4 text-sm text-danger">
          <div className="font-semibold">Workspace view failed</div>
          <p className="mt-2 break-words text-danger/80">{this.state.error.message}</p>
          <Button
            className="mt-4"
            size="sm"
            variant="secondary"
            onPress={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }
}

function WorkspaceContent({
  section,
  snapshot,
  refresh,
  onSelectView,
}: {
  section: WorkspaceSection;
  snapshot: WorkspaceSnapshot;
  refresh: () => void;
  onSelectView?: (view: WorkspaceSection | "chat") => void;
}): React.JSX.Element {
  if (section === "agents") return <AgentsPanel snapshot={snapshot} refresh={refresh} />;
  if (section === "workflows") return <WorkflowsPanel snapshot={snapshot} />;
  if (section === "memory") return <MemoryPanel snapshot={snapshot} />;
  if (section === "sandbox") return <SandboxPanel snapshot={snapshot} />;
  if (section === "harness") return <HarnessPanel snapshot={snapshot} />;
  if (section === "server") return <ServerPanel snapshot={snapshot} />;
  if (section === "interactions") return <InteractionsPanel snapshot={snapshot} />;
  if (section === "sync") return <SyncPanel snapshot={snapshot} />;
  return <DashboardPanel snapshot={snapshot} onSelectView={onSelectView} />;
}

function DashboardPanel({
  snapshot,
  onSelectView,
}: {
  snapshot: WorkspaceSnapshot;
  onSelectView?: (view: WorkspaceSection | "chat") => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const runtimeByAgent = new Map(
    snapshot.agentRuntimeStates.map((state) => [state.agent_id, state]),
  );
  const voidAgent =
    snapshot.agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ??
    snapshot.agents.find((agent) => agent.kind === "main");
  const visibleAgents = [
    ...(voidAgent ? [voidAgent] : []),
    ...snapshot.agents.filter((agent) => agent.kind === "child").slice(0, 5),
  ];
  const activeAgents = snapshot.agents.filter(
    (agent) => agent.status === "active" && agent.enabled !== 0,
  ).length;
  const busyStates = snapshot.agentRuntimeStates.filter((state) =>
    ["queued", "running", "reviewing", "handoff", "tool_calling", "sandbox", "learning"].includes(
      state.status,
    ),
  );
  const lastRun = snapshot.agentRuns[0] ?? null;
  const recentActivity = snapshot.harnessEvents
    .filter(
      (event) => event.kind === "agent" || event.kind === "handoff" || event.kind === "learning",
    )
    .slice(0, 6);
  const quickActions = [
    { view: "chat", label: t("shell.nav.conversations"), Icon: IconLayout },
    { view: "agents", label: t("workspace.title.agents"), Icon: IconCpu },
    { view: "memory", label: t("workspace.title.memory"), Icon: IconDatabase },
    { view: "workflows", label: t("workspace.title.workflows"), Icon: IconSliders },
  ] satisfies Array<{
    view: WorkspaceSection | "chat";
    label: string;
    Icon: typeof IconLayout;
  }>;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-foreground/10 bg-foreground/[0.025] p-4">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground/70">
              {t("workspace.dashboard.readyTitle")}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/55">
              {t("workspace.dashboard.readyDescription")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-2">
            <DashboardSignal
              label={t("workspace.metric.activeAgents")}
              value={f.number(activeAgents)}
            />
            <DashboardSignal
              label={t("workspace.metric.memories")}
              value={f.number(snapshot.memories.length)}
            />
            <DashboardSignal
              label={t("workspace.dashboard.runningNow")}
              value={f.number(busyStates.length)}
            />
            <DashboardSignal
              label={t("workspace.dashboard.lastRun")}
              value={lastRun ? labelFor(t, statusKeys, lastRun.status) : t("workspace.value.never")}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading title={t("workspace.dashboard.agentsGlance")} />
            <Button
              variant="secondary"
              size="sm"
              onPress={() => onSelectView?.("agents")}
              isDisabled={!onSelectView}
            >
              <IconCpu className="size-3.5" />
              {t("workspace.dashboard.manageAgents")}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleAgents.map((agent) => {
              const runtime = runtimeByAgent.get(agent.id);
              const handoff = normalizeAgentHandoffConfig(agent.handoff_config_json);
              return (
                <Card key={agent.id} className="min-h-36">
                  <Card.Content>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-sm font-semibold text-accent">
                          {agent.avatar || agent.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{agent.name}</p>
                          <p className="mt-0.5 truncate text-xs text-foreground/50">{agent.role}</p>
                        </div>
                      </div>
                      <StatusChip status={runtime?.status ?? "idle"} />
                    </div>
                    <div className="mt-4 grid gap-1.5 text-xs text-foreground/55">
                      <InfoRow
                        label={t("workspace.agent.field.lifecycle")}
                        value={labelFor(t, statusKeys, agent.status)}
                      />
                      <InfoRow
                        label={t("workspace.agent.field.routing")}
                        value={`${labelFor(t, agentHandoffModeKeys, handoff.mode)} / ${labelFor(
                          t,
                          agentHandoffPriorityKeys,
                          handoff.priority,
                        )}`}
                      />
                      <InfoRow
                        label={t("workspace.agent.field.updated")}
                        value={agent.updated_at ? f.dateTime(agent.updated_at) : "-"}
                      />
                    </div>
                  </Card.Content>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <SectionHeading title={t("workspace.dashboard.recentActivity")} />
          <Timeline items={recentActivity} />
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map(({ view, label, Icon }) => (
          <button
            key={view}
            type="button"
            className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background px-4 py-3 text-left text-sm transition hover:border-accent/35 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!onSelectView}
            onClick={() => onSelectView?.(view)}
          >
            <span className="font-medium">{label}</span>
            <Icon className="size-4 text-foreground/45" />
          </button>
        ))}
      </section>
    </div>
  );
}

function DashboardSignal({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-md border border-foreground/10 bg-background/60 px-3 py-2">
      <p className="text-xs text-foreground/45">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

type AgentFormState = {
  name: string;
  role: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status: AgentProfile["status"];
  enabled: boolean;
  model_ref: string;
  voice: string;
  toolPolicy: AgentToolPolicy;
  handoffConfig: AgentHandoffConfig;
  runtimeConfig: AgentRuntimeConfig;
};

function AgentsPanel({
  snapshot,
  refresh,
}: {
  snapshot: WorkspaceSnapshot;
  refresh: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const detailState = useOverlayState();
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null);
  const [form, setForm] = useState<AgentFormState>(() => buildAgentForm());
  const [detailTab, setDetailTab] = useState("overview");
  const [editorTab, setEditorTab] = useState("basics");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<AgentValidationErrors>({});
  const [managedModels, setManagedModels] = useState<ManagedModelInfo[]>([]);

  useEffect(() => {
    void api.providers
      .listManagedModels()
      .then((models) =>
        setManagedModels(
          models.filter((model) => model.enabled && model.capabilities.textGeneration),
        ),
      )
      .catch(() => setManagedModels([]));
  }, []);

  const runtimeByAgent = useMemo(
    () => new Map(snapshot.agentRuntimeStates.map((state) => [state.agent_id, state])),
    [snapshot.agentRuntimeStates],
  );
  const voidAgent =
    snapshot.agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ??
    snapshot.agents.find((agent) => agent.kind === "main");
  const orderedAgents = useMemo(() => {
    const main = snapshot.agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ?? voidAgent;
    const children = snapshot.agents.filter((agent) => agent.kind === "child");
    return [...(main ? [main] : []), ...children];
  }, [snapshot.agents, voidAgent]);
  const activeChildren = snapshot.agents.filter(
    (agent) => agent.kind === "child" && agent.status === "active" && agent.enabled !== 0,
  ).length;

  const openCreate = (): void => {
    setEditingAgent(null);
    setForm(buildAgentForm());
    setError(null);
    setValidationErrors({});
    setEditorTab("basics");
    setEditorMode("create");
  };

  const openDetail = (agent: AgentProfile): void => {
    setSelectedAgent(agent);
    setDetailTab("overview");
    detailState.open();
  };

  const openEdit = (agent: AgentProfile): void => {
    if (isLockedAgent(agent)) return;
    setEditingAgent(agent);
    setForm(buildAgentForm(agent));
    setError(null);
    setValidationErrors({});
    setEditorTab("basics");
    setEditorMode("edit");
  };

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveAgent = async (): Promise<void> => {
    const nextValidationErrors = validateAgentForm(form, t);
    setValidationErrors(nextValidationErrors);
    if (Object.keys(nextValidationErrors).length > 0) {
      setError(t("workspace.agent.validation.requiredSummary"));
      return;
    }

    const input = buildAgentInput(form);
    await runAction(async () => {
      if (editingAgent) await api.agents.update(editingAgent.id, input);
      else await api.agents.create(input);
      setEditorMode(null);
      setEditingAgent(null);
    });
  };

  if (snapshot.agents.length === 0) return <EmptyPanel />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground/70">{t("workspace.agent.roster")}</p>
          <p className="mt-1 text-sm text-foreground/50">
            {t("workspace.agent.rosterSummary", { count: f.number(activeChildren) })}
          </p>
        </div>
        <Button size="sm" variant="primary" onPress={openCreate}>
          <IconPlus className="size-3.5" />
          {t("workspace.agent.new")}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {orderedAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            runtime={runtimeByAgent.get(agent.id)}
            latestRun={latestRunFor(snapshot.agentRuns, agent.id)}
            isBusy={saving}
            onOpen={() => openDetail(agent)}
            onEdit={() => openEdit(agent)}
            onToggle={(enabled) => void runAction(() => api.agents.update(agent.id, { enabled }))}
            onDuplicate={() => void runAction(() => api.agents.duplicate(agent.id))}
            onArchive={() => void runAction(() => api.agents.archive(agent.id))}
            onRestore={() => void runAction(() => api.agents.restore(agent.id))}
          />
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <AgentDetailDrawer
        agent={selectedAgent}
        snapshot={snapshot}
        selectedTab={detailTab}
        setSelectedTab={setDetailTab}
        state={detailState}
        onClose={() => {
          detailState.close();
          setSelectedAgent(null);
        }}
        onEdit={(agent) => {
          detailState.close();
          openEdit(agent);
        }}
      />

      <AgentEditorModal
        mode={editorMode}
        agent={editingAgent}
        form={form}
        isSaving={saving}
        error={error}
        validationErrors={validationErrors}
        onChange={setForm}
        onSave={() => void saveAgent()}
        onClose={() => {
          if (saving) return;
          setEditorMode(null);
          setEditingAgent(null);
          setValidationErrors({});
          setError(null);
        }}
        managedModels={managedModels}
        selectedTab={editorTab}
        setSelectedTab={setEditorTab}
      />
    </div>
  );
}

type AgentRuntimeStateItem = WorkspaceSnapshot["agentRuntimeStates"][number];
type AgentRunItem = WorkspaceSnapshot["agentRuns"][number];
type AgentValidationErrors = Partial<
  Record<"name" | "role" | "description" | "personality" | "soul_prompt", string>
>;

function AgentCard({
  agent,
  runtime,
  latestRun,
  isBusy,
  onOpen,
  onEdit,
  onToggle,
  onDuplicate,
  onArchive,
  onRestore,
}: {
  agent: AgentProfile;
  runtime?: AgentRuntimeStateItem;
  latestRun?: AgentRunItem;
  isBusy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const locked = isLockedAgent(agent);
  const toolPolicy = normalizeAgentToolPolicy(agent.tool_policy_json);
  const handoffConfig = normalizeAgentHandoffConfig(agent.handoff_config_json);
  const runtimeConfig = normalizeAgentRuntimeConfig(agent.runtime_config_json);
  const latestRunLabel = latestRun
    ? `${labelFor(t, statusKeys, latestRun.status)} / ${f.dateTime(latestRun.started_at)}`
    : t("workspace.value.never");

  return (
    <Card className="min-h-[260px] transition hover:border-accent/30 hover:bg-foreground/[0.018]">
      <Card.Content>
        <div
          role="button"
          tabIndex={0}
          className="flex h-full cursor-pointer flex-col outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onOpen();
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-accent/10 text-sm font-semibold text-accent">
                {agent.avatar || agent.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold">{agent.name}</p>
                  {locked ? (
                    <Chip size="sm" variant="secondary">
                      {t("workspace.agent.locked")}
                    </Chip>
                  ) : null}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{agent.role}</p>
              </div>
            </div>
            <StatusChip status={runtime?.status ?? "idle"} />
          </div>

          <p className="mt-4 line-clamp-2 text-sm leading-6 text-foreground/62">
            {agent.description}
          </p>

          <div className="mt-4 grid gap-1.5 text-xs text-foreground/55">
            <InfoRow
              label={t("workspace.agent.field.lifecycle")}
              value={<StatusChip status={agent.status} />}
            />
            <InfoRow
              label={t("workspace.agent.field.enabled")}
              value={
                agent.enabled !== 0 ? t("workspace.agent.available") : t("workspace.value.off")
              }
            />
            <InfoRow
              label={t("workspace.agent.field.routing")}
              value={`${labelFor(t, agentHandoffModeKeys, handoffConfig.mode)} / ${labelFor(
                t,
                agentHandoffPriorityKeys,
                handoffConfig.priority,
              )}`}
            />
            <InfoRow
              label={t("workspace.agent.field.tools")}
              value={toolPolicySummary(t, toolPolicy)}
            />
            <InfoRow
              label={t("workspace.agent.field.model")}
              value={agent.model_ref ?? t("workspace.agent.inherit")}
            />
            <InfoRow
              label={t("workspace.agent.field.runtime")}
              value={t("workspace.agent.turns", { count: f.number(runtimeConfig.maxTurns) })}
            />
            <InfoRow label={t("workspace.agent.field.latest")} value={latestRunLabel} />
          </div>

          <div
            className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"
            onClick={(event) => event.stopPropagation()}
          >
            <Switch
              size="sm"
              isSelected={agent.enabled !== 0}
              isDisabled={isBusy || locked}
              onChange={onToggle}
              aria-label={t("workspace.agent.enableAria", { name: agent.name })}
            >
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                {t("workspace.agent.enabledSwitch")}
              </Switch.Content>
            </Switch>
            <div className="flex items-center gap-1">
              <IconButton label={t("common.edit")} isDisabled={locked || isBusy} onPress={onEdit}>
                <IconEdit className="size-3.5" />
              </IconButton>
              <IconButton
                label={t("workspace.agent.action.duplicate")}
                isDisabled={locked || isBusy}
                onPress={onDuplicate}
              >
                <IconCopy className="size-3.5" />
              </IconButton>
              {agent.status === "archived" ? (
                <IconButton
                  label={t("common.restore")}
                  isDisabled={locked || isBusy}
                  onPress={onRestore}
                >
                  <IconRotateCcw className="size-3.5" />
                </IconButton>
              ) : (
                <IconButton
                  label={t("workspace.agent.action.archive")}
                  tone="danger"
                  isDisabled={locked || isBusy}
                  onPress={onArchive}
                >
                  <IconTrash className="size-3.5" />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}

function AgentDetailDrawer({
  agent,
  snapshot,
  selectedTab,
  setSelectedTab,
  state,
  onClose,
  onEdit,
}: {
  agent: AgentProfile | null;
  snapshot: WorkspaceSnapshot;
  selectedTab: string;
  setSelectedTab: (key: string) => void;
  state: ReturnType<typeof useOverlayState>;
  onClose: () => void;
  onEdit: (agent: AgentProfile) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const runs = agent ? runsForAgent(snapshot.agentRuns, agent.id) : [];
  const runIds = new Set(runs.map((run) => run.id));
  const steps = snapshot.agentRunSteps
    .filter((step) => step.agent_id === agent?.id || runIds.has(step.run_id))
    .slice(0, 16);
  const activity = agent ? harnessEventsForAgent(snapshot, agent).slice(0, 8) : [];
  const runtime = agent
    ? snapshot.agentRuntimeStates.find((state) => state.agent_id === agent.id)
    : undefined;
  const toolPolicy = normalizeAgentToolPolicy(agent?.tool_policy_json);
  const handoffConfig = normalizeAgentHandoffConfig(agent?.handoff_config_json);
  const runtimeConfig = normalizeAgentRuntimeConfig(agent?.runtime_config_json);
  const locked = agent ? isLockedAgent(agent) : true;
  const routingLabel = `${labelFor(t, agentHandoffModeKeys, handoffConfig.mode)} / ${labelFor(
    t,
    agentHandoffPriorityKeys,
    handoffConfig.priority,
  )}`;
  const overviewItems = agent
    ? [
        {
          label: t("workspace.agent.field.enabled"),
          value: agent.enabled !== 0 ? t("workspace.agent.available") : t("workspace.value.off"),
        },
        { label: t("workspace.agent.field.handoff"), value: routingLabel },
        {
          label: t("workspace.agent.field.accepts"),
          value: handoffConfig.accepts.join(", ") || t("workspace.agent.anyMatchingTask"),
        },
        {
          label: t("workspace.agent.field.tools"),
          value: toolPolicySummary(t, toolPolicy),
        },
        {
          label: t("workspace.agent.field.model"),
          value: agent.model_ref ?? t("workspace.agent.modelInherit"),
        },
        {
          label: t("workspace.agent.field.voice"),
          value: agent.voice ?? t("workspace.agent.default"),
        },
        { label: t("workspace.agent.field.maxTurns"), value: f.number(runtimeConfig.maxTurns) },
        { label: t("workspace.agent.field.updated"), value: f.dateTime(agent.updated_at) },
        {
          label: t("workspace.agent.field.lastLearning"),
          value: formatNullableDate(
            f,
            runtime?.last_learning_at ?? null,
            t("workspace.value.never"),
          ),
        },
        ...(runtime?.last_error
          ? [{ label: t("workspace.agent.field.lastError"), value: runtime.last_error }]
          : []),
      ]
    : [];

  return (
    <Drawer state={state}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content
          placement="right"
          className="w-[calc(100vw_-_24px)] max-w-4xl sm:w-[min(920px,calc(100vw_-_320px))]"
        >
          <Drawer.Dialog className="flex h-full min-h-0 flex-col">
            <Drawer.Header className="shrink-0">
              <div className="min-w-0">
                <Drawer.Heading>
                  {agent?.name ?? t("workspace.agent.detailFallback")}
                </Drawer.Heading>
                <p className="mt-1 text-sm text-foreground/50">{agent?.role}</p>
              </div>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="min-h-0 flex-1 overflow-y-auto">
              {agent ? (
                <Tabs
                  selectedKey={selectedTab}
                  onSelectionChange={(key) => setSelectedTab(String(key))}
                  variant="secondary"
                >
                  <Tabs.ListContainer className="overflow-x-auto">
                    <Tabs.List
                      className="min-w-max"
                      aria-label={t("workspace.agent.detailTabsLabel")}
                    >
                      <Tabs.Tab id="overview">{t("workspace.agent.tab.overview")}</Tabs.Tab>
                      <Tabs.Tab id="instructions">{t("workspace.agent.tab.instructions")}</Tabs.Tab>
                      <Tabs.Tab id="runs">{t("workspace.agent.tab.runs")}</Tabs.Tab>
                      <Tabs.Tab id="activity">{t("workspace.agent.tab.activity")}</Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel id="overview" className="space-y-4 pt-4">
                    <div className="flex items-start gap-3 rounded-md border border-foreground/10 p-3">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-accent/10 text-base font-semibold text-accent">
                        {agent.avatar || agent.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-6 text-foreground/70">{agent.description}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <StatusChip status={agent.status} />
                          <StatusChip status={runtime?.status ?? "idle"} />
                          {locked ? (
                            <Chip size="sm" variant="secondary">
                              {t("workspace.agent.lockedRoot")}
                            </Chip>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <DetailInfoGrid items={overviewItems} />
                  </Tabs.Panel>

                  <Tabs.Panel id="instructions" className="space-y-3 pt-4">
                    <ReadOnlyBlock
                      title={t("workspace.agent.field.personality")}
                      value={agent.personality}
                    />
                    <ReadOnlyBlock
                      title={t("workspace.agent.field.soulPrompt")}
                      value={agent.soul_prompt}
                    />
                    <ReadOnlyBlock
                      title={t("workspace.agent.field.expectedOutput")}
                      value={handoffConfig.expectedOutput || t("workspace.agent.noOutputContract")}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel id="runs" className="pt-4">
                    <AgentRunsList runs={runs} />
                  </Tabs.Panel>

                  <Tabs.Panel id="activity" className="space-y-4 pt-4">
                    <MiniList
                      title={t("workspace.agent.runSteps")}
                      empty={t("workspace.agent.noSteps")}
                      items={steps.map((step) => ({
                        id: step.id,
                        title: step.title,
                        detail: `${step.kind} / ${labelFor(t, statusKeys, step.status)} / ${f.dateTime(
                          step.started_at,
                        )}`,
                      }))}
                    />
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-normal text-foreground/40">
                        {t("workspace.agent.harnessEvents")}
                      </div>
                      <Timeline items={activity} />
                    </div>
                  </Tabs.Panel>
                </Tabs>
              ) : null}
            </Drawer.Body>
            <Drawer.Footer className="shrink-0 border-t border-foreground/10">
              <div className="flex w-full justify-between gap-2">
                <Button variant="tertiary" onPress={onClose}>
                  {t("common.close")}
                </Button>
                <Button
                  variant="primary"
                  onPress={() => agent && onEdit(agent)}
                  isDisabled={!agent || locked}
                >
                  {t("workspace.agent.action.editAgent")}
                </Button>
              </div>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function AgentEditorModal({
  mode,
  agent,
  form,
  isSaving,
  error,
  validationErrors,
  onChange,
  onSave,
  onClose,
  managedModels,
  selectedTab,
  setSelectedTab,
}: {
  mode: "create" | "edit" | null;
  agent: AgentProfile | null;
  form: AgentFormState;
  isSaving: boolean;
  error: string | null;
  validationErrors: AgentValidationErrors;
  onChange: (next: AgentFormState) => void;
  onSave: () => void;
  onClose: () => void;
  managedModels: ManagedModelInfo[];
  selectedTab: string;
  setSelectedTab: (key: string) => void;
}): React.JSX.Element {
  const { t } = useT();
  const open = mode !== null;

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop isDismissable={!isSaving}>
        <Modal.Container
          size="lg"
          placement="center"
          scroll="inside"
          className="w-[min(920px,calc(100vw_-_32px))] max-w-4xl"
        >
          <Modal.Dialog className="flex max-h-[min(760px,calc(100vh_-_48px))] min-h-0 flex-col">
            <Modal.Header className="shrink-0">
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <Modal.Heading className="text-base font-semibold">
                    {mode === "edit"
                      ? t("workspace.agent.editTitle", {
                          name: agent?.name ?? t("workspace.agent.editFallback"),
                        })
                      : t("workspace.agent.new")}
                  </Modal.Heading>
                  <p className="mt-1 text-sm text-foreground/50">
                    {t("workspace.agent.editorDescription")}
                  </p>
                </div>
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onClose}
                  isDisabled={isSaving}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4">
                {error ? (
                  <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                ) : null}

                <Tabs
                  selectedKey={selectedTab}
                  onSelectionChange={(key) => setSelectedTab(String(key))}
                  variant="secondary"
                >
                  <Tabs.ListContainer className="overflow-x-auto">
                    <Tabs.List
                      className="min-w-max"
                      aria-label={t("workspace.agent.editorTabsLabel")}
                    >
                      <Tabs.Tab id="basics">{t("workspace.agent.tab.basics")}</Tabs.Tab>
                      <Tabs.Tab id="instructions">{t("workspace.agent.tab.instructions")}</Tabs.Tab>
                      <Tabs.Tab id="runtime">{t("workspace.agent.tab.runtime")}</Tabs.Tab>
                      <Tabs.Tab id="routing">{t("workspace.agent.tab.routing")}</Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel id="basics" className="space-y-3 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextInputField
                        label={t("workspace.agent.field.name")}
                        required
                        value={form.name}
                        error={validationErrors.name}
                        onChange={(name) => onChange({ ...form, name })}
                      />
                      <TextInputField
                        label={t("workspace.agent.field.avatar")}
                        value={form.avatar}
                        onChange={(avatar) => onChange({ ...form, avatar: avatar.slice(0, 2) })}
                      />
                      <TextInputField
                        label={t("workspace.agent.field.role")}
                        required
                        value={form.role}
                        error={validationErrors.role}
                        onChange={(role) => onChange({ ...form, role })}
                      />
                      <SelectField
                        label={t("workspace.agent.field.lifecycle")}
                        value={form.status}
                        onChange={(status) =>
                          onChange({ ...form, status: status as AgentProfile["status"] })
                        }
                        options={[
                          ["active", t("status.agent.active")],
                          ["draft", t("status.agent.draft")],
                          ["archived", t("status.agent.archived")],
                        ]}
                      />
                    </div>
                    <Switch
                      size="sm"
                      isSelected={form.enabled}
                      onChange={(enabled) => onChange({ ...form, enabled })}
                      aria-label={t("workspace.agent.enabledSwitch")}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        {t("workspace.agent.enabledForOrchestration")}
                      </Switch.Content>
                    </Switch>
                    <TextAreaField
                      label={t("workspace.agent.field.description")}
                      required
                      rows={3}
                      value={form.description}
                      error={validationErrors.description}
                      onChange={(description) => onChange({ ...form, description })}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel id="instructions" className="space-y-3 pt-4">
                    <TextAreaField
                      label={t("workspace.agent.field.personality")}
                      required
                      rows={4}
                      value={form.personality}
                      error={validationErrors.personality}
                      onChange={(personality) => onChange({ ...form, personality })}
                    />
                    <TextAreaField
                      label={t("workspace.agent.field.soulPrompt")}
                      required
                      rows={8}
                      value={form.soul_prompt}
                      error={validationErrors.soul_prompt}
                      onChange={(soul_prompt) => onChange({ ...form, soul_prompt })}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel id="runtime" className="space-y-4 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SelectField
                        label={t("workspace.agent.field.modelOverride")}
                        value={form.model_ref}
                        onChange={(model_ref) => onChange({ ...form, model_ref })}
                        options={[
                          ["", t("workspace.agent.modelInherit")],
                          ...managedModels.map(
                            (model) =>
                              [
                                model.ref,
                                `${model.providerLabel} / ${model.modelLabel ?? model.modelId}`,
                              ] satisfies [string, string],
                          ),
                        ]}
                      />
                      <TextInputField
                        label={t("workspace.agent.field.voice")}
                        placeholder={t("workspace.agent.optionalVoice")}
                        value={form.voice}
                        onChange={(voice) => onChange({ ...form, voice })}
                      />
                      <NumberField
                        label={t("workspace.agent.field.maxTurns")}
                        min={1}
                        max={20}
                        value={form.runtimeConfig.maxTurns}
                        onChange={(maxTurns) =>
                          onChange({
                            ...form,
                            runtimeConfig: { ...form.runtimeConfig, maxTurns },
                          })
                        }
                      />
                      <NumberField
                        label={t("workspace.agent.field.temperature")}
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.runtimeConfig.temperature ?? 0.7}
                        onChange={(temperature) =>
                          onChange({
                            ...form,
                            runtimeConfig: { ...form.runtimeConfig, temperature },
                          })
                        }
                      />
                      <NumberField
                        label={t("workspace.agent.field.topP")}
                        min={0}
                        max={1}
                        step={0.05}
                        value={form.runtimeConfig.topP ?? 1}
                        onChange={(topP) =>
                          onChange({
                            ...form,
                            runtimeConfig: { ...form.runtimeConfig, topP },
                          })
                        }
                      />
                      <NumberField
                        label={t("workspace.agent.field.maxOutputTokens")}
                        min={1}
                        max={32768}
                        value={form.runtimeConfig.maxOutputTokens ?? 4096}
                        onChange={(maxOutputTokens) =>
                          onChange({
                            ...form,
                            runtimeConfig: { ...form.runtimeConfig, maxOutputTokens },
                          })
                        }
                      />
                      <SelectField
                        label={t("workspace.agent.field.reasoning")}
                        value={form.runtimeConfig.reasoning ?? "provider-default"}
                        onChange={(reasoning) =>
                          onChange({
                            ...form,
                            runtimeConfig: {
                              ...form.runtimeConfig,
                              reasoning: reasoning as AgentRuntimeConfig["reasoning"],
                            },
                          })
                        }
                        options={[
                          ["provider-default", t("reasoning.level.provider-default")],
                          ["none", t("reasoning.level.none")],
                          ["minimal", t("reasoning.level.minimal")],
                          ["low", t("reasoning.level.low")],
                          ["medium", t("reasoning.level.medium")],
                          ["high", t("reasoning.level.high")],
                          ["xhigh", t("reasoning.level.xhigh")],
                        ]}
                      />
                      <SelectField
                        label={t("workspace.agent.field.reviewPolicy")}
                        value={form.runtimeConfig.reviewPolicy ?? "review_sensitive"}
                        onChange={(reviewPolicy) =>
                          onChange({
                            ...form,
                            runtimeConfig: {
                              ...form.runtimeConfig,
                              reviewPolicy: reviewPolicy as AgentRuntimeConfig["reviewPolicy"],
                            },
                          })
                        }
                        options={[
                          ["inherit", t("workspace.agent.option.review.inherit")],
                          ["auto", t("workspace.agent.option.review.auto")],
                          ["review_sensitive", t("workspace.agent.option.review.sensitive")],
                          ["review_all", t("workspace.agent.option.review.all")],
                        ]}
                      />
                      <SelectField
                        label={t("workspace.agent.field.sandboxPolicy")}
                        value={form.runtimeConfig.sandboxPolicy ?? "local"}
                        onChange={(sandboxPolicy) =>
                          onChange({
                            ...form,
                            runtimeConfig: {
                              ...form.runtimeConfig,
                              sandboxPolicy: sandboxPolicy as AgentRuntimeConfig["sandboxPolicy"],
                            },
                          })
                        }
                        options={[
                          ["inherit", t("workspace.agent.option.sandbox.inherit")],
                          ["disabled", t("workspace.agent.option.sandbox.disabled")],
                          ["local", t("workspace.agent.option.sandbox.local")],
                          ["docker", t("workspace.agent.option.sandbox.docker")],
                        ]}
                      />
                    </div>
                    <ToolPolicyEditor form={form} onChange={onChange} />
                  </Tabs.Panel>

                  <Tabs.Panel id="routing" className="space-y-3 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SelectField
                        label={t("workspace.agent.field.mode")}
                        value={form.handoffConfig.mode}
                        onChange={(mode) =>
                          onChange({
                            ...form,
                            handoffConfig: {
                              ...form.handoffConfig,
                              mode: mode as AgentHandoffConfig["mode"],
                            },
                          })
                        }
                        options={[
                          ["handoff", t("workspace.agent.option.handoff.handoff")],
                          ["consult", t("workspace.agent.option.handoff.consult")],
                          ["both", t("workspace.agent.option.handoff.both")],
                        ]}
                      />
                      <SelectField
                        label={t("workspace.agent.field.priority")}
                        value={form.handoffConfig.priority}
                        onChange={(priority) =>
                          onChange({
                            ...form,
                            handoffConfig: {
                              ...form.handoffConfig,
                              priority: priority as AgentHandoffConfig["priority"],
                            },
                          })
                        }
                        options={[
                          ["low", t("workspace.agent.option.priority.low")],
                          ["normal", t("workspace.agent.option.priority.normal")],
                          ["high", t("workspace.agent.option.priority.high")],
                        ]}
                      />
                    </div>
                    <TextInputField
                      label={t("workspace.agent.field.accepts")}
                      placeholder={t("workspace.agent.acceptsPlaceholder")}
                      value={form.handoffConfig.accepts.join(", ")}
                      onChange={(raw) =>
                        onChange({
                          ...form,
                          handoffConfig: {
                            ...form.handoffConfig,
                            accepts: splitCommaList(raw),
                          },
                        })
                      }
                    />
                    <TextAreaField
                      label={t("workspace.agent.field.expectedOutput")}
                      rows={4}
                      value={form.handoffConfig.expectedOutput}
                      onChange={(expectedOutput) =>
                        onChange({
                          ...form,
                          handoffConfig: { ...form.handoffConfig, expectedOutput },
                        })
                      }
                    />
                  </Tabs.Panel>
                </Tabs>
              </div>
            </Modal.Body>
            <Modal.Footer className="shrink-0 border-t border-foreground/10">
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={onClose} isDisabled={isSaving}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  onPress={onSave}
                  isPending={isSaving}
                  isDisabled={isSaving}
                >
                  {t("workspace.agent.action.save")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ReadOnlyBlock({ title, value }: { title: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-foreground/10 bg-foreground/[0.025] p-3">
      <p className="text-xs font-medium uppercase tracking-normal text-foreground/40">{title}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/68">{value}</p>
    </div>
  );
}

function DetailInfoGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}): React.JSX.Element {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-foreground/10 px-3 py-2.5">
          <div className="text-xs text-foreground/42">{item.label}</div>
          <div className="mt-1 min-w-0 break-words text-sm font-medium leading-5 text-foreground/72">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolPolicyEditor({
  form,
  onChange,
}: {
  form: AgentFormState;
  onChange: (next: AgentFormState) => void;
}): React.JSX.Element {
  const { t } = useT();
  const custom = form.toolPolicy.mode === "custom";
  const setPolicy = (toolPolicy: AgentToolPolicy): void => onChange({ ...form, toolPolicy });

  return (
    <div className="rounded-md border border-foreground/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t("workspace.agent.toolPolicy.title")}</div>
          <div className="text-xs text-foreground/50">
            {t("workspace.agent.toolPolicy.description")}
          </div>
        </div>
        <SelectField
          label={t("workspace.agent.field.mode")}
          compact
          value={form.toolPolicy.mode}
          onChange={(mode) =>
            setPolicy({ ...form.toolPolicy, mode: mode as AgentToolPolicy["mode"] })
          }
          options={[
            ["inherit", t("workspace.agent.option.toolPolicy.inherit")],
            ["custom", t("workspace.agent.option.toolPolicy.custom")],
          ]}
        />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ToolCheckboxGroup
          title={t("workspace.agent.toolPolicy.allowed")}
          disabled={!custom}
          selected={custom ? form.toolPolicy.allowedToolIds : CHAT_TOOL_IDS}
          onToggle={(toolId, selected) =>
            setPolicy({
              ...form.toolPolicy,
              allowedToolIds: toggleToolId(form.toolPolicy.allowedToolIds, toolId, selected),
            })
          }
        />
        <ToolCheckboxGroup
          title={t("workspace.agent.toolPolicy.approval")}
          selected={form.toolPolicy.requireApprovalToolIds}
          onToggle={(toolId, selected) =>
            setPolicy({
              ...form.toolPolicy,
              requireApprovalToolIds: toggleToolId(
                form.toolPolicy.requireApprovalToolIds,
                toolId,
                selected,
              ),
            })
          }
        />
      </div>
    </div>
  );
}

function ToolCheckboxGroup({
  title,
  selected,
  onToggle,
  disabled = false,
}: {
  title: string;
  selected: readonly ChatToolReference[];
  onToggle: (toolId: ChatToolId, selected: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-normal text-foreground/45">
        {title}
      </div>
      <div className="grid gap-1.5">
        {CHAT_TOOL_IDS.map((toolId) => (
          <Checkbox
            key={toolId}
            isDisabled={disabled}
            isSelected={selected.includes(toolId)}
            onChange={(checked) => onToggle(toolId, checked)}
          >
            <Checkbox.Content className="items-center gap-2 text-sm">
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span>{toolId}</span>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </div>
  );
}

function AgentRunsList({ runs }: { runs: WorkspaceSnapshot["agentRuns"] }): React.JSX.Element {
  const { t, f } = useT();
  if (runs.length === 0) {
    return <EmptyPanel />;
  }
  return (
    <div className="space-y-2">
      {runs.slice(0, 12).map((run) => (
        <div
          key={run.id}
          className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm md:grid-cols-[1fr_auto]"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{run.id.slice(0, 8)}</span>
              <StatusChip status={run.status} />
              <span className="text-xs text-foreground/45">
                {run.model_ref ?? t("workspace.agent.modelInheritShort")}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-foreground/50">
              {run.output_summary ??
                run.input_summary ??
                run.error ??
                t("workspace.agent.noSummary")}
            </div>
          </div>
          <span className="text-xs text-foreground/45">{f.dateTime(run.started_at)}</span>
        </div>
      ))}
    </div>
  );
}

function MiniList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ id: string; title: string; detail: string }>;
  empty: string;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-normal text-foreground/40">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-foreground/10 px-3 py-2 text-xs text-foreground/40">
          {empty}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="rounded-md bg-foreground/[0.04] px-3 py-2">
              <div className="truncate text-xs font-medium">{item.title}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{item.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  children,
  onPress,
  tone = "secondary",
  isDisabled = false,
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  tone?: "secondary" | "danger";
  isDisabled?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip>
      <Button
        aria-label={label}
        isIconOnly
        size="sm"
        variant={tone === "danger" ? "danger" : "secondary"}
        onPress={onPress}
        isDisabled={isDisabled}
      >
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

function TextInputField({
  label,
  value,
  onChange,
  placeholder,
  error,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      <Input
        fullWidth
        value={value}
        placeholder={placeholder}
        aria-invalid={!!error}
        className={error ? "border-danger/50" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <Input
        fullWidth
        type="number"
        min={min}
        max={max}
        step={step}
        value={String(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows,
  error,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  error?: string;
  required?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      <TextArea
        fullWidth
        rows={rows}
        value={value}
        aria-invalid={!!error}
        className={error ? "border-danger/50" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className={`grid gap-1.5 ${compact ? "min-w-36" : ""}`}>
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <select
        className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-sm outline-none transition focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function isLockedAgent(agent: AgentProfile): boolean {
  return agent.locked !== 0 || agent.kind === "main" || agent.id === DEFAULT_AGENT_ID;
}

function validateAgentForm(form: AgentFormState, t: TFunction): AgentValidationErrors {
  const errors: AgentValidationErrors = {};
  const required = t("workspace.agent.validation.required");
  if (!form.name.trim()) errors.name = required;
  if (!form.role.trim()) errors.role = required;
  if (!form.description.trim()) errors.description = required;
  if (!form.personality.trim()) errors.personality = required;
  if (!form.soul_prompt.trim()) errors.soul_prompt = required;
  return errors;
}

function toolPolicySummary(t: TFunction, policy: AgentToolPolicy): string {
  if (policy.mode === "inherit") return t("workspace.agent.inherit");
  const allowed = policy.allowedToolIds.length;
  const approvals = policy.requireApprovalToolIds.length;
  return approvals > 0
    ? t("workspace.agent.toolPolicy.summaryWithApproval", { allowed, approvals })
    : t("workspace.agent.toolPolicy.summaryAllowed", { allowed });
}

function harnessEventsForAgent(
  snapshot: WorkspaceSnapshot,
  agent: AgentProfile,
): WorkspaceSnapshot["harnessEvents"] {
  const runs = runsForAgent(snapshot.agentRuns, agent.id);
  const runIds = new Set(runs.map((run) => run.id));
  const name = agent.name.toLowerCase();
  const root = isLockedAgent(agent);
  return snapshot.harnessEvents.filter((event) => {
    const detail = event.detail_json.toLowerCase();
    const title = event.title.toLowerCase();
    return (
      detail.includes(agent.id.toLowerCase()) ||
      [...runIds].some((runId) => detail.includes(runId.toLowerCase())) ||
      title.includes(name) ||
      (root && ["agent", "handoff", "learning"].includes(event.kind))
    );
  });
}

function buildAgentForm(agent?: AgentProfile): AgentFormState {
  return {
    name: agent?.name ?? "",
    role: agent?.role ?? "",
    description: agent?.description ?? "",
    personality: agent?.personality ?? "",
    soul_prompt: agent?.soul_prompt ?? "",
    avatar: agent?.avatar ?? "A",
    status: agent?.status ?? "active",
    enabled: agent?.enabled !== 0,
    model_ref: agent?.model_ref ?? "",
    voice: agent?.voice ?? "",
    toolPolicy: normalizeAgentToolPolicy(agent?.tool_policy_json),
    handoffConfig: normalizeAgentHandoffConfig(agent?.handoff_config_json),
    runtimeConfig: normalizeAgentRuntimeConfig(agent?.runtime_config_json),
  };
}

function buildAgentInput(form: AgentFormState): AgentInput {
  return {
    name: form.name,
    role: form.role,
    description: form.description,
    personality: form.personality,
    soul_prompt: form.soul_prompt,
    avatar: form.avatar,
    status: form.status,
    enabled: form.enabled,
    model_ref: form.model_ref.trim() || null,
    voice: form.voice.trim() || null,
    tool_policy_json: JSON.stringify(normalizeAgentToolPolicy(form.toolPolicy)),
    handoff_config_json: JSON.stringify(normalizeAgentHandoffConfig(form.handoffConfig)),
    runtime_config_json: JSON.stringify(normalizeAgentRuntimeConfig(form.runtimeConfig)),
  };
}

function splitCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function toggleToolId(
  list: ChatToolReference[],
  toolId: ChatToolId,
  selected: boolean,
): ChatToolReference[] {
  const next = selected ? [...list, toolId] : list.filter((item) => item !== toolId);
  return [...new Set(next)];
}

function latestRunFor(runs: WorkspaceSnapshot["agentRuns"], agentId: string) {
  return runs.find((run) => run.final_agent_id === agentId || run.root_agent_id === agentId);
}

function runsForAgent(runs: WorkspaceSnapshot["agentRuns"], agentId: string) {
  return runs.filter((run) => run.final_agent_id === agentId || run.root_agent_id === agentId);
}

function formatNullableDate(
  f: ReturnType<typeof useT>["f"],
  value: number | null,
  fallback: string,
): string {
  return value ? f.dateTime(value) : fallback;
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

function SandboxPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  const { f } = useT();
  const sandboxSteps = snapshot.agentRunSteps
    .filter((step) => step.kind === "sandbox")
    .slice(0, 12);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconLayout />}
          label="Sessions"
          value={f.number(snapshot.sandboxSessions.length)}
          detail="local-first sandbox runs"
        />
        <MetricCard
          icon={<IconDatabase />}
          label="Snapshots"
          value={f.number(snapshot.sandboxSnapshots.length)}
          detail="restorable file states"
        />
        <MetricCard
          icon={<IconGlobe />}
          label="Artifacts"
          value={f.number(snapshot.sandboxArtifacts.length)}
          detail="files and preview ports"
        />
        <MetricCard
          icon={<IconCpu />}
          label="Actions"
          value={f.number(sandboxSteps.length)}
          detail="recent sandbox steps"
        />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <Card.Header>
            <Card.Title>Sandbox sessions</Card.Title>
            <Card.Description>
              Isolation mode, run link, root path, and last update
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {snapshot.sandboxSessions.length === 0 ? (
              <EmptyPanel />
            ) : (
              <div className="space-y-2">
                {snapshot.sandboxSessions.map((session) => (
                  <div
                    key={session.id}
                    className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{session.id}</span>
                      <span className="flex flex-wrap gap-1.5">
                        <StatusChip status={session.status} />
                        <Chip size="sm" variant="secondary">
                          {session.isolation_mode}
                        </Chip>
                        {session.docker_available ? (
                          <Chip size="sm" color="success" variant="soft">
                            Docker detected
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="secondary">
                            Local fallback
                          </Chip>
                        )}
                      </span>
                    </div>
                    <div className="truncate text-xs text-foreground/50">{session.root_path}</div>
                    <div className="text-xs text-foreground/45">
                      {session.run_id ? `Run ${session.run_id.slice(0, 8)} / ` : ""}
                      Updated {f.dateTime(session.updated_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>

        <div className="space-y-4">
          <Card>
            <Card.Header>
              <Card.Title>Snapshots</Card.Title>
              <Card.Description>Saved sandbox file manifests</Card.Description>
            </Card.Header>
            <Card.Content>
              <MiniList
                title="Recent"
                empty="No snapshots yet"
                items={snapshot.sandboxSnapshots.slice(0, 8).map((snapshot) => ({
                  id: snapshot.id,
                  title: snapshot.label,
                  detail: `${snapshot.id.slice(0, 8)} / ${f.dateTime(snapshot.created_at)}`,
                }))}
              />
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Artifacts</Card.Title>
              <Card.Description>Exported files and preview URLs</Card.Description>
            </Card.Header>
            <Card.Content>
              <MiniList
                title="Recent"
                empty="No artifacts yet"
                items={snapshot.sandboxArtifacts.slice(0, 8).map((artifact) => ({
                  id: artifact.id,
                  title: artifact.path,
                  detail: artifact.url ?? `${artifact.kind} / ${artifact.size_bytes ?? 0} bytes`,
                }))}
              />
            </Card.Content>
          </Card>
        </div>
      </section>

      <SectionHeading title="Command and sandbox history" />
      {sandboxSteps.length === 0 ? (
        <EmptyPanel />
      ) : (
        <div className="grid gap-2">
          {sandboxSteps.map((step) => (
            <div
              key={step.id}
              className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{step.title}</span>
                  <StatusChip status={step.status} />
                </div>
                <div className="mt-1 truncate text-xs text-foreground/50">
                  {step.error ?? step.detail_json}
                </div>
              </div>
              <span className="text-xs text-foreground/45">{f.dateTime(step.started_at)}</span>
            </div>
          ))}
        </div>
      )}
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

function InfoRow({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <p className="grid gap-1 sm:grid-cols-[120px_1fr]">
      <span className="text-foreground/40">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}

function StatusChip({ status }: { status: string }): React.JSX.Element {
  const { t } = useT();
  const label = statusKeys[status]
    ? t(statusKeys[status])
    : runtimeStatusKeys[status as AgentRuntimeStatus]
      ? t(runtimeStatusKeys[status as AgentRuntimeStatus])
      : status;
  const color =
    status === "succeeded" || status === "active" || status === "enabled" || status === "online"
      ? "success"
      : status === "failed" || status === "error" || status === "blocked"
        ? "danger"
        : status === "running" ||
            status === "syncing" ||
            status === "handoff" ||
            status === "tool_calling" ||
            status === "learning" ||
            status === "queued"
          ? "accent"
          : "default";
  return (
    <Chip size="sm" color={color} variant="soft">
      {label}
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
