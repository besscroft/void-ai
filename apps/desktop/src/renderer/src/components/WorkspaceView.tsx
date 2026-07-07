import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Drawer,
  Input,
  Label,
  Switch,
  Table,
  Tabs,
  TextArea,
  Tooltip,
  useOverlayState,
} from "@heroui/react";
import { api, type WorkspaceSnapshot } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  DEFAULT_AGENT_ID,
  type AgentHandoffConfig,
  type AgentInput,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentRuntimeStatus,
  type AgentToolPolicy,
  type ChatToolId,
  type ManagedModelInfo,
  type WorkflowStep,
} from "@shared/types";
import {
  IconCheck,
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

const runtimeStatusLabels: Record<AgentRuntimeStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  reviewing: "Reviewing",
  handoff: "Handoff",
  tool_calling: "Tool calling",
  sandbox: "Sandbox",
  learning: "Learning",
  failed: "Failed",
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
          <WorkspaceContent section={section} snapshot={snapshot} refresh={refresh} />
        )}
      </main>
    </div>
  );
}

function WorkspaceContent({
  section,
  snapshot,
  refresh,
}: {
  section: WorkspaceSection;
  snapshot: WorkspaceSnapshot;
  refresh: () => void;
}): React.JSX.Element {
  if (section === "agents") return <AgentsPanel snapshot={snapshot} refresh={refresh} />;
  if (section === "workflows") return <WorkflowsPanel snapshot={snapshot} />;
  if (section === "memory") return <MemoryPanel snapshot={snapshot} />;
  if (section === "sandbox") return <SandboxPanel snapshot={snapshot} />;
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
      <AgentRuntimeBand snapshot={snapshot} compact />

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
  const { f } = useT();
  const drawerState = useOverlayState();
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null);
  const [form, setForm] = useState<AgentFormState>(() => buildAgentForm());
  const [tab, setTab] = useState("identity");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const childAgents = snapshot.agents.filter((agent) => agent.kind === "child");
  const orchestrationEvents = snapshot.harnessEvents
    .filter(
      (event) => event.kind === "agent" || event.kind === "handoff" || event.kind === "learning",
    )
    .slice(0, 8);
  const voidMemories = snapshot.memories
    .filter((memory) => memory.scope === "agent" && memory.agent_id === DEFAULT_AGENT_ID)
    .slice(0, 4);

  const openCreate = (): void => {
    setEditingAgent(null);
    setForm(buildAgentForm());
    setError(null);
    setTab("identity");
    drawerState.open();
  };

  const openEdit = (agent: AgentProfile): void => {
    setEditingAgent(agent);
    setForm(buildAgentForm(agent));
    setError(null);
    setTab("identity");
    drawerState.open();
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
    const input = buildAgentInput(form);
    await runAction(async () => {
      if (editingAgent) await api.agents.update(editingAgent.id, input);
      else await api.agents.create(input);
      drawerState.close();
    });
  };

  if (snapshot.agents.length === 0) return <EmptyPanel />;

  return (
    <div className="space-y-4">
      <AgentRuntimeBand snapshot={snapshot} />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <Card.Header>
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                {voidAgent?.avatar ?? "V"}
              </span>
              <span className="flex items-center gap-2">
                <Chip size="sm" variant="secondary">
                  MAIN
                </Chip>
                <StatusChip status={runtimeByAgent.get(DEFAULT_AGENT_ID)?.status ?? "idle"} />
              </span>
            </div>
            <Card.Title>{voidAgent?.name ?? "Void"}</Card.Title>
            <Card.Description>
              {voidAgent?.role ?? "Root orchestrator for every OpenAI agent run"}
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <p className="text-sm text-foreground/70">
              {voidAgent?.description ??
                "Void is locked. Its memory and soul prompt evolve only through internal learning."}
            </p>
            <div className="mt-4 grid gap-2 text-xs text-foreground/60">
              <InfoRow label="Soul" value={voidAgent?.soul_prompt ?? "Managed internally"} />
              <InfoRow
                label="Learning"
                value={formatNullableDate(
                  f,
                  runtimeByAgent.get(DEFAULT_AGENT_ID)?.last_learning_at ?? null,
                )}
              />
              <InfoRow label="Lock" value="Read-only root agent" />
            </div>
            <div className="mt-4 grid gap-3">
              <MiniList
                title="Recent memory"
                empty="No Void learning memory yet"
                items={voidMemories.map((memory) => ({
                  id: memory.id,
                  title: memory.title,
                  detail: memory.content,
                }))}
              />
              <MiniList
                title="Orchestration"
                empty="No orchestration events yet"
                items={orchestrationEvents.slice(0, 4).map((event) => ({
                  id: event.id,
                  title: event.title,
                  detail: `${event.kind} / ${f.dateTime(event.created_at)}`,
                }))}
              />
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Card.Title>Child agents</Card.Title>
                <Card.Description>
                  Handoff, consult, tool policy, runtime, and lifecycle management
                </Card.Description>
              </div>
              <Button size="sm" variant="primary" onPress={openCreate}>
                <IconPlus className="size-3.5" />
                New agent
              </Button>
            </div>
          </Card.Header>
          <Card.Content>
            {childAgents.length === 0 ? (
              <EmptyPanel />
            ) : (
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label="Child agents">
                    <Table.Header>
                      <Table.Column isRowHeader>Agent</Table.Column>
                      <Table.Column>Status</Table.Column>
                      <Table.Column>Enabled</Table.Column>
                      <Table.Column>Tools</Table.Column>
                      <Table.Column>Handoff</Table.Column>
                      <Table.Column>Latest run</Table.Column>
                      <Table.Column>Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {childAgents.map((agent) => {
                        const runtime = runtimeByAgent.get(agent.id);
                        const toolPolicy = parseJson<AgentToolPolicy>(
                          agent.tool_policy_json,
                          DEFAULT_AGENT_TOOL_POLICY,
                        );
                        const handoffConfig = parseJson<AgentHandoffConfig>(
                          agent.handoff_config_json,
                          DEFAULT_AGENT_HANDOFF_CONFIG,
                        );
                        const latestRun = latestRunFor(snapshot.agentRuns, agent.id);
                        return (
                          <Table.Row key={agent.id}>
                            <Table.Cell>
                              <div className="flex min-w-44 items-center gap-2">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                                  {agent.avatar}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">
                                    {agent.name}
                                  </span>
                                  <span className="block max-w-52 truncate text-xs text-foreground/50">
                                    {agent.role}
                                  </span>
                                </span>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex flex-wrap gap-1.5">
                                <StatusChip status={agent.status} />
                                <StatusChip status={runtime?.status ?? "idle"} />
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <Switch
                                size="sm"
                                isSelected={agent.enabled !== 0}
                                onChange={(enabled) =>
                                  void runAction(() => api.agents.update(agent.id, { enabled }))
                                }
                                aria-label={`Enable ${agent.name}`}
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-xs text-foreground/60">
                                {toolPolicy.mode === "inherit"
                                  ? "Inherit"
                                  : `${toolPolicy.allowedToolIds.length} allowed`}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-xs text-foreground/60">
                                {handoffConfig.mode} / {handoffConfig.priority}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-xs text-foreground/55">
                                {latestRun
                                  ? `${latestRun.status} ${f.dateTime(latestRun.started_at)}`
                                  : "Never"}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex items-center gap-1">
                                <IconButton label="Edit" onPress={() => openEdit(agent)}>
                                  <IconEdit className="size-3.5" />
                                </IconButton>
                                <IconButton
                                  label="Duplicate"
                                  onPress={() =>
                                    void runAction(() => api.agents.duplicate(agent.id))
                                  }
                                >
                                  <IconCopy className="size-3.5" />
                                </IconButton>
                                {agent.status === "archived" ? (
                                  <IconButton
                                    label="Restore"
                                    onPress={() =>
                                      void runAction(() => api.agents.restore(agent.id))
                                    }
                                  >
                                    <IconRotateCcw className="size-3.5" />
                                  </IconButton>
                                ) : (
                                  <IconButton
                                    label="Archive"
                                    tone="danger"
                                    onPress={() =>
                                      void runAction(() => api.agents.archive(agent.id))
                                    }
                                  >
                                    <IconTrash className="size-3.5" />
                                  </IconButton>
                                )}
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </Card.Content>
        </Card>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <AgentDrawer
        agent={editingAgent}
        form={form}
        isSaving={saving}
        onChange={setForm}
        onSave={() => void saveAgent()}
        runs={editingAgent ? runsForAgent(snapshot.agentRuns, editingAgent.id) : []}
        managedModels={managedModels}
        selectedTab={tab}
        setSelectedTab={setTab}
        state={drawerState}
      />
    </div>
  );
}

function AgentRuntimeBand({
  snapshot,
  compact = false,
}: {
  snapshot: WorkspaceSnapshot;
  compact?: boolean;
}): React.JSX.Element {
  const { f } = useT();
  const states = snapshot.agentRuntimeStates;
  const voidState = states.find((state) => state.agent_id === DEFAULT_AGENT_ID);
  const activeChildren = snapshot.agents.filter(
    (agent) => agent.kind === "child" && agent.status === "active" && agent.enabled !== 0,
  ).length;
  const busyCount = states.filter((state) =>
    ["queued", "running", "reviewing", "handoff", "tool_calling", "sandbox", "learning"].includes(
      state.status,
    ),
  ).length;
  const failedCount = states.filter((state) => state.status === "failed").length;
  const latestHandoff = snapshot.harnessEvents.find((event) => event.kind === "handoff");
  const latestLearning = snapshot.harnessEvents.find((event) => event.kind === "learning");
  const latestConversationState = snapshot.conversationAgentStates[0];

  return (
    <section className="rounded-md border border-foreground/10 bg-foreground/[0.025] px-4 py-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <BandMetric
          label="Void"
          value={<StatusChip status={voidState?.status ?? "idle"} />}
          detail={
            voidState?.current_run_id
              ? `Run ${voidState.current_run_id.slice(0, 8)}`
              : "Root orchestrator"
          }
        />
        <BandMetric label="Running" value={busyCount} detail="run, review, handoff, sandbox" />
        <BandMetric label="Children" value={activeChildren} detail="active child agents" />
        <BandMetric
          label="Current"
          value={
            latestConversationState ? (
              <StatusChip status={latestConversationState.status} />
            ) : (
              "None"
            )
          }
          detail={latestConversationState?.summary ?? latestHandoff?.title ?? "No agent activity"}
        />
        {!compact ? (
          <BandMetric
            label="Learning"
            value={latestLearning ? f.dateTime(latestLearning.created_at) : "None"}
            detail={
              failedCount
                ? `${failedCount} failed state`
                : (latestLearning?.title ?? "Silent memory queue")
            }
          />
        ) : null}
      </div>
    </section>
  );
}

function BandMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-normal text-foreground/40">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
      <div className="mt-0.5 truncate text-xs text-foreground/45">{detail}</div>
    </div>
  );
}

function AgentDrawer({
  agent,
  form,
  isSaving,
  onChange,
  onSave,
  runs,
  managedModels,
  selectedTab,
  setSelectedTab,
  state,
}: {
  agent: AgentProfile | null;
  form: AgentFormState;
  isSaving: boolean;
  onChange: (next: AgentFormState) => void;
  onSave: () => void;
  runs: WorkspaceSnapshot["agentRuns"];
  managedModels: ManagedModelInfo[];
  selectedTab: string;
  setSelectedTab: (key: string) => void;
  state: ReturnType<typeof useOverlayState>;
}): React.JSX.Element {
  return (
    <Drawer state={state}>
      <Drawer.Backdrop isDismissable={!isSaving}>
        <Drawer.Content placement="right" className="w-full max-w-3xl">
          <Drawer.Dialog>
            <Drawer.Header>
              <div className="min-w-0">
                <Drawer.Heading>{agent ? "Edit child agent" : "New child agent"}</Drawer.Heading>
                <p className="mt-1 text-sm text-foreground/50">
                  Void remains the locked root; children define routing, tools, and handoff
                  behavior.
                </p>
              </div>
              <Drawer.CloseTrigger isDisabled={isSaving} />
            </Drawer.Header>
            <Drawer.Body>
              <Tabs
                selectedKey={selectedTab}
                onSelectionChange={(key) => setSelectedTab(String(key))}
                variant="secondary"
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Agent editor tabs">
                    <Tabs.Tab id="identity">Identity</Tabs.Tab>
                    <Tabs.Tab id="soul">Instructions</Tabs.Tab>
                    <Tabs.Tab id="tools">Model & tools</Tabs.Tab>
                    <Tabs.Tab id="handoff">Handoff</Tabs.Tab>
                    <Tabs.Tab id="runs">Runs</Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>

                <Tabs.Panel id="identity" className="pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextInputField
                      label="Name"
                      value={form.name}
                      onChange={(name) => onChange({ ...form, name })}
                    />
                    <TextInputField
                      label="Avatar"
                      value={form.avatar}
                      onChange={(avatar) => onChange({ ...form, avatar: avatar.slice(0, 2) })}
                    />
                    <TextInputField
                      label="Role"
                      value={form.role}
                      onChange={(role) => onChange({ ...form, role })}
                    />
                    <SelectField
                      label="Lifecycle"
                      value={form.status}
                      onChange={(status) =>
                        onChange({ ...form, status: status as AgentProfile["status"] })
                      }
                      options={[
                        ["active", "Active"],
                        ["draft", "Draft"],
                        ["archived", "Archived"],
                      ]}
                    />
                    <div className="flex items-end">
                      <Switch
                        size="sm"
                        isSelected={form.enabled}
                        onChange={(enabled) => onChange({ ...form, enabled })}
                        aria-label="Agent enabled"
                      >
                        <Switch.Content>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          Enabled for orchestration
                        </Switch.Content>
                      </Switch>
                    </div>
                  </div>
                  <TextAreaField
                    label="Description"
                    rows={3}
                    value={form.description}
                    onChange={(description) => onChange({ ...form, description })}
                  />
                </Tabs.Panel>

                <Tabs.Panel id="soul" className="space-y-3 pt-4">
                  <TextAreaField
                    label="Personality"
                    rows={4}
                    value={form.personality}
                    onChange={(personality) => onChange({ ...form, personality })}
                  />
                  <TextAreaField
                    label="Soul prompt"
                    rows={8}
                    value={form.soul_prompt}
                    onChange={(soul_prompt) => onChange({ ...form, soul_prompt })}
                  />
                </Tabs.Panel>

                <Tabs.Panel id="tools" className="space-y-4 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      label="Model override"
                      value={form.model_ref}
                      onChange={(model_ref) => onChange({ ...form, model_ref })}
                      options={[
                        ["", "Inherit selected chat model"],
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
                      label="Voice"
                      placeholder="optional voice profile"
                      value={form.voice}
                      onChange={(voice) => onChange({ ...form, voice })}
                    />
                    <NumberField
                      label="Max turns"
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
                      label="Temperature"
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
                      label="Top-P"
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
                      label="Max output tokens"
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
                      label="Reasoning"
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
                        ["provider-default", "Provider default"],
                        ["none", "None"],
                        ["minimal", "Minimal"],
                        ["low", "Low"],
                        ["medium", "Medium"],
                        ["high", "High"],
                        ["xhigh", "XHigh"],
                      ]}
                    />
                    <SelectField
                      label="Review policy"
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
                        ["inherit", "Inherit"],
                        ["auto", "Auto allow low risk"],
                        ["review_sensitive", "Review sensitive"],
                        ["review_all", "Review all tools"],
                      ]}
                    />
                    <SelectField
                      label="Sandbox policy"
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
                        ["inherit", "Inherit"],
                        ["disabled", "Disabled"],
                        ["local", "Local restricted"],
                        ["docker", "Docker preferred"],
                      ]}
                    />
                  </div>
                  <ToolPolicyEditor form={form} onChange={onChange} />
                </Tabs.Panel>

                <Tabs.Panel id="handoff" className="space-y-3 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      label="Mode"
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
                        ["handoff", "Handoff"],
                        ["consult", "Consult"],
                        ["both", "Both"],
                      ]}
                    />
                    <SelectField
                      label="Priority"
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
                        ["low", "Low"],
                        ["normal", "Normal"],
                        ["high", "High"],
                      ]}
                    />
                  </div>
                  <TextInputField
                    label="Accepts"
                    placeholder="research, planning, critique"
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
                    label="Expected output"
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

                <Tabs.Panel id="runs" className="pt-4">
                  <AgentRunsList runs={runs} />
                </Tabs.Panel>
              </Tabs>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="tertiary" onPress={() => state.close()} isDisabled={isSaving}>
                Cancel
              </Button>
              <Button variant="primary" onPress={onSave} isPending={isSaving}>
                Save agent
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function ToolPolicyEditor({
  form,
  onChange,
}: {
  form: AgentFormState;
  onChange: (next: AgentFormState) => void;
}): React.JSX.Element {
  const custom = form.toolPolicy.mode === "custom";
  const setPolicy = (toolPolicy: AgentToolPolicy): void => onChange({ ...form, toolPolicy });

  return (
    <div className="rounded-md border border-foreground/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Tool policy</div>
          <div className="text-xs text-foreground/50">
            Approval tools stay explicit even when the child inherits global tools.
          </div>
        </div>
        <SelectField
          label="Mode"
          compact
          value={form.toolPolicy.mode}
          onChange={(mode) =>
            setPolicy({ ...form.toolPolicy, mode: mode as AgentToolPolicy["mode"] })
          }
          options={[
            ["inherit", "Inherit"],
            ["custom", "Custom"],
          ]}
        />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ToolCheckboxGroup
          title="Allowed tools"
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
          title="Requires approval"
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
  selected: readonly ChatToolId[];
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
  const { f } = useT();
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
              <span className="text-xs text-foreground/45">{run.model_ref ?? "model inherit"}</span>
            </div>
            <div className="mt-1 truncate text-xs text-foreground/50">
              {run.output_summary ?? run.input_summary ?? run.error ?? "No summary"}
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
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  tone?: "secondary" | "danger";
}): React.JSX.Element {
  return (
    <Tooltip>
      <Button
        aria-label={label}
        isIconOnly
        size="sm"
        variant={tone === "danger" ? "danger" : "secondary"}
        onPress={onPress}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <Input
        fullWidth
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <TextArea
        fullWidth
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
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
    toolPolicy: copyToolPolicy(
      agent
        ? parseJson(agent.tool_policy_json, DEFAULT_AGENT_TOOL_POLICY)
        : DEFAULT_AGENT_TOOL_POLICY,
    ),
    handoffConfig: copyHandoffConfig(
      agent
        ? parseJson(agent.handoff_config_json, DEFAULT_AGENT_HANDOFF_CONFIG)
        : DEFAULT_AGENT_HANDOFF_CONFIG,
    ),
    runtimeConfig: {
      ...DEFAULT_AGENT_RUNTIME_CONFIG,
      ...(agent ? parseJson(agent.runtime_config_json, DEFAULT_AGENT_RUNTIME_CONFIG) : {}),
    },
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
    tool_policy_json: JSON.stringify(copyToolPolicy(form.toolPolicy)),
    handoff_config_json: JSON.stringify(copyHandoffConfig(form.handoffConfig)),
    runtime_config_json: JSON.stringify({
      ...form.runtimeConfig,
      maxTurns: Math.max(1, Math.min(20, Math.round(form.runtimeConfig.maxTurns || 8))),
    }),
  };
}

function copyToolPolicy(policy: AgentToolPolicy): AgentToolPolicy {
  return {
    mode: policy.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: policy.allowedToolIds.filter(isKnownToolId),
    requireApprovalToolIds: policy.requireApprovalToolIds.filter(isKnownToolId),
  };
}

function copyHandoffConfig(config: AgentHandoffConfig): AgentHandoffConfig {
  const mode = ["handoff", "consult", "both"].includes(config.mode) ? config.mode : "consult";
  const priority = ["low", "normal", "high"].includes(config.priority) ? config.priority : "normal";
  return {
    mode,
    priority,
    accepts: Array.isArray(config.accepts) ? config.accepts.map(String).slice(0, 12) : [],
    expectedOutput: config.expectedOutput || DEFAULT_AGENT_HANDOFF_CONFIG.expectedOutput,
  };
}

function isKnownToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

function splitCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function toggleToolId(list: ChatToolId[], toolId: ChatToolId, selected: boolean): ChatToolId[] {
  const next = selected ? [...list, toolId] : list.filter((item) => item !== toolId);
  return [...new Set(next)].filter(isKnownToolId);
}

function latestRunFor(runs: WorkspaceSnapshot["agentRuns"], agentId: string) {
  return runs.find((run) => run.final_agent_id === agentId || run.root_agent_id === agentId);
}

function runsForAgent(runs: WorkspaceSnapshot["agentRuns"], agentId: string) {
  return runs.filter((run) => run.final_agent_id === agentId || run.root_agent_id === agentId);
}

function formatNullableDate(f: ReturnType<typeof useT>["f"], value: number | null): string {
  return value ? f.dateTime(value) : "Never";
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
  const label = statusKeys[status]
    ? t(statusKeys[status])
    : (runtimeStatusLabels[status as AgentRuntimeStatus] ?? status);
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
