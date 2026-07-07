import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
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
import { api, type ExtensionsSnapshot } from "../lib/api";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import type {
  ExtensionSecretPublic,
  ExtensionSkill,
  ExtensionSkillInput,
  ExtensionSkillStep,
  ExtensionSkillStepType,
  HarnessEvent,
  McpServer,
  McpServerInput,
  McpTool,
  WorkflowRun,
} from "@shared/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconCpu,
  IconDatabase,
  IconEdit,
  IconGlobe,
  IconList,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconTrash,
  IconWrench,
} from "./icons";

type ExtensionTab = "mcp" | "skills";
type StatusFilter = "all" | "enabled" | "disabled" | "error";
type ViewMode = "cards" | "table";
type DetailTarget = { type: "mcp"; id: string } | { type: "skill"; id: string } | null;
type DeleteTarget =
  | { type: "mcp"; item: McpServer }
  | { type: "skill"; item: ExtensionSkill }
  | null;
type EditorState =
  | { type: "mcp"; item?: McpServer }
  | { type: "skill"; item?: ExtensionSkill }
  | null;

interface McpFormState {
  name: string;
  description: string;
  transport: McpServer["transport"];
  enabled: boolean;
  autoUse: boolean;
  requiresApproval: boolean;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
  cwd: string;
}

interface SkillFormState {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  autoUse: boolean;
  requiresApproval: boolean;
  triggerKeywords: string;
  tags: string;
  configSchema: string;
  config: string;
  steps: string;
}

interface SecretFormState {
  key: string;
  label: string;
  value: string;
}

const EMPTY_SECRET_FORM: SecretFormState = { key: "", label: "", value: "" };

const DEFAULT_SKILL_STEPS: ExtensionSkillStep[] = [
  {
    id: "scope",
    type: "prompt",
    title: "Clarify scope",
    detail: "Restate the request, constraints, and expected output.",
  },
  {
    id: "memory",
    type: "memory",
    title: "Check local context",
    detail: "Look for relevant saved memory before producing the result.",
  },
  {
    id: "approval",
    type: "approval",
    title: "Approval checkpoint",
    detail: "Ask before using sensitive tools or external context.",
  },
];

export function ExtensionsPanel(): React.JSX.Element {
  const { t, f, locale } = useT();
  const detailState = useOverlayState();
  const [snapshot, setSnapshot] = useState<ExtensionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ExtensionTab>("mcp");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [query, setQuery] = useState("");
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [mcpForm, setMcpForm] = useState<McpFormState>(() => buildMcpForm());
  const [skillForm, setSkillForm] = useState<SkillFormState>(() => buildSkillForm());
  const [secretForm, setSecretForm] = useState<SecretFormState>(EMPTY_SECRET_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = (): void => {
    setLoading(true);
    void api.extensions
      .snapshot()
      .then(setSnapshot)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const toolsByServer = useMemo(() => groupMcpTools(snapshot?.mcpTools ?? []), [snapshot]);
  const runsByWorkflow = useMemo(() => groupWorkflowRuns(snapshot?.workflowRuns ?? []), [snapshot]);
  const mcpServers = useMemo(
    () => filterMcpServers(snapshot?.mcpServers ?? [], query, statusFilter),
    [query, snapshot, statusFilter],
  );
  const skills = useMemo(
    () => filterSkills(snapshot?.skills ?? [], query, statusFilter),
    [query, snapshot, statusFilter],
  );
  const selectedMcp =
    detailTarget?.type === "mcp"
      ? (snapshot?.mcpServers.find((server) => server.id === detailTarget.id) ?? null)
      : null;
  const selectedSkill =
    detailTarget?.type === "skill"
      ? (snapshot?.skills.find((skill) => skill.id === detailTarget.id) ?? null)
      : null;

  const stats = useMemo(() => {
    const mcp = snapshot?.mcpServers ?? [];
    const skills = snapshot?.skills ?? [];
    const tools = snapshot?.mcpTools ?? [];
    return {
      enabledMcp: mcp.filter((server) => server.enabled !== 0).length,
      mcpTotal: mcp.length,
      enabledSkills: skills.filter((skill) => skill.enabled !== 0).length,
      skillTotal: skills.length,
      enabledTools: tools.filter((tool) => tool.enabled !== 0).length,
      toolTotal: tools.length,
      secrets: snapshot?.secrets.length ?? 0,
    };
  }, [snapshot]);

  const openMcpEditor = (item?: McpServer): void => {
    setEditor({ type: "mcp", item });
    setMcpForm(buildMcpForm(item));
    setFormError(null);
  };

  const openSkillEditor = (item?: ExtensionSkill): void => {
    setEditor({ type: "skill", item });
    setSkillForm(buildSkillForm(item));
    setFormError(null);
  };

  const openDetail = (target: DetailTarget): void => {
    setDetailTarget(target);
    setSecretForm(EMPTY_SECRET_FORM);
    detailState.open();
  };

  const runAction = async (action: () => Promise<unknown>, successKey: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      notify.success(t(successKey));
      refresh();
    } catch (error) {
      notify.error(t("extensions.toast.failed"), error, locale);
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = async (): Promise<void> => {
    if (!editor) return;
    setFormError(null);
    try {
      if (editor.type === "mcp") {
        const input = buildMcpInput(mcpForm);
        await runAction(
          () =>
            editor.item
              ? api.extensions.mcp.update(editor.item.id, input)
              : api.extensions.mcp.create(input),
          "extensions.toast.saved",
        );
      } else {
        const input = buildSkillInput(skillForm);
        await runAction(
          () =>
            editor.item
              ? api.extensions.skills.update(editor.item.id, input)
              : api.extensions.skills.create(input),
          "extensions.toast.saved",
        );
      }
      setEditor(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    void runAction(
      () =>
        target.type === "mcp"
          ? api.extensions.mcp.delete(target.item.id)
          : api.extensions.skills.delete(target.item.id),
      "extensions.toast.deleted",
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconGlobe />}
          label={t("extensions.metric.mcp")}
          value={`${f.number(stats.enabledMcp)} / ${f.number(stats.mcpTotal)}`}
          detail={t("extensions.metric.enabled")}
        />
        <MetricCard
          icon={<IconWrench />}
          label={t("extensions.metric.tools")}
          value={`${f.number(stats.enabledTools)} / ${f.number(stats.toolTotal)}`}
          detail={t("extensions.metric.enabled")}
        />
        <MetricCard
          icon={<IconCpu />}
          label={t("extensions.metric.skills")}
          value={`${f.number(stats.enabledSkills)} / ${f.number(stats.skillTotal)}`}
          detail={t("extensions.metric.enabled")}
        />
        <MetricCard
          icon={<IconDatabase />}
          label={t("extensions.metric.secrets")}
          value={f.number(stats.secrets)}
          detail={t("extensions.metric.redacted")}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key === "skills" ? "skills" : "mcp")}
        >
          <Tabs.List>
            <Tabs.Tab id="mcp">{t("extensions.tab.mcp")}</Tabs.Tab>
            <Tabs.Tab id="skills">{t("extensions.tab.skills")}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <Input
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("extensions.search.placeholder")}
              className="pl-9"
            />
          </div>
          <select
            className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-sm outline-none focus:border-accent"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label={t("extensions.filter.status")}
          >
            <option value="all">{t("extensions.filter.all")}</option>
            <option value="enabled">{t("extensions.filter.enabled")}</option>
            <option value="disabled">{t("extensions.filter.disabled")}</option>
            <option value="error">{t("extensions.filter.error")}</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setViewMode(viewMode === "cards" ? "table" : "cards")}
          >
            <IconList className="size-3.5" />
            {viewMode === "cards" ? t("extensions.view.table") : t("extensions.view.cards")}
          </Button>
          <Button variant="secondary" size="sm" onPress={refresh} isPending={loading}>
            <IconRotateCcw className="size-3.5" />
            {t("workspace.refresh")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPress={() => (tab === "mcp" ? openMcpEditor() : openSkillEditor())}
          >
            <IconPlus className="size-3.5" />
            {tab === "mcp" ? t("extensions.mcp.add") : t("extensions.skill.add")}
          </Button>
        </div>
      </div>

      {loading && !snapshot ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-foreground/45">
          {t("workspace.loading")}
        </div>
      ) : tab === "mcp" ? (
        <McpSection
          servers={mcpServers}
          toolsByServer={toolsByServer}
          secrets={snapshot?.secrets ?? []}
          viewMode={viewMode}
          busy={busy}
          onOpenDetail={(server) => openDetail({ type: "mcp", id: server.id })}
          onEdit={openMcpEditor}
          onDelete={(item) => setDeleteTarget({ type: "mcp", item })}
          onToggle={(server, enabled) =>
            runAction(
              () => api.extensions.mcp.setEnabled(server.id, enabled),
              "extensions.toast.saved",
            )
          }
          onTest={(server) =>
            runAction(() => api.extensions.mcp.test(server.id), "extensions.toast.tested")
          }
          onDiscover={(server) =>
            runAction(() => api.extensions.mcp.discover(server.id), "extensions.toast.discovered")
          }
        />
      ) : (
        <SkillsSection
          skills={skills}
          runsByWorkflow={runsByWorkflow}
          viewMode={viewMode}
          busy={busy}
          onOpenDetail={(skill) => openDetail({ type: "skill", id: skill.id })}
          onEdit={openSkillEditor}
          onDelete={(item) => setDeleteTarget({ type: "skill", item })}
          onToggle={(skill, enabled) =>
            runAction(
              () => api.extensions.skills.setEnabled(skill.id, enabled),
              "extensions.toast.saved",
            )
          }
          onRun={(skill) =>
            runAction(
              () => api.extensions.skills.run(skill.id, { request: "Manual extension run" }),
              "extensions.toast.ran",
            )
          }
        />
      )}

      <ExtensionDetailDrawer
        state={detailState}
        mcp={selectedMcp}
        skill={selectedSkill}
        snapshot={snapshot}
        secretForm={secretForm}
        setSecretForm={setSecretForm}
        busy={busy}
        onClose={() => {
          detailState.close();
          setDetailTarget(null);
        }}
        onUpdateTool={(tool, patch) =>
          runAction(() => api.extensions.mcp.updateTool(tool.id, patch), "extensions.toast.saved")
        }
        onSaveSecret={(ownerType, ownerId) =>
          runAction(
            () =>
              ownerType === "mcp"
                ? api.extensions.mcp.setSecret({ ownerType, ownerId, ...secretForm })
                : api.extensions.skills.setSecret({ ownerType, ownerId, ...secretForm }),
            "extensions.toast.secretSaved",
          ).then(() => setSecretForm(EMPTY_SECRET_FORM))
        }
        onDeleteSecret={(secret) =>
          runAction(
            () =>
              secret.owner_type === "mcp"
                ? api.extensions.mcp.deleteSecret(secret.id)
                : api.extensions.skills.deleteSecret(secret.id),
            "extensions.toast.deleted",
          )
        }
      />

      <ExtensionEditorModal
        editor={editor}
        mcpForm={mcpForm}
        setMcpForm={setMcpForm}
        skillForm={skillForm}
        setSkillForm={setSkillForm}
        formError={formError}
        busy={busy}
        onSave={saveEditor}
        onClose={() => setEditor(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={t("extensions.delete.title")}
        message={t("extensions.delete.message", {
          name: deleteTarget?.item.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function McpSection({
  servers,
  toolsByServer,
  secrets,
  viewMode,
  busy,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onDiscover,
}: {
  servers: McpServer[];
  toolsByServer: Map<string, McpTool[]>;
  secrets: ExtensionSecretPublic[];
  viewMode: ViewMode;
  busy: boolean;
  onOpenDetail: (server: McpServer) => void;
  onEdit: (server: McpServer) => void;
  onDelete: (server: McpServer) => void;
  onToggle: (server: McpServer, enabled: boolean) => void;
  onTest: (server: McpServer) => void;
  onDiscover: (server: McpServer) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  if (servers.length === 0) return <EmptyExtensions message={t("extensions.mcp.empty")} />;
  if (viewMode === "table") {
    return (
      <div className="overflow-hidden rounded-lg border border-foreground/10">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-foreground/[0.035] text-xs text-foreground/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t("extensions.table.name")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.status")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.tools")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.updated")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("extensions.table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <tr key={server.id} className="border-t border-foreground/10">
                <td className="px-4 py-3">
                  <div className="font-medium">{server.name}</div>
                  <div className="text-xs text-foreground/45">{server.transport}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusChip status={server.enabled ? server.status : "disabled"} />
                </td>
                <td className="px-4 py-3 text-foreground/60">
                  {f.number(toolsByServer.get(server.id)?.length ?? 0)}
                </td>
                <td className="px-4 py-3 text-xs text-foreground/45">
                  {f.dateTime(server.updated_at)}
                </td>
                <td className="px-4 py-3">
                  <RowActions
                    busy={busy}
                    enabled={server.enabled !== 0}
                    onToggle={(enabled) => onToggle(server, enabled)}
                    onDetail={() => onOpenDetail(server)}
                    onEdit={() => onEdit(server)}
                    onDelete={() => onDelete(server)}
                    extra={
                      <>
                        <IconButton
                          label={t("extensions.action.test")}
                          onPress={() => onTest(server)}
                        >
                          <IconCheck className="size-4" />
                        </IconButton>
                        <IconButton
                          label={t("extensions.action.discover")}
                          onPress={() => onDiscover(server)}
                        >
                          <IconRotateCcw className="size-4" />
                        </IconButton>
                      </>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {servers.map((server) => (
        <McpCard
          key={server.id}
          server={server}
          tools={toolsByServer.get(server.id) ?? []}
          secretCount={secrets.filter((secret) => secret.owner_id === server.id).length}
          busy={busy}
          onOpenDetail={() => onOpenDetail(server)}
          onEdit={() => onEdit(server)}
          onDelete={() => onDelete(server)}
          onToggle={(enabled) => onToggle(server, enabled)}
          onTest={() => onTest(server)}
          onDiscover={() => onDiscover(server)}
        />
      ))}
    </div>
  );
}

function McpCard({
  server,
  tools,
  secretCount,
  busy,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onDiscover,
}: {
  server: McpServer;
  tools: McpTool[];
  secretCount: number;
  busy: boolean;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onDiscover: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const enabledTools = tools.filter((tool) => tool.enabled !== 0).length;
  return (
    <Card className="min-h-56">
      <Card.Header>
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
            {server.transport === "stdio" ? <IconCpu /> : <IconGlobe />}
          </span>
          <StatusChip status={server.enabled ? server.status : "disabled"} />
        </div>
        <Card.Title>{server.name}</Card.Title>
        <Card.Description>
          {server.description || t("extensions.mcp.noDescription")}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-2 text-xs text-foreground/60">
          <InfoRow label={t("extensions.field.transport")} value={server.transport} />
          <InfoRow
            label={t("extensions.field.tools")}
            value={`${enabledTools} / ${tools.length}`}
          />
          <InfoRow label={t("extensions.field.secrets")} value={f.number(secretCount)} />
          {server.last_error ? (
            <InfoRow label={t("extensions.field.error")} value={server.last_error} />
          ) : null}
        </div>
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={server.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t("extensions.enabled")}
            </Switch.Content>
          </Switch>
          <div className="flex gap-1.5">
            <IconButton label={t("extensions.action.test")} onPress={onTest} isDisabled={busy}>
              <IconCheck className="size-4" />
            </IconButton>
            <IconButton
              label={t("extensions.action.discover")}
              onPress={onDiscover}
              isDisabled={busy}
            >
              <IconRotateCcw className="size-4" />
            </IconButton>
            <IconButton label={t("extensions.action.details")} onPress={onOpenDetail}>
              <IconList className="size-4" />
            </IconButton>
            <IconButton label={t("common.edit")} onPress={onEdit}>
              <IconEdit className="size-4" />
            </IconButton>
            <IconButton label={t("common.delete")} onPress={onDelete} danger>
              <IconTrash className="size-4" />
            </IconButton>
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

function SkillsSection({
  skills,
  runsByWorkflow,
  viewMode,
  busy,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: {
  skills: ExtensionSkill[];
  runsByWorkflow: Map<string, WorkflowRun[]>;
  viewMode: ViewMode;
  busy: boolean;
  onOpenDetail: (skill: ExtensionSkill) => void;
  onEdit: (skill: ExtensionSkill) => void;
  onDelete: (skill: ExtensionSkill) => void;
  onToggle: (skill: ExtensionSkill, enabled: boolean) => void;
  onRun: (skill: ExtensionSkill) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  if (skills.length === 0) return <EmptyExtensions message={t("extensions.skill.empty")} />;
  if (viewMode === "table") {
    return (
      <div className="overflow-hidden rounded-lg border border-foreground/10">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-foreground/[0.035] text-xs text-foreground/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t("extensions.table.name")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.status")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.runs")}</th>
              <th className="px-4 py-3 font-medium">{t("extensions.table.updated")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("extensions.table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id} className="border-t border-foreground/10">
                <td className="px-4 py-3">
                  <div className="font-medium">{skill.name}</div>
                  <div className="text-xs text-foreground/45">{skill.category}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusChip status={skill.enabled ? "ready" : "disabled"} />
                </td>
                <td className="px-4 py-3 text-foreground/60">
                  {f.number(runsByWorkflow.get(skill.workflow_id ?? "")?.length ?? 0)}
                </td>
                <td className="px-4 py-3 text-xs text-foreground/45">
                  {f.dateTime(skill.updated_at)}
                </td>
                <td className="px-4 py-3">
                  <RowActions
                    busy={busy}
                    enabled={skill.enabled !== 0}
                    onToggle={(enabled) => onToggle(skill, enabled)}
                    onDetail={() => onOpenDetail(skill)}
                    onEdit={() => onEdit(skill)}
                    onDelete={() => onDelete(skill)}
                    extra={
                      <IconButton
                        label={t("extensions.action.run")}
                        onPress={() => onRun(skill)}
                        isDisabled={busy || skill.enabled === 0}
                      >
                        <IconCpu className="size-4" />
                      </IconButton>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          runs={runsByWorkflow.get(skill.workflow_id ?? "") ?? []}
          busy={busy}
          onOpenDetail={() => onOpenDetail(skill)}
          onEdit={() => onEdit(skill)}
          onDelete={() => onDelete(skill)}
          onToggle={(enabled) => onToggle(skill, enabled)}
          onRun={() => onRun(skill)}
        />
      ))}
    </div>
  );
}

function SkillCard({
  skill,
  runs,
  busy,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: {
  skill: ExtensionSkill;
  runs: WorkflowRun[];
  busy: boolean;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const steps = readSkillSteps(skill);
  return (
    <Card className="min-h-56">
      <Card.Header>
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-success/12 text-success">
            <IconWrench />
          </span>
          <StatusChip status={skill.enabled ? "ready" : "disabled"} />
        </div>
        <Card.Title>{skill.name}</Card.Title>
        <Card.Description>
          {skill.description || t("extensions.skill.noDescription")}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-2 text-xs text-foreground/60">
          <InfoRow label={t("extensions.field.category")} value={skill.category} />
          <InfoRow label={t("extensions.field.steps")} value={f.number(steps.length)} />
          <InfoRow label={t("extensions.field.runs")} value={f.number(runs.length)} />
          <InfoRow
            label={t("extensions.field.lastRun")}
            value={skill.last_run_at ? f.dateTime(skill.last_run_at) : t("extensions.never")}
          />
        </div>
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={skill.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t("extensions.enabled")}
            </Switch.Content>
          </Switch>
          <div className="flex gap-1.5">
            <IconButton
              label={t("extensions.action.run")}
              onPress={onRun}
              isDisabled={busy || skill.enabled === 0}
            >
              <IconCpu className="size-4" />
            </IconButton>
            <IconButton label={t("extensions.action.details")} onPress={onOpenDetail}>
              <IconList className="size-4" />
            </IconButton>
            <IconButton label={t("common.edit")} onPress={onEdit}>
              <IconEdit className="size-4" />
            </IconButton>
            <IconButton label={t("common.delete")} onPress={onDelete} danger>
              <IconTrash className="size-4" />
            </IconButton>
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

function ExtensionDetailDrawer({
  state,
  mcp,
  skill,
  snapshot,
  secretForm,
  setSecretForm,
  busy,
  onClose,
  onUpdateTool,
  onSaveSecret,
  onDeleteSecret,
}: {
  state: ReturnType<typeof useOverlayState>;
  mcp: McpServer | null;
  skill: ExtensionSkill | null;
  snapshot: ExtensionsSnapshot | null;
  secretForm: SecretFormState;
  setSecretForm: (form: SecretFormState) => void;
  busy: boolean;
  onClose: () => void;
  onUpdateTool: (
    tool: McpTool,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
  onSaveSecret: (ownerType: "mcp" | "skill", ownerId: string) => Promise<void>;
  onDeleteSecret: (secret: ExtensionSecretPublic) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const ownerType = mcp ? "mcp" : skill ? "skill" : null;
  const ownerId = mcp?.id ?? skill?.id ?? "";
  const secrets = (snapshot?.secrets ?? []).filter(
    (secret) => secret.owner_type === ownerType && secret.owner_id === ownerId,
  );
  const tools = mcp ? (snapshot?.mcpTools ?? []).filter((tool) => tool.server_id === mcp.id) : [];
  const runs = skill
    ? (snapshot?.workflowRuns ?? [])
        .filter((run) => run.workflow_id === skill.workflow_id)
        .slice(0, 8)
    : [];
  const audits = filterExtensionEvents(snapshot?.harnessEvents ?? [], ownerId).slice(0, 8);

  return (
    <Drawer state={state}>
      <Drawer.Backdrop isDismissable={!busy}>
        <Drawer.Content placement="right" className="w-full max-w-3xl">
          <Drawer.Dialog>
            <Drawer.Header>
              <div className="min-w-0">
                <Drawer.Heading>
                  {mcp?.name ?? skill?.name ?? t("extensions.details")}
                </Drawer.Heading>
                <p className="mt-1 text-sm text-foreground/50">
                  {mcp ? t("extensions.details.mcp") : t("extensions.details.skill")}
                </p>
              </div>
              <Drawer.CloseTrigger isDisabled={busy} />
            </Drawer.Header>
            <Drawer.Body>
              {mcp ? (
                <div className="space-y-5">
                  <DetailGrid
                    rows={[
                      [t("extensions.field.transport"), mcp.transport],
                      [
                        t("extensions.field.endpoint"),
                        mcp.transport === "stdio" ? (mcp.command ?? "") : (mcp.url ?? ""),
                      ],
                      [
                        t("extensions.field.connected"),
                        mcp.last_connected_at
                          ? f.dateTime(mcp.last_connected_at)
                          : t("extensions.never"),
                      ],
                      [t("extensions.field.error"), mcp.last_error ?? t("extensions.none")],
                    ]}
                  />
                  <section className="space-y-2">
                    <SectionHeading title={t("extensions.mcp.tools")} />
                    {tools.length === 0 ? (
                      <p className="rounded-md border border-foreground/10 px-3 py-3 text-sm text-foreground/45">
                        {t("extensions.mcp.noTools")}
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-foreground/10">
                        {tools.map((tool) => (
                          <div
                            key={tool.id}
                            className="grid gap-3 border-b border-foreground/10 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{tool.title ?? tool.name}</span>
                                <Chip size="sm" variant="secondary">
                                  <Chip.Label>{tool.name}</Chip.Label>
                                </Chip>
                              </div>
                              <p className="mt-1 text-xs text-foreground/50">{tool.description}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 md:justify-end">
                              <SmallSwitch
                                label={t("extensions.enabled")}
                                selected={tool.enabled !== 0}
                                disabled={busy}
                                onChange={(enabled) => onUpdateTool(tool, { enabled })}
                              />
                              <SmallSwitch
                                label={t("extensions.autoUse")}
                                selected={tool.auto_use !== 0}
                                disabled={busy}
                                onChange={(enabled) => onUpdateTool(tool, { auto_use: enabled })}
                              />
                              <SmallSwitch
                                label={t("extensions.approval")}
                                selected={tool.requires_approval !== 0}
                                disabled={busy}
                                onChange={(enabled) =>
                                  onUpdateTool(tool, { requires_approval: enabled })
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <SecretSection
                    ownerType="mcp"
                    ownerId={mcp.id}
                    secrets={secrets}
                    form={secretForm}
                    setForm={setSecretForm}
                    busy={busy}
                    onSave={onSaveSecret}
                    onDelete={onDeleteSecret}
                  />
                </div>
              ) : skill ? (
                <div className="space-y-5">
                  <DetailGrid
                    rows={[
                      [t("extensions.field.category"), skill.category],
                      [t("extensions.field.workflow"), skill.workflow_id ?? t("extensions.none")],
                      [
                        t("extensions.field.lastRun"),
                        skill.last_run_at ? f.dateTime(skill.last_run_at) : t("extensions.never"),
                      ],
                      [
                        t("extensions.field.triggers"),
                        readJsonArray(skill.trigger_keywords_json).join(", ") ||
                          t("extensions.none"),
                      ],
                    ]}
                  />
                  <section className="space-y-2">
                    <SectionHeading title={t("extensions.skill.steps")} />
                    <div className="space-y-2">
                      {readSkillSteps(skill).map((step) => (
                        <div
                          key={step.id}
                          className="rounded-lg border border-foreground/10 px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip size="sm" variant="secondary">
                              <Chip.Label>{step.type}</Chip.Label>
                            </Chip>
                            <span className="font-medium">{step.title}</span>
                          </div>
                          <p className="mt-1 text-sm text-foreground/60">{step.detail}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="space-y-2">
                    <SectionHeading title={t("extensions.skill.runs")} />
                    <RunList runs={runs} />
                  </section>
                  <section className="space-y-2">
                    <SectionHeading title={t("extensions.audit.recent")} />
                    <AuditList events={audits} />
                  </section>
                  <SecretSection
                    ownerType="skill"
                    ownerId={skill.id}
                    secrets={secrets}
                    form={secretForm}
                    setForm={setSecretForm}
                    busy={busy}
                    onSave={onSaveSecret}
                    onDelete={onDeleteSecret}
                  />
                </div>
              ) : null}
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t("common.close")}
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function ExtensionEditorModal({
  editor,
  mcpForm,
  setMcpForm,
  skillForm,
  setSkillForm,
  formError,
  busy,
  onSave,
  onClose,
}: {
  editor: EditorState;
  mcpForm: McpFormState;
  setMcpForm: (form: McpFormState) => void;
  skillForm: SkillFormState;
  setSkillForm: (form: SkillFormState) => void;
  formError: string | null;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useT();
  if (!editor) return null;
  const title =
    editor.type === "mcp"
      ? editor.item
        ? t("extensions.mcp.edit")
        : t("extensions.mcp.add")
      : editor.item
        ? t("extensions.skill.edit")
        : t("extensions.skill.add");
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop isDismissable={!busy}>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
              <Button type="button" isIconOnly variant="tertiary" size="sm" onPress={onClose}>
                <IconClose className="size-4" />
              </Button>
            </Modal.Header>
            <Modal.Body>
              {editor.type === "mcp" ? (
                <McpForm form={mcpForm} setForm={setMcpForm} />
              ) : (
                <SkillForm form={skillForm} setForm={setSkillForm} />
              )}
              {formError ? (
                <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {formError}
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose} isDisabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onPress={onSave} isPending={busy}>
                {t("common.save")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function McpForm({
  form,
  setForm,
}: {
  form: McpFormState;
  setForm: (form: McpFormState) => void;
}): React.JSX.Element {
  const { t } = useT();
  const patch = (value: Partial<McpFormState>): void => setForm({ ...form, ...value });
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput
          label={t("extensions.field.name")}
          value={form.name}
          onChange={(name) => patch({ name })}
        />
        <SelectInput
          label={t("extensions.field.transport")}
          value={form.transport}
          options={[
            ["stdio", "stdio"],
            ["http", "http"],
            ["sse", "sse"],
          ]}
          onChange={(transport) => patch({ transport: transport as McpServer["transport"] })}
        />
      </div>
      <TextAreaInput
        label={t("extensions.field.description")}
        value={form.description}
        rows={3}
        onChange={(description) => patch({ description })}
      />
      {form.transport === "stdio" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label={t("extensions.field.command")}
            value={form.command}
            onChange={(command) => patch({ command })}
          />
          <TextInput
            label={t("extensions.field.cwd")}
            value={form.cwd}
            onChange={(cwd) => patch({ cwd })}
          />
          <TextAreaInput
            label={t("extensions.field.args")}
            value={form.args}
            rows={3}
            onChange={(args) => patch({ args })}
          />
          <TextAreaInput
            label={t("extensions.field.env")}
            value={form.env}
            rows={3}
            onChange={(env) => patch({ env })}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          <TextInput
            label={t("extensions.field.url")}
            value={form.url}
            onChange={(url) => patch({ url })}
          />
          <TextAreaInput
            label={t("extensions.field.headers")}
            value={form.headers}
            rows={4}
            onChange={(headers) => patch({ headers })}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <SmallSwitch
          label={t("extensions.enabled")}
          selected={form.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
        <SmallSwitch
          label={t("extensions.autoUse")}
          selected={form.autoUse}
          onChange={(autoUse) => patch({ autoUse })}
        />
        <SmallSwitch
          label={t("extensions.approval")}
          selected={form.requiresApproval}
          onChange={(requiresApproval) => patch({ requiresApproval })}
        />
      </div>
    </div>
  );
}

function SkillForm({
  form,
  setForm,
}: {
  form: SkillFormState;
  setForm: (form: SkillFormState) => void;
}): React.JSX.Element {
  const { t } = useT();
  const patch = (value: Partial<SkillFormState>): void => setForm({ ...form, ...value });
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput
          label={t("extensions.field.name")}
          value={form.name}
          onChange={(name) => patch({ name })}
        />
        <TextInput
          label={t("extensions.field.category")}
          value={form.category}
          onChange={(category) => patch({ category })}
        />
      </div>
      <TextAreaInput
        label={t("extensions.field.description")}
        value={form.description}
        rows={3}
        onChange={(description) => patch({ description })}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <TextAreaInput
          label={t("extensions.field.triggers")}
          value={form.triggerKeywords}
          rows={3}
          onChange={(triggerKeywords) => patch({ triggerKeywords })}
        />
        <TextAreaInput
          label={t("extensions.field.tags")}
          value={form.tags}
          rows={3}
          onChange={(tags) => patch({ tags })}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextAreaInput
          label={t("extensions.field.configSchema")}
          value={form.configSchema}
          rows={6}
          onChange={(configSchema) => patch({ configSchema })}
        />
        <TextAreaInput
          label={t("extensions.field.config")}
          value={form.config}
          rows={6}
          onChange={(config) => patch({ config })}
        />
      </div>
      <TextAreaInput
        label={t("extensions.field.steps")}
        value={form.steps}
        rows={10}
        onChange={(steps) => patch({ steps })}
      />
      <div className="flex flex-wrap gap-4">
        <SmallSwitch
          label={t("extensions.enabled")}
          selected={form.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
        <SmallSwitch
          label={t("extensions.autoUse")}
          selected={form.autoUse}
          onChange={(autoUse) => patch({ autoUse })}
        />
        <SmallSwitch
          label={t("extensions.approval")}
          selected={form.requiresApproval}
          onChange={(requiresApproval) => patch({ requiresApproval })}
        />
      </div>
    </div>
  );
}

function SecretSection({
  ownerType,
  ownerId,
  secrets,
  form,
  setForm,
  busy,
  onSave,
  onDelete,
}: {
  ownerType: "mcp" | "skill";
  ownerId: string;
  secrets: ExtensionSecretPublic[];
  form: SecretFormState;
  setForm: (form: SecretFormState) => void;
  busy: boolean;
  onSave: (ownerType: "mcp" | "skill", ownerId: string) => Promise<void>;
  onDelete: (secret: ExtensionSecretPublic) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <section className="space-y-3">
      <SectionHeading title={t("extensions.secrets.title")} />
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
        <TextInput
          label={t("extensions.field.secretKey")}
          value={form.key}
          onChange={(key) => setForm({ ...form, key })}
        />
        <TextInput
          label={t("extensions.field.secretLabel")}
          value={form.label}
          onChange={(label) => setForm({ ...form, label })}
        />
        <TextInput
          label={t("extensions.field.secretValue")}
          value={form.value}
          onChange={(value) => setForm({ ...form, value })}
        />
        <div className="flex items-end">
          <Button
            variant="primary"
            size="sm"
            isDisabled={!form.key.trim() || !form.value.trim() || busy}
            onPress={() => void onSave(ownerType, ownerId)}
          >
            {t("extensions.secrets.save")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {secrets.length === 0 ? (
          <p className="text-sm text-foreground/45">{t("extensions.secrets.empty")}</p>
        ) : (
          secrets.map((secret) => (
            <div
              key={secret.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium">{secret.label}</div>
                <div className="text-xs text-foreground/45">$secret:{secret.key}</div>
              </div>
              <IconButton
                label={t("common.delete")}
                onPress={() => onDelete(secret)}
                isDisabled={busy}
                danger
              >
                <IconTrash className="size-4" />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RowActions({
  busy,
  enabled,
  onToggle,
  onDetail,
  onEdit,
  onDelete,
  extra,
}: {
  busy: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex items-center justify-end gap-1.5">
      <SmallSwitch label="" selected={enabled} disabled={busy} onChange={onToggle} />
      {extra}
      <IconButton label={t("extensions.action.details")} onPress={onDetail}>
        <IconList className="size-4" />
      </IconButton>
      <IconButton label={t("common.edit")} onPress={onEdit}>
        <IconEdit className="size-4" />
      </IconButton>
      <IconButton label={t("common.delete")} onPress={onDelete} danger>
        <IconTrash className="size-4" />
      </IconButton>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}): React.JSX.Element {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-foreground/50">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
            <div className="mt-1 text-xs text-foreground/45">{detail}</div>
          </div>
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            {icon}
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}

function StatusChip({ status }: { status: string }): React.JSX.Element {
  const { t } = useT();
  const tone =
    status === "ready"
      ? "bg-success/12 text-success"
      : status === "error"
        ? "bg-danger/12 text-danger"
        : status === "disabled"
          ? "bg-foreground/10 text-foreground/50"
          : "bg-warning/12 text-warning";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      {t(`extensions.status.${status}`)}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
      <span className="text-foreground/40">{label}</span>
      <span className="min-w-0 break-words text-foreground/70">{value}</span>
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }): React.JSX.Element {
  return (
    <div className="grid gap-2 rounded-lg border border-foreground/10 px-3 py-3 text-sm">
      {rows.map(([label, value]) => (
        <InfoRow key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function SectionHeading({ title }: { title: string }): React.JSX.Element {
  return <h3 className="text-sm font-semibold text-foreground">{title}</h3>;
}

function RunList({ runs }: { runs: WorkflowRun[] }): React.JSX.Element {
  const { t, f } = useT();
  if (runs.length === 0)
    return <p className="text-sm text-foreground/45">{t("extensions.skill.noRuns")}</p>;
  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div key={run.id} className="rounded-lg border border-foreground/10 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusChip status={run.status} />
            <span className="text-xs text-foreground/45">{f.dateTime(run.started_at)}</span>
          </div>
          <p className="mt-1 break-all text-xs text-foreground/45">{run.id}</p>
        </div>
      ))}
    </div>
  );
}

function AuditList({ events }: { events: HarnessEvent[] }): React.JSX.Element {
  const { t, f } = useT();
  if (events.length === 0)
    return <p className="text-sm text-foreground/45">{t("extensions.audit.empty")}</p>;
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-lg border border-foreground/10 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{event.title}</span>
            <span className="text-xs text-foreground/45">{f.dateTime(event.created_at)}</span>
          </div>
          <p className="mt-1 text-xs text-foreground/45">{event.kind}</p>
        </div>
      ))}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <Input fullWidth value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TextAreaInput({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
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

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      <select
        className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-sm outline-none focus:border-accent"
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

function SmallSwitch({
  label,
  selected,
  disabled,
  onChange,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onChange: (selected: boolean) => void;
}): React.JSX.Element {
  return (
    <Switch size="sm" isSelected={selected} isDisabled={disabled} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}

function IconButton({
  label,
  children,
  onPress,
  isDisabled,
  danger,
}: {
  label: string;
  children: React.ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <Button
          type="button"
          isIconOnly
          size="sm"
          variant={danger ? "danger" : "secondary"}
          isDisabled={isDisabled}
          onPress={onPress}
          aria-label={label}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

function EmptyExtensions({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-foreground/15 px-6 text-center text-sm text-foreground/45">
      <IconWrench className="mb-3 size-8" />
      {message}
    </div>
  );
}

function groupMcpTools(tools: McpTool[]): Map<string, McpTool[]> {
  const grouped = new Map<string, McpTool[]>();
  for (const tool of tools)
    grouped.set(tool.server_id, [...(grouped.get(tool.server_id) ?? []), tool]);
  return grouped;
}

function groupWorkflowRuns(runs: WorkflowRun[]): Map<string, WorkflowRun[]> {
  const grouped = new Map<string, WorkflowRun[]>();
  for (const run of runs)
    grouped.set(run.workflow_id, [...(grouped.get(run.workflow_id) ?? []), run]);
  return grouped;
}

function filterMcpServers(servers: McpServer[], query: string, status: StatusFilter): McpServer[] {
  const q = query.trim().toLowerCase();
  return servers.filter((server) => {
    if (status === "enabled" && server.enabled === 0) return false;
    if (status === "disabled" && server.enabled !== 0) return false;
    if (status === "error" && server.status !== "error") return false;
    if (!q) return true;
    return [
      server.name,
      server.description,
      server.transport,
      server.command ?? "",
      server.url ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function filterSkills(
  skills: ExtensionSkill[],
  query: string,
  status: StatusFilter,
): ExtensionSkill[] {
  const q = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (status === "enabled" && skill.enabled === 0) return false;
    if (status === "disabled" && skill.enabled !== 0) return false;
    if (status === "error") return false;
    if (!q) return true;
    return [skill.name, skill.description, skill.category, skill.trigger_keywords_json]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function buildMcpForm(server?: McpServer): McpFormState {
  return {
    name: server?.name ?? "",
    description: server?.description ?? "",
    transport: server?.transport ?? "stdio",
    enabled: server?.enabled !== 0,
    autoUse: server?.auto_use !== 0,
    requiresApproval: server?.requires_approval !== 0,
    command: server?.command ?? "",
    args: prettyJson(readJsonArray(server?.args_json ?? "[]")),
    url: server?.url ?? "",
    headers: prettyJson(readJsonObject(server?.headers_json ?? "{}")),
    env: prettyJson(readJsonObject(server?.env_json ?? "{}")),
    cwd: server?.cwd ?? "",
  };
}

function buildSkillForm(skill?: ExtensionSkill): SkillFormState {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    category: skill?.category ?? "productivity",
    enabled: skill?.enabled !== 0,
    autoUse: skill?.auto_use !== 0,
    requiresApproval: skill?.requires_approval !== 0,
    triggerKeywords: prettyJson(readJsonArray(skill?.trigger_keywords_json ?? "[]")),
    tags: prettyJson(readJsonArray(skill?.tags_json ?? "[]")),
    configSchema: prettyJson(readJsonObject(skill?.config_schema_json ?? "{}")),
    config: prettyJson(readJsonObject(skill?.config_json ?? "{}")),
    steps: prettyJson(skill ? readSkillSteps(skill) : DEFAULT_SKILL_STEPS),
  };
}

function buildMcpInput(form: McpFormState): McpServerInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  if (form.transport === "stdio" && !form.command.trim()) throw new Error("Command is required.");
  if (form.transport !== "stdio" && !form.url.trim()) throw new Error("URL is required.");
  parseArray(form.args, "args");
  parseObject(form.headers, "headers");
  parseObject(form.env, "env");
  return {
    name,
    description: form.description.trim(),
    transport: form.transport,
    enabled: form.enabled,
    auto_use: form.autoUse,
    requires_approval: form.requiresApproval,
    command: form.command.trim() || null,
    args: form.args,
    url: form.url.trim() || null,
    headers: form.headers,
    env: form.env,
    cwd: form.cwd.trim() || null,
  };
}

function buildSkillInput(form: SkillFormState): ExtensionSkillInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  parseArray(form.triggerKeywords, "trigger keywords");
  parseArray(form.tags, "tags");
  parseObject(form.configSchema, "config schema");
  parseObject(form.config, "config");
  const steps = parseArray(form.steps, "steps").map(normalizeStepInput);
  return {
    name,
    description: form.description.trim(),
    category: form.category.trim() || "general",
    enabled: form.enabled,
    auto_use: form.autoUse,
    requires_approval: form.requiresApproval,
    triggerKeywords: form.triggerKeywords,
    tags: form.tags,
    configSchema: form.configSchema,
    config: form.config,
    steps,
  };
}

function normalizeStepInput(item: unknown, index: number): ExtensionSkillStep {
  const record =
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {};
  const type = normalizeStepType(record.type);
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step-${index + 1}`,
    type,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : type,
    detail: typeof record.detail === "string" ? record.detail : "",
  };
}

function normalizeStepType(value: unknown): ExtensionSkillStepType {
  return value === "tool" || value === "approval" || value === "memory" || value === "handoff"
    ? value
    : "prompt";
}

function readSkillSteps(skill: ExtensionSkill): ExtensionSkillStep[] {
  return readJsonArray(skill.steps_json).map(normalizeStepInput);
}

function filterExtensionEvents(events: HarnessEvent[], ownerId: string): HarnessEvent[] {
  return events.filter(
    (event) => event.detail_json.includes(ownerId) || event.title.includes(ownerId),
  );
}

function readJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray(raw: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON array.");
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON object.");
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
