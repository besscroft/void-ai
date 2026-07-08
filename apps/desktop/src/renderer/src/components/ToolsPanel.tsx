import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Card, Chip, Input, Label, Switch, Tabs, TextArea } from "@heroui/react";
import { api, type ToolDiscoveryResult, type ToolsSnapshot, type WorkflowRun } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import {
  buildMcpInput,
  buildSkillInput,
  normalizeToolSkillSteps,
  type McpFormState,
  type SkillFormState,
} from "../lib/tools-form";
import { filterToolRecords, type ToolKindFilter, type ToolStatusFilter } from "../lib/tools-filter";
import type {
  McpTransportKind,
  RuntimeEvent,
  ToolRecord,
  ToolSecretPublic,
  ToolServer,
  ToolSkill,
  ToolSkillStep,
} from "@shared/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconGlobe,
  IconKey,
  IconList,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconTrash,
  IconWrench,
} from "./icons";

type ToolsTab = "registry" | "mcp" | "skills" | "secrets";
type ViewMode = "cards" | "table";
type DeleteTarget = { type: "mcp"; item: ToolServer } | { type: "skill"; item: ToolSkill } | null;
type EditorState = { type: "mcp"; item?: ToolServer } | { type: "skill"; item?: ToolSkill } | null;

interface SecretFormState {
  ownerId: string;
  key: string;
  label: string;
  value: string;
}

const EMPTY_SECRET_FORM: SecretFormState = { ownerId: "", key: "", label: "", value: "" };
const DEFAULT_SKILL_STEPS: ToolSkillStep[] = [
  {
    id: "scope",
    type: "prompt",
    title: "Clarify scope",
    detail: "Restate the request, constraints, and expected output.",
  },
  {
    id: "work",
    type: "tool",
    title: "Execute work",
    detail: "Use the allowed tool or workflow step.",
  },
  {
    id: "review",
    type: "approval",
    title: "Review checkpoint",
    detail: "Ask for approval before sensitive changes.",
  },
];

export function ToolsPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ToolsTab>("registry");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ToolKindFilter>("all");
  const [status, setStatus] = useState<ToolStatusFilter>("all");
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [mcpForm, setMcpForm] = useState<McpFormState>(() => buildMcpForm());
  const [skillForm, setSkillForm] = useState<SkillFormState>(() => buildSkillForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [secretForm, setSecretForm] = useState<SecretFormState>(EMPTY_SECRET_FORM);

  const refresh = (): void => {
    setLoading(true);
    void api.tools
      .snapshot()
      .then((next) => {
        setSnapshot(next);
        if (!selectedServerId) {
          setSelectedServerId(next.toolServers.find((server) => server.kind === "mcp")?.id ?? null);
        }
        if (!selectedSkillId) setSelectedSkillId(next.skills[0]?.id ?? null);
      })
      .catch((error) => notify.error(t("tools.toast.failed"), error, locale))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const rows = useMemo(
    () => filterToolRecords(snapshot?.toolRecords ?? [], { query, kind, status }),
    [kind, query, snapshot, status],
  );
  const mcpServers = useMemo(
    () => (snapshot?.toolServers ?? []).filter((server) => server.kind === "mcp"),
    [snapshot],
  );
  const mcpToolsByServer = useMemo(
    () => groupByServer((snapshot?.toolRecords ?? []).filter((tool) => tool.kind === "mcp")),
    [snapshot],
  );
  const workflowRunsByWorkflow = useMemo(() => groupRuns(snapshot?.workflowRuns ?? []), [snapshot]);
  const selectedServer = selectedServerId
    ? (mcpServers.find((server) => server.id === selectedServerId) ?? null)
    : null;
  const selectedSkill = selectedSkillId
    ? (snapshot?.skills.find((skill) => skill.id === selectedSkillId) ?? null)
    : null;
  const recentEvents = snapshot?.runtimeEvents.slice(0, 8) ?? [];

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      const result = await action();
      if (isDiscoveryResult(result)) notify.success(result.message || success);
      else notify.success(success);
      refresh();
    } catch (error) {
      notify.error(t("tools.toast.failed"), error, locale);
    } finally {
      setBusy(false);
    }
  };

  const openMcpEditor = (server?: ToolServer): void => {
    setEditor({ type: "mcp", item: server });
    setMcpForm(buildMcpForm(server));
    setFormError(null);
  };

  const openSkillEditor = (skill?: ToolSkill): void => {
    setEditor({ type: "skill", item: skill });
    setSkillForm(buildSkillForm(skill));
    setFormError(null);
  };

  const saveEditor = async (): Promise<void> => {
    if (!editor) return;
    setFormError(null);
    try {
      if (editor.type === "mcp") {
        const input = buildMcpInput(mcpForm);
        await runAction(
          () =>
            editor.item ? api.tools.mcp.update(editor.item.id, input) : api.tools.mcp.create(input),
          t("tools.toast.saved"),
        );
      } else {
        const input = buildSkillInput(skillForm);
        await runAction(
          () =>
            editor.item
              ? api.tools.skills.update(editor.item.id, input)
              : api.tools.skills.create(input),
          t("tools.toast.saved"),
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
          ? api.tools.mcp.delete(target.item.id)
          : api.tools.skills.delete(target.item.id),
      t("tools.toast.deleted"),
    );
  };

  const updateTool = (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ): void => {
    void runAction(() => api.tools.updateTool(tool.id, patch), t("tools.toast.saved"));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("main.title.tools")}</h2>
          <p className="mt-1 text-sm text-foreground/50">{t("main.subtitle.tools")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onPress={refresh} isPending={loading}>
            <IconRotateCcw className="size-4" />
            {t("main.refresh")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPress={() => (tab === "skills" ? openSkillEditor() : openMcpEditor())}
            isDisabled={tab === "registry" || tab === "secrets"}
          >
            <IconPlus className="size-4" />
            {tab === "skills" ? t("tools.skill.add") : t("tools.mcp.add")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label={t("tools.metric.tools")} value={snapshot?.toolRecords.length ?? 0} />
        <MetricCard label={t("tools.metric.mcp")} value={mcpServers.length} />
        <MetricCard label={t("tools.metric.skills")} value={snapshot?.skills.length ?? 0} />
        <MetricCard label={t("tools.metric.secrets")} value={snapshot?.secrets.length ?? 0} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(toToolsTab(key))}>
          <Tabs.List aria-label={t("tools.tabs.label")}>
            <Tabs.Tab id="registry">{t("tools.tab.registry")}</Tabs.Tab>
            <Tabs.Tab id="mcp">{t("tools.tab.mcp")}</Tabs.Tab>
            <Tabs.Tab id="skills">{t("tools.tab.skills")}</Tabs.Tab>
            <Tabs.Tab id="secrets">{t("tools.tab.secrets")}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setViewMode(viewMode === "cards" ? "table" : "cards")}
        >
          <IconList className="size-4" />
          {viewMode === "cards" ? t("tools.view.table") : t("tools.view.cards")}
        </Button>
      </div>

      {loading && !snapshot ? (
        <div className="rounded-md border border-dashed border-foreground/15 px-4 py-16 text-center text-sm text-foreground/45">
          {t("main.loading")}
        </div>
      ) : null}

      {tab === "registry" && snapshot ? (
        <RegistrySection
          rows={rows}
          servers={snapshot.toolServers}
          query={query}
          setQuery={setQuery}
          kind={kind}
          setKind={setKind}
          status={status}
          setStatus={setStatus}
          onUpdateTool={updateTool}
        />
      ) : null}

      {tab === "mcp" && snapshot ? (
        <McpSection
          servers={mcpServers}
          toolsByServer={mcpToolsByServer}
          secrets={snapshot.secrets}
          selected={selectedServer}
          setSelectedId={setSelectedServerId}
          viewMode={viewMode}
          busy={busy}
          onAdd={() => openMcpEditor()}
          onEdit={openMcpEditor}
          onDelete={(server) => setDeleteTarget({ type: "mcp", item: server })}
          onToggle={(server, enabled) =>
            runAction(() => api.tools.mcp.setEnabled(server.id, enabled), t("tools.toast.saved"))
          }
          onTest={(server) =>
            runAction(() => api.tools.mcp.test(server.id), t("tools.toast.tested"))
          }
          onDiscover={(server) =>
            runAction(() => api.tools.mcp.discover(server.id), t("tools.toast.discovered"))
          }
          onUpdateTool={updateTool}
        />
      ) : null}

      {tab === "skills" && snapshot ? (
        <SkillsSection
          skills={snapshot.skills}
          selected={selectedSkill}
          setSelectedId={setSelectedSkillId}
          runsByWorkflow={workflowRunsByWorkflow}
          viewMode={viewMode}
          busy={busy}
          onAdd={() => openSkillEditor()}
          onEdit={openSkillEditor}
          onDelete={(skill) => setDeleteTarget({ type: "skill", item: skill })}
          onToggle={(skill, enabled) =>
            runAction(() => api.tools.skills.setEnabled(skill.id, enabled), t("tools.toast.saved"))
          }
          onRun={(skill) =>
            runAction(
              () => api.tools.skills.run(skill.id, { request: "Manual skill run" }),
              t("tools.toast.ran"),
            )
          }
        />
      ) : null}

      {tab === "secrets" && snapshot ? (
        <SecretsSection
          snapshot={snapshot}
          form={secretForm}
          setForm={setSecretForm}
          busy={busy}
          onSave={(ownerType, ownerId) =>
            runAction(
              () =>
                ownerType === "server"
                  ? api.tools.mcp.setSecret({ ...secretForm, ownerType, ownerId })
                  : api.tools.skills.setSecret({ ...secretForm, ownerType, ownerId }),
              t("tools.toast.secretSaved"),
            ).then(() => setSecretForm(EMPTY_SECRET_FORM))
          }
          onDelete={(secret) =>
            runAction(
              () =>
                secret.owner_type === "server"
                  ? api.tools.mcp.deleteSecret(secret.id)
                  : api.tools.skills.deleteSecret(secret.id),
              t("tools.toast.deleted"),
            )
          }
        />
      ) : null}

      <DiagnosticsStrip events={recentEvents} />

      <ToolEditorModal
        editor={editor}
        mcpForm={mcpForm}
        setMcpForm={setMcpForm}
        skillForm={skillForm}
        setSkillForm={setSkillForm}
        formError={formError}
        busy={busy}
        onSave={() => void saveEditor()}
        onClose={() => setEditor(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={t("tools.delete.title")}
        message={t("tools.delete.message", { name: deleteTarget?.item.name ?? "" })}
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function RegistrySection({
  rows,
  servers,
  query,
  setQuery,
  kind,
  setKind,
  status,
  setStatus,
  onUpdateTool,
}: {
  rows: ToolRecord[];
  servers: ToolServer[];
  query: string;
  setQuery: (query: string) => void;
  kind: ToolKindFilter;
  setKind: (kind: ToolKindFilter) => void;
  status: ToolStatusFilter;
  setStatus: (status: ToolStatusFilter) => void;
  onUpdateTool: (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <Card>
      <Card.Content className="space-y-4 p-4">
        <ToolFilters
          query={query}
          setQuery={setQuery}
          kind={kind}
          setKind={setKind}
          status={status}
          setStatus={setStatus}
        />
        {rows.length === 0 ? (
          <EmptyTools message={t("tools.empty")} />
        ) : (
          <div className="overflow-hidden rounded-md border border-foreground/10">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-foreground/[0.03] text-xs text-foreground/50">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("tools.table.name")}</th>
                  <th className="px-4 py-3 font-medium">{t("tools.table.kind")}</th>
                  <th className="px-4 py-3 font-medium">{t("tools.table.source")}</th>
                  <th className="px-4 py-3 font-medium">{t("tools.table.enabled")}</th>
                  <th className="px-4 py-3 font-medium">{t("tools.table.autoUse")}</th>
                  <th className="px-4 py-3 font-medium">{t("tools.table.approval")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {rows.map((tool) => (
                  <ToolRow
                    key={tool.id}
                    tool={tool}
                    server={
                      tool.server_id ? servers.find((server) => server.id === tool.server_id) : null
                    }
                    onUpdate={onUpdateTool}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

function McpSection({
  servers,
  toolsByServer,
  secrets,
  selected,
  setSelectedId,
  viewMode,
  busy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onDiscover,
  onUpdateTool,
}: {
  servers: ToolServer[];
  toolsByServer: Map<string, ToolRecord[]>;
  secrets: ToolSecretPublic[];
  selected: ToolServer | null;
  setSelectedId: (id: string) => void;
  viewMode: ViewMode;
  busy: boolean;
  onAdd: () => void;
  onEdit: (server: ToolServer) => void;
  onDelete: (server: ToolServer) => void;
  onToggle: (server: ToolServer, enabled: boolean) => void;
  onTest: (server: ToolServer) => void;
  onDiscover: (server: ToolServer) => void;
  onUpdateTool: (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (servers.length === 0) {
    return (
      <EmptyTools message={t("tools.mcp.empty")} action={t("tools.mcp.add")} onAction={onAdd} />
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className={viewMode === "cards" ? "grid gap-3 md:grid-cols-2" : "space-y-2"}>
        {servers.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            selected={selected?.id === server.id}
            tools={toolsByServer.get(server.id) ?? []}
            secretCount={secrets.filter((secret) => secret.owner_id === server.id).length}
            busy={busy}
            onSelect={() => setSelectedId(server.id)}
            onEdit={() => onEdit(server)}
            onDelete={() => onDelete(server)}
            onToggle={(enabled) => onToggle(server, enabled)}
            onTest={() => onTest(server)}
            onDiscover={() => onDiscover(server)}
          />
        ))}
      </div>
      <McpDetail
        server={selected}
        tools={selected ? (toolsByServer.get(selected.id) ?? []) : []}
        secrets={selected ? secrets.filter((secret) => secret.owner_id === selected.id) : []}
        busy={busy}
        onUpdateTool={onUpdateTool}
        onTest={selected ? () => onTest(selected) : undefined}
        onDiscover={selected ? () => onDiscover(selected) : undefined}
      />
    </div>
  );
}

function SkillsSection({
  skills,
  selected,
  setSelectedId,
  runsByWorkflow,
  viewMode,
  busy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: {
  skills: ToolSkill[];
  selected: ToolSkill | null;
  setSelectedId: (id: string) => void;
  runsByWorkflow: Map<string, WorkflowRun[]>;
  viewMode: ViewMode;
  busy: boolean;
  onAdd: () => void;
  onEdit: (skill: ToolSkill) => void;
  onDelete: (skill: ToolSkill) => void;
  onToggle: (skill: ToolSkill, enabled: boolean) => void;
  onRun: (skill: ToolSkill) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (skills.length === 0) {
    return (
      <EmptyTools message={t("tools.skill.empty")} action={t("tools.skill.add")} onAction={onAdd} />
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className={viewMode === "cards" ? "grid gap-3 md:grid-cols-2" : "space-y-2"}>
        {skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            selected={selected?.id === skill.id}
            runs={skill.workflow_id ? (runsByWorkflow.get(skill.workflow_id) ?? []) : []}
            busy={busy}
            onSelect={() => setSelectedId(skill.id)}
            onEdit={() => onEdit(skill)}
            onDelete={() => onDelete(skill)}
            onToggle={(enabled) => onToggle(skill, enabled)}
            onRun={() => onRun(skill)}
          />
        ))}
      </div>
      <SkillDetail
        skill={selected}
        runs={selected?.workflow_id ? (runsByWorkflow.get(selected.workflow_id) ?? []) : []}
      />
    </div>
  );
}

function SecretsSection({
  snapshot,
  form,
  setForm,
  busy,
  onSave,
  onDelete,
}: {
  snapshot: ToolsSnapshot;
  form: SecretFormState;
  setForm: (form: SecretFormState) => void;
  busy: boolean;
  onSave: (ownerType: "server" | "tool", ownerId: string) => Promise<void>;
  onDelete: (secret: ToolSecretPublic) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const owners = [
    ...snapshot.toolServers
      .filter((server) => server.kind === "mcp")
      .map((server) => ({ id: server.id, type: "server" as const, label: `MCP / ${server.name}` })),
    ...snapshot.skills.map((skill) => ({
      id: skill.id,
      type: "tool" as const,
      label: `${t("tools.kind.skill")} / ${skill.name}`,
    })),
  ];
  const owner = owners.find((item) => item.id === form.ownerId) ?? owners[0] ?? null;
  const patch = (value: Partial<SecretFormState>): void => setForm({ ...form, ...value });
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <Card.Header>
          <Card.Title>{t("tools.secrets.title")}</Card.Title>
          <Card.Description>{t("tools.secrets.description")}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("tools.field.owner")}>
              <select
                className="h-10 rounded-md border border-foreground/10 bg-background px-3 text-sm"
                value={form.ownerId || owner?.id || ""}
                onChange={(event) => patch({ ownerId: event.target.value })}
              >
                {owners.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("tools.field.secretKey")}>
              <Input value={form.key} onChange={(event) => patch({ key: event.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("tools.field.secretLabel")}>
              <Input
                value={form.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </Field>
            <Field label={t("tools.field.secretValue")}>
              <Input
                type="password"
                value={form.value}
                onChange={(event) => patch({ value: event.target.value })}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            isDisabled={!owner || !form.key.trim() || !form.value.trim() || busy}
            onPress={() => owner && void onSave(owner.type, form.ownerId || owner.id)}
          >
            <IconKey className="size-4" />
            {t("tools.secrets.save")}
          </Button>
        </Card.Content>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>{t("tools.secrets.saved")}</Card.Title>
          <Card.Description>{t("tools.secrets.redacted")}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-2 p-4">
          {snapshot.secrets.length === 0 ? (
            <p className="text-sm text-foreground/45">{t("tools.secrets.empty")}</p>
          ) : (
            snapshot.secrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{secret.label}</p>
                  <p className="truncate text-xs text-foreground/45">
                    $secret:{secret.key} / {f.dateTime(secret.updated_at)}
                  </p>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="danger"
                  onPress={() => onDelete(secret)}
                  aria-label={t("common.delete")}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
            ))
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function ToolFilters({
  query,
  setQuery,
  kind,
  setKind,
  status,
  setStatus,
}: {
  query: string;
  setQuery: (query: string) => void;
  kind: ToolKindFilter;
  setKind: (kind: ToolKindFilter) => void;
  status: ToolStatusFilter;
  setStatus: (status: ToolStatusFilter) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-64 flex-1">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tools.search.placeholder")}
          className="pl-9"
        />
      </div>
      <select
        className="h-10 rounded-md border border-foreground/10 bg-background px-3 text-sm"
        value={kind}
        onChange={(event) => setKind(event.target.value as ToolKindFilter)}
        aria-label={t("tools.filter.kind")}
      >
        <option value="all">{t("tools.filter.all")}</option>
        <option value="builtin">{t("tools.kind.builtin")}</option>
        <option value="mcp">{t("tools.kind.mcp")}</option>
        <option value="skill">{t("tools.kind.skill")}</option>
        <option value="sandbox">{t("tools.kind.sandbox")}</option>
      </select>
      <select
        className="h-10 rounded-md border border-foreground/10 bg-background px-3 text-sm"
        value={status}
        onChange={(event) => setStatus(event.target.value as ToolStatusFilter)}
        aria-label={t("tools.filter.status")}
      >
        <option value="all">{t("tools.filter.all")}</option>
        <option value="enabled">{t("tools.filter.enabled")}</option>
        <option value="approval">{t("tools.approval")}</option>
      </select>
    </div>
  );
}

function ToolRow({
  tool,
  server,
  onUpdate,
}: {
  tool: ToolRecord;
  server: ToolServer | null | undefined;
  onUpdate: (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5">
            <IconWrench className="size-4 text-foreground/60" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{tool.title ?? tool.name}</p>
            <p className="truncate text-xs text-foreground/45">{tool.description}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Chip size="sm" variant="soft">
          {tool.kind}
        </Chip>
      </td>
      <td className="px-4 py-3 text-xs text-foreground/50">{server?.name ?? tool.category}</td>
      <td className="px-4 py-3">
        <Switch
          size="sm"
          isSelected={tool.enabled !== 0}
          onChange={(enabled) => onUpdate(tool, { enabled })}
          aria-label={t("tools.table.enabled")}
        />
      </td>
      <td className="px-4 py-3">
        <Switch
          size="sm"
          isSelected={tool.auto_use !== 0}
          onChange={(auto_use) => onUpdate(tool, { auto_use })}
          aria-label={t("tools.table.autoUse")}
        />
      </td>
      <td className="px-4 py-3">
        <Switch
          size="sm"
          isSelected={tool.requires_approval !== 0}
          onChange={(requires_approval) => onUpdate(tool, { requires_approval })}
          aria-label={t("tools.table.approval")}
        />
      </td>
    </tr>
  );
}

function McpServerCard({
  server,
  selected,
  tools,
  secretCount,
  busy,
  onSelect,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onDiscover,
}: {
  server: ToolServer;
  selected: boolean;
  tools: ToolRecord[];
  secretCount: number;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onDiscover: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const enabledTools = tools.filter((tool) => tool.enabled !== 0).length;
  return (
    <Card className={selected ? "border-accent/45 bg-accent/[0.035]" : ""}>
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <button type="button" className="min-w-0 text-left" onClick={onSelect}>
            <Card.Title className="truncate">{server.name}</Card.Title>
            <Card.Description className="truncate">
              {server.description || t("tools.mcp.noDescription")}
            </Card.Description>
          </button>
          <StatusChip status={server.enabled ? server.status : "disabled"} />
        </div>
      </Card.Header>
      <Card.Content className="space-y-3">
        <DetailGrid
          rows={[
            [t("tools.field.transport"), server.transport],
            [t("tools.field.tools"), `${enabledTools} / ${tools.length}`],
            [t("tools.field.secrets"), f.number(secretCount)],
            [t("tools.field.endpoint"), server.url ?? server.command ?? t("tools.none")],
          ]}
        />
        {server.last_error ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {server.last_error}
          </p>
        ) : null}
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={server.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t("tools.enabled")}
            </Switch.Content>
          </Switch>
          <ActionButtons
            busy={busy}
            onTest={onTest}
            onDiscover={onDiscover}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </Card.Footer>
    </Card>
  );
}

function McpDetail({
  server,
  tools,
  secrets,
  busy,
  onUpdateTool,
  onTest,
  onDiscover,
}: {
  server: ToolServer | null;
  tools: ToolRecord[];
  secrets: ToolSecretPublic[];
  busy: boolean;
  onUpdateTool: (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
  onTest?: () => void;
  onDiscover?: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  if (!server) {
    return (
      <Card>
        <Card.Content className="flex min-h-80 items-center justify-center p-4 text-sm text-foreground/45">
          {t("tools.mcp.empty")}
        </Card.Content>
      </Card>
    );
  }
  return (
    <Card className="xl:sticky xl:top-0">
      <Card.Header>
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <Card.Title className="truncate">{server.name}</Card.Title>
            <Card.Description className="truncate">
              {server.url ?? server.command ?? server.transport}
            </Card.Description>
          </div>
          <IconGlobe className="size-5 text-foreground/45" />
        </div>
      </Card.Header>
      <Card.Content className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isDisabled={busy || !onTest} onPress={onTest}>
            <IconCheck className="size-4" />
            {t("tools.action.test")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={busy || !onDiscover}
            onPress={onDiscover}
          >
            <IconRotateCcw className="size-4" />
            {t("tools.action.discover")}
          </Button>
        </div>
        <DetailGrid
          rows={[
            [t("tools.field.status"), server.status],
            [
              t("tools.field.connected"),
              server.last_connected_at ? f.dateTime(server.last_connected_at) : t("tools.never"),
            ],
            [t("tools.field.args"), server.args_json],
            [t("tools.field.env"), server.env_json],
          ]}
        />
        <ToolToggleList tools={tools} onUpdateTool={onUpdateTool} />
        <SecretList secrets={secrets} />
      </Card.Content>
    </Card>
  );
}

function SkillCard({
  skill,
  selected,
  runs,
  busy,
  onSelect,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: {
  skill: ToolSkill;
  selected: boolean;
  runs: WorkflowRun[];
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  return (
    <Card className={selected ? "border-accent/45 bg-accent/[0.035]" : ""}>
      <Card.Header>
        <button type="button" className="min-w-0 text-left" onClick={onSelect}>
          <Card.Title className="truncate">{skill.name}</Card.Title>
          <Card.Description className="truncate">
            {skill.description || t("tools.skill.noDescription")}
          </Card.Description>
        </button>
      </Card.Header>
      <Card.Content className="space-y-3">
        <DetailGrid
          rows={[
            [t("tools.field.category"), skill.category],
            [t("tools.field.runs"), f.number(runs.length)],
            [
              t("tools.field.lastRun"),
              skill.last_run_at ? f.dateTime(skill.last_run_at) : t("tools.never"),
            ],
          ]}
        />
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={skill.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t("tools.enabled")}
            </Switch.Content>
          </Switch>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onPress={onRun}
              isDisabled={busy || skill.enabled === 0}
            >
              <IconCheck className="size-4" />
              {t("tools.action.run")}
            </Button>
            <Button size="sm" variant="secondary" onPress={onEdit} isDisabled={busy}>
              <IconEdit className="size-4" />
              {t("common.edit")}
            </Button>
            <Button size="sm" variant="danger" onPress={onDelete} isDisabled={busy}>
              <IconTrash className="size-4" />
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

function SkillDetail({
  skill,
  runs,
}: {
  skill: ToolSkill | null;
  runs: WorkflowRun[];
}): React.JSX.Element {
  const { t, f } = useT();
  if (!skill) {
    return (
      <Card>
        <Card.Content className="flex min-h-80 items-center justify-center p-4 text-sm text-foreground/45">
          {t("tools.skill.empty")}
        </Card.Content>
      </Card>
    );
  }
  const steps = readSkillSteps(skill);
  return (
    <Card className="xl:sticky xl:top-0">
      <Card.Header>
        <Card.Title>{skill.name}</Card.Title>
        <Card.Description>{skill.category}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 p-4">
        <DetailGrid
          rows={[
            [t("tools.field.workflow"), skill.workflow_id ?? t("tools.none")],
            [t("tools.field.triggers"), skill.trigger_keywords_json],
            [t("tools.field.tags"), skill.tags_json],
            [t("tools.field.config"), skill.config_json],
          ]}
        />
        <MiniList
          title={t("tools.skill.steps")}
          empty={t("tools.mcp.noTools")}
          items={steps.map((step) => ({
            id: step.id,
            title: step.title,
            detail: `${step.type}: ${step.detail}`,
          }))}
        />
        <MiniList
          title={t("tools.skill.runs")}
          empty={t("tools.skill.noRuns")}
          items={runs.slice(0, 6).map((run) => ({
            id: run.id,
            title: run.status,
            detail: f.dateTime(run.started_at),
          }))}
        />
      </Card.Content>
    </Card>
  );
}

function ToolToggleList({
  tools,
  onUpdateTool,
}: {
  tools: ToolRecord[];
  onUpdateTool: (
    tool: ToolRecord,
    patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
  ) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("tools.mcp.tools")}</h3>
      {tools.length === 0 ? (
        <p className="rounded-md border border-dashed border-foreground/15 px-3 py-4 text-sm text-foreground/45">
          {t("tools.mcp.noTools")}
        </p>
      ) : (
        <div className="space-y-2">
          {tools.map((tool) => (
            <div key={tool.id} className="rounded-md border border-foreground/10 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tool.title ?? tool.name}</p>
                  <p className="line-clamp-2 text-xs text-foreground/45">{tool.description}</p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <SmallSwitch
                    label={t("tools.enabled")}
                    selected={tool.enabled !== 0}
                    onChange={(enabled) => onUpdateTool(tool, { enabled })}
                  />
                  <SmallSwitch
                    label={t("tools.autoUse")}
                    selected={tool.auto_use !== 0}
                    onChange={(auto_use) => onUpdateTool(tool, { auto_use })}
                  />
                  <SmallSwitch
                    label={t("tools.approval")}
                    selected={tool.requires_approval !== 0}
                    onChange={(requires_approval) => onUpdateTool(tool, { requires_approval })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DiagnosticsStrip({ events }: { events: RuntimeEvent[] }): React.JSX.Element {
  const { t, f } = useT();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground/70">{t("settings.diagnostics.title")}</h3>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-foreground/15 px-3 py-4 text-sm text-foreground/45">
          {t("tools.audit.empty")}
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-md border border-foreground/10 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{event.title}</p>
                <Chip
                  size="sm"
                  variant="soft"
                  color={event.status === "failed" ? "danger" : "default"}
                >
                  {event.kind}
                </Chip>
              </div>
              <p className="mt-1 text-xs text-foreground/45">{f.dateTime(event.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ToolEditorModal({
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
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tool-editor-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
          <div>
            <h2 id="tool-editor-title" className="text-base font-semibold">
              {editor.type === "mcp"
                ? editor.item
                  ? t("tools.mcp.edit")
                  : t("tools.mcp.add")
                : editor.item
                  ? t("tools.skill.edit")
                  : t("tools.skill.add")}
            </h2>
            <p className="mt-1 text-sm text-foreground/50">{t("tools.editor.subtitle")}</p>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {formError ? (
            <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}
          {editor.type === "mcp" ? (
            <McpForm form={mcpForm} setForm={setMcpForm} />
          ) : (
            <SkillForm form={skillForm} setForm={setSkillForm} />
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-foreground/10 px-5 py-4">
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" isPending={busy} onPress={onSave}>
            <IconCheck className="size-4" />
            {t("tools.action.save")}
          </Button>
        </footer>
      </div>
    </div>
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
        <Field label={t("tools.field.name")}>
          <Input value={form.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label={t("tools.field.transport")}>
          <select
            className="h-10 rounded-md border border-foreground/10 bg-background px-3 text-sm"
            value={form.transport}
            onChange={(event) => patch({ transport: event.target.value as McpTransportKind })}
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </Field>
      </div>
      <Field label={t("tools.field.description")}>
        <TextArea
          rows={3}
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>
      {form.transport === "stdio" ? (
        <div className="grid gap-3">
          <Field label={t("tools.field.command")}>
            <Input
              value={form.command}
              onChange={(event) => patch({ command: event.target.value })}
            />
          </Field>
          <Field label={t("tools.field.cwd")}>
            <Input value={form.cwd} onChange={(event) => patch({ cwd: event.target.value })} />
          </Field>
          <JsonField
            label={t("tools.field.args")}
            value={form.args}
            onChange={(args) => patch({ args })}
          />
          <JsonField
            label={t("tools.field.env")}
            value={form.env}
            onChange={(env) => patch({ env })}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          <Field label={t("tools.field.url")}>
            <Input value={form.url} onChange={(event) => patch({ url: event.target.value })} />
          </Field>
          <JsonField
            label={t("tools.field.headers")}
            value={form.headers}
            onChange={(headers) => patch({ headers })}
          />
        </div>
      )}
      <SwitchRow
        values={[
          [t("tools.enabled"), form.enabled, (enabled) => patch({ enabled })],
          [t("tools.autoUse"), form.auto_use, (auto_use) => patch({ auto_use })],
          [
            t("tools.approval"),
            form.requires_approval,
            (requires_approval) => patch({ requires_approval }),
          ],
        ]}
      />
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
        <Field label={t("tools.field.name")}>
          <Input value={form.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label={t("tools.field.category")}>
          <Input
            value={form.category}
            onChange={(event) => patch({ category: event.target.value })}
          />
        </Field>
      </div>
      <Field label={t("tools.field.description")}>
        <TextArea
          rows={3}
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonField
          label={t("tools.field.triggers")}
          value={form.triggerKeywords}
          onChange={(triggerKeywords) => patch({ triggerKeywords })}
        />
        <JsonField
          label={t("tools.field.tags")}
          value={form.tags}
          onChange={(tags) => patch({ tags })}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonField
          label={t("tools.field.configSchema")}
          value={form.configSchema}
          onChange={(configSchema) => patch({ configSchema })}
        />
        <JsonField
          label={t("tools.field.config")}
          value={form.config}
          onChange={(config) => patch({ config })}
        />
      </div>
      <JsonField
        label={t("tools.field.steps")}
        value={form.steps}
        rows={10}
        onChange={(steps) => patch({ steps })}
      />
      <SwitchRow
        values={[
          [t("tools.enabled"), form.enabled, (enabled) => patch({ enabled })],
          [t("tools.autoUse"), form.auto_use, (auto_use) => patch({ auto_use })],
          [
            t("tools.approval"),
            form.requires_approval,
            (requires_approval) => patch({ requires_approval }),
          ],
        ]}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="grid gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      {children}
    </label>
  );
}

function JsonField({
  label,
  value,
  rows = 5,
  onChange,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <Field label={label}>
      <TextArea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function SwitchRow({
  values,
}: {
  values: Array<[string, boolean, (value: boolean) => void]>;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-4">
      {values.map(([label, selected, onChange]) => (
        <SmallSwitch key={label} label={label} selected={selected} onChange={onChange} />
      ))}
    </div>
  );
}

function SmallSwitch({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: boolean;
  onChange: (selected: boolean) => void;
}): React.JSX.Element {
  return (
    <Switch size="sm" isSelected={selected} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}

function ActionButtons({
  busy,
  onTest,
  onDiscover,
  onEdit,
  onDelete,
}: {
  busy: boolean;
  onTest: () => void;
  onDiscover: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="secondary" onPress={onTest} isDisabled={busy}>
        <IconCheck className="size-4" />
        {t("tools.action.test")}
      </Button>
      <Button size="sm" variant="secondary" onPress={onDiscover} isDisabled={busy}>
        <IconRotateCcw className="size-4" />
        {t("tools.action.discover")}
      </Button>
      <Button size="sm" variant="secondary" onPress={onEdit} isDisabled={busy}>
        <IconEdit className="size-4" />
        {t("common.edit")}
      </Button>
      <Button size="sm" variant="danger" onPress={onDelete} isDisabled={busy}>
        <IconTrash className="size-4" />
        {t("common.delete")}
      </Button>
    </div>
  );
}

function SecretList({ secrets }: { secrets: ToolSecretPublic[] }): React.JSX.Element {
  const { t, f } = useT();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("tools.secrets.title")}</h3>
      {secrets.length === 0 ? (
        <p className="rounded-md border border-dashed border-foreground/15 px-3 py-4 text-sm text-foreground/45">
          {t("tools.secrets.empty")}
        </p>
      ) : (
        secrets.map((secret) => (
          <div key={secret.id} className="rounded-md border border-foreground/10 px-3 py-2">
            <p className="text-sm font-medium">{secret.label}</p>
            <p className="text-xs text-foreground/45">
              $secret:{secret.key} / {f.dateTime(secret.updated_at)}
            </p>
          </div>
        ))
      )}
    </section>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, ReactNode]> }): React.JSX.Element {
  return (
    <div className="grid gap-2 rounded-md border border-foreground/10 px-3 py-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 sm:grid-cols-[112px_minmax(0,1fr)]">
          <span className="text-foreground/40">{label}</span>
          <span className="min-w-0 break-words text-foreground/70">{value}</span>
        </div>
      ))}
    </div>
  );
}

function MiniList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; detail: string }>;
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-foreground/15 px-3 py-4 text-sm text-foreground/45">
          {empty}
        </p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="rounded-md border border-foreground/10 px-3 py-2">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <p className="mt-1 truncate text-xs text-foreground/45">{item.detail}</p>
          </div>
        ))
      )}
    </section>
  );
}

function StatusChip({ status }: { status: string }): React.JSX.Element {
  const color =
    status === "ready" || status === "succeeded"
      ? "success"
      : status === "error" || status === "failed"
        ? "danger"
        : status === "disabled" || status === "cancelled"
          ? "default"
          : "accent";
  return (
    <Chip size="sm" color={color} variant="soft">
      {status}
    </Chip>
  );
}

function MetricCard({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <Card>
      <Card.Content className="p-4">
        <p className="text-xs text-foreground/45">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      </Card.Content>
    </Card>
  );
}

function EmptyTools({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-foreground/15 px-6 text-center text-sm text-foreground/45">
      <IconWrench className="size-8" />
      <p>{message}</p>
      {action && onAction ? (
        <Button variant="primary" size="sm" onPress={onAction}>
          <IconPlus className="size-4" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

function buildMcpForm(server?: ToolServer): McpFormState {
  return {
    name: server?.name ?? "",
    description: server?.description ?? "",
    transport: server?.transport ?? "stdio",
    enabled: server?.enabled !== 0,
    auto_use: server?.auto_use !== 0,
    requires_approval: server?.requires_approval !== 0,
    command: server?.command ?? "",
    args: prettyJson(readArray(server?.args_json ?? "[]")),
    url: server?.url ?? "",
    headers: prettyJson(readObject(server?.headers_json ?? "{}")),
    env: prettyJson(readObject(server?.env_json ?? "{}")),
    cwd: server?.cwd ?? "",
  };
}

function buildSkillForm(skill?: ToolSkill): SkillFormState {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    category: skill?.category ?? "workflow",
    enabled: skill?.enabled !== 0,
    auto_use: skill?.auto_use !== 0,
    requires_approval: skill?.requires_approval !== 0,
    triggerKeywords: prettyJson(readArray(skill?.trigger_keywords_json ?? "[]")),
    tags: prettyJson(readArray(skill?.tags_json ?? "[]")),
    configSchema: prettyJson(readObject(skill?.config_schema_json ?? "{}")),
    config: prettyJson(readObject(skill?.config_json ?? "{}")),
    steps: prettyJson(skill ? readSkillSteps(skill) : DEFAULT_SKILL_STEPS),
  };
}

function readSkillSteps(skill: ToolSkill): ToolSkillStep[] {
  return normalizeToolSkillSteps(skill.steps_json);
}

function groupByServer(tools: ToolRecord[]): Map<string, ToolRecord[]> {
  const grouped = new Map<string, ToolRecord[]>();
  for (const tool of tools) {
    if (!tool.server_id) continue;
    grouped.set(tool.server_id, [...(grouped.get(tool.server_id) ?? []), tool]);
  }
  return grouped;
}

function groupRuns(runs: WorkflowRun[]): Map<string, WorkflowRun[]> {
  const grouped = new Map<string, WorkflowRun[]>();
  for (const run of runs)
    grouped.set(run.workflow_id, [...(grouped.get(run.workflow_id) ?? []), run]);
  return grouped;
}

function readArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isDiscoveryResult(value: unknown): value is ToolDiscoveryResult {
  return !!value && typeof value === "object" && "message" in value && "server" in value;
}

function toToolsTab(value: unknown): ToolsTab {
  return value === "mcp" || value === "skills" || value === "secrets" ? value : "registry";
}
