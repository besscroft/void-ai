import { useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Modal,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
} from "./ui";
import { strFromU8, unzipSync } from "fflate";
import { api, type ToolsSnapshot } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import {
  buildMcpInput,
  buildSkillInputFromMarkdown,
  parseSkillMarkdown,
  type McpFormState,
  type SkillPackageDraft,
} from "../lib/tools-form";
import { filterToolRecords, type ToolKindFilter, type ToolStatusFilter } from "../lib/tools-filter";
import { cn } from "../lib/utils";
import { isChatToolId } from "@shared/types";
import type { McpTransportKind, ToolRecord, ToolServer, ToolSkill } from "@shared/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconGlobe,
  IconList,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "./icons";

type ToolsTab = "registry" | "mcp" | "skills";
type DeleteTarget = { type: "mcp"; item: ToolServer } | { type: "skill"; item: ToolSkill } | null;

const EMPTY_MCP_FORM: McpFormState = {
  name: "",
  description: "",
  transport: "stdio",
  enabled: true,
  auto_use: false,
  requires_approval: true,
  commandLine: "",
  command: "",
  args: "[]",
  url: "",
  headers: "",
  env: "",
  cwd: "",
  timeoutSeconds: "60",
};

export function ToolsPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ToolsTab>("registry");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ToolKindFilter>("all");
  const [status, setStatus] = useState<ToolStatusFilter>("all");
  const [mcpOpen, setMcpOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const refresh = (): void => {
    setRefreshing(true);
    void api.tools
      .snapshot()
      .then(setSnapshot)
      .catch((error) => notify.error(t("tools.toast.failed"), error, locale))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
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

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
    } catch (error) {
      notify.error(t("tools.toast.failed"), error, locale);
    } finally {
      refresh();
      setBusy(false);
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

  return (
    <div className="flex h-full w-full flex-col gap-5">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{t("main.title.tools")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
            <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
            {t("main.refresh")}
          </Button>
          {tab === "mcp" ? (
            <Button variant="primary" size="sm" onPress={() => setMcpOpen(true)}>
              <IconPlus className="size-4" />
              {t("tools.mcp.add")}
            </Button>
          ) : null}
          {tab === "skills" ? (
            <Button variant="primary" size="sm" onPress={() => setSkillOpen(true)}>
              <IconPlus className="size-4" />
              {t("tools.skill.add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid shrink-0 gap-3 sm:grid-cols-3">
        <MetricCard label={t("tools.metric.tools")} value={snapshot?.toolRecords.length ?? 0} />
        <MetricCard label={t("tools.metric.mcp")} value={mcpServers.length} />
        <MetricCard label={t("tools.metric.skills")} value={snapshot?.skills.length ?? 0} />
      </div>

      <div className="shrink-0">
        <Tabs value={tab} onValueChange={(key) => setTab(toToolsTab(key))}>
          <TabsList aria-label={t("tools.tabs.label")}>
            <TabsTrigger value="registry">{t("tools.tab.registry")}</TabsTrigger>
            <TabsTrigger value="mcp">{t("tools.tab.mcp")}</TabsTrigger>
            <TabsTrigger value="skills">{t("tools.tab.skills")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "registry" && snapshot ? (
        <div className="grid shrink-0 gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="relative min-w-0">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("tools.search.placeholder")}
              className="pl-9"
            />
          </label>
          <select
            className="h-10 min-w-0 rounded-md border border-foreground/10 bg-background px-3 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as ToolKindFilter)}
          >
            <option value="all">{t("tools.filter.allKinds")}</option>
            <option value="builtin">{t("tools.kind.builtin")}</option>
            <option value="mcp">{t("tools.kind.mcp")}</option>
            <option value="skill">{t("tools.kind.skill")}</option>
            <option value="sandbox">{t("tools.kind.sandbox")}</option>
          </select>
          <select
            className="h-10 min-w-0 rounded-md border border-foreground/10 bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as ToolStatusFilter)}
          >
            <option value="all">{t("tools.filter.allStatus")}</option>
            <option value="enabled">{t("tools.filter.enabled")}</option>
            <option value="approval">{t("tools.filter.approval")}</option>
          </select>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !snapshot ? (
          <div className="rounded-md border border-dashed border-foreground/15 px-4 py-16 text-center text-sm text-foreground/45">
            {t("main.loading")}
          </div>
        ) : null}

        {tab === "registry" && snapshot ? <RegistrySection rows={rows} /> : null}

        {tab === "mcp" && snapshot ? (
          <McpSection
            servers={mcpServers}
            toolsByServer={mcpToolsByServer}
            busy={busy}
            onAdd={() => setMcpOpen(true)}
            onDelete={(server) => setDeleteTarget({ type: "mcp", item: server })}
            onToggle={(server, enabled) =>
              runAction(() => api.tools.mcp.setEnabled(server.id, enabled), t("tools.toast.saved"))
            }
          />
        ) : null}

        {tab === "skills" && snapshot ? (
          <SkillsSection
            skills={snapshot.skills}
            busy={busy}
            onAdd={() => setSkillOpen(true)}
            onDelete={(skill) => setDeleteTarget({ type: "skill", item: skill })}
            onToggle={(skill, enabled) =>
              runAction(
                () => api.tools.skills.setEnabled(skill.id, enabled),
                t("tools.toast.saved"),
              )
            }
          />
        ) : null}
      </div>

      <AddMcpModal
        open={mcpOpen}
        busy={busy}
        onClose={() => setMcpOpen(false)}
        onCreate={(input) =>
          runAction(async () => {
            const server = await api.tools.mcp.create(input);
            const discovery = await api.tools.mcp.discover(server.id);
            setMcpOpen(false);
            if (discovery.server.status === "error") throw new Error(discovery.message);
          }, t("tools.toast.discovered"))
        }
      />

      <AddSkillModal
        open={skillOpen}
        busy={busy}
        onClose={() => setSkillOpen(false)}
        onCreate={(markdown, source) =>
          runAction(async () => {
            await api.tools.skills.create(buildSkillInputFromMarkdown(markdown, source));
            setSkillOpen(false);
          }, t("tools.toast.saved"))
        }
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

function RegistrySection({ rows }: { rows: ToolRecord[] }): React.JSX.Element {
  const { t } = useT();
  return (
    <>
      {rows.length === 0 ? (
        <EmptyTools message={t("tools.registry.empty")} />
      ) : (
        <div className="overflow-hidden rounded-md border border-foreground/10">
          {rows.map((tool, index) => (
            <div
              key={tool.id}
              className={[
                "grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                index > 0 ? "border-t border-foreground/10" : "",
              ].join(" ")}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {localizeToolName(t, tool)}
                  </p>
                  <Chip size="sm" variant="secondary">
                    {t(`tools.kind.${tool.kind}`)}
                  </Chip>
                  {tool.enabled ? (
                    <Chip size="sm" variant="soft">
                      {t("main.value.enabled")}
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="secondary">
                      {t("main.value.disabled")}
                    </Chip>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-foreground/50">
                  {localizeToolDescription(t, tool)}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-foreground/35">
                  {tool.reference}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2 md:justify-end">
                {tool.auto_use ? <Chip size="sm">{t("tools.autoUse")}</Chip> : null}
                {tool.requires_approval ? <Chip size="sm">{t("tools.approval")}</Chip> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function McpSection({
  servers,
  toolsByServer,
  busy,
  onAdd,
  onDelete,
  onToggle,
}: {
  servers: ToolServer[];
  toolsByServer: Map<string, ToolRecord[]>;
  busy: boolean;
  onAdd: () => void;
  onDelete: (server: ToolServer) => void;
  onToggle: (server: ToolServer, enabled: boolean) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (servers.length === 0) {
    return (
      <EmptyTools message={t("tools.mcp.empty")} action={t("tools.mcp.add")} onAction={onAdd} />
    );
  }
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {servers.map((server) => (
        <McpCard
          key={server.id}
          server={server}
          tools={toolsByServer.get(server.id) ?? []}
          busy={busy}
          onDelete={() => onDelete(server)}
          onToggle={(enabled) => onToggle(server, enabled)}
        />
      ))}
    </section>
  );
}

function McpCard({
  server,
  tools,
  busy,
  onDelete,
  onToggle,
}: {
  server: ToolServer;
  tools: ToolRecord[];
  busy: boolean;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const enabledTools = tools.filter((tool) => tool.enabled !== 0).length;
  return (
    <Card>
      <Card.Header>
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <Card.Title className="truncate">{server.name}</Card.Title>
            <Card.Description className="line-clamp-2">
              {server.description || formatEndpoint(server)}
            </Card.Description>
          </div>
          <IconGlobe className="size-5 shrink-0 text-foreground/40" />
        </div>
      </Card.Header>
      <Card.Content className="space-y-3 p-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <ReadStat label={t("tools.field.transport")} value={server.transport} />
          <ReadStat label={t("tools.field.tools")} value={`${enabledTools} / ${tools.length}`} />
          <ReadStat
            label={t("tools.field.status")}
            value={server.enabled ? server.status : "disabled"}
          />
          <ReadStat label="Timeout" value={`${server.timeout_seconds}s`} />
          <ReadStat
            className="sm:col-span-2"
            label={t("tools.field.endpoint")}
            value={formatEndpoint(server)}
          />
          <ReadStat
            className="sm:col-span-2"
            label={t("tools.field.connected")}
            value={
              server.last_connected_at ? f.dateTime(server.last_connected_at) : t("tools.never")
            }
          />
        </div>
        {server.last_error ? (
          <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {server.last_error}
          </p>
        ) : null}
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={server.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            {t("tools.enabled")}
          </Switch>
          <Button size="sm" variant="danger" onPress={onDelete} isDisabled={busy}>
            <IconTrash className="size-4" />
            {t("common.delete")}
          </Button>
        </div>
      </Card.Footer>
    </Card>
  );
}

function SkillsSection({
  skills,
  busy,
  onAdd,
  onDelete,
  onToggle,
}: {
  skills: ToolSkill[];
  busy: boolean;
  onAdd: () => void;
  onDelete: (skill: ToolSkill) => void;
  onToggle: (skill: ToolSkill, enabled: boolean) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (skills.length === 0) {
    return (
      <EmptyTools message={t("tools.skill.empty")} action={t("tools.skill.add")} onAction={onAdd} />
    );
  }
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {skills.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          busy={busy}
          onDelete={() => onDelete(skill)}
          onToggle={(enabled) => onToggle(skill, enabled)}
        />
      ))}
    </section>
  );
}

function SkillCard({
  skill,
  busy,
  onDelete,
  onToggle,
}: {
  skill: ToolSkill;
  busy: boolean;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const config = safeJsonObject(skill.config_json);
  const source = typeof config.source === "string" ? config.source : "manual";
  const instructions = typeof config.instructions === "string" ? config.instructions : "";
  return (
    <Card>
      <Card.Header>
        <div className="min-w-0">
          <Card.Title className="truncate">{skill.name}</Card.Title>
          <Card.Description className="line-clamp-2">
            {skill.description || t("tools.skill.noDescription")}
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="space-y-3 p-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <ReadStat label={t("tools.field.category")} value={skill.category} />
          <ReadStat label="Source" value={source} />
          <ReadStat
            label={t("tools.field.lastRun")}
            value={skill.last_run_at ? f.dateTime(skill.last_run_at) : t("tools.never")}
          />
          <ReadStat
            label={t("tools.field.workflow")}
            value={skill.workflow_id ?? t("tools.none")}
          />
        </div>
        {instructions ? (
          <p className="line-clamp-4 whitespace-pre-wrap rounded-md bg-foreground/[0.03] px-3 py-2 text-xs text-foreground/55">
            {instructions}
          </p>
        ) : null}
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={skill.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            {t("tools.enabled")}
          </Switch>
          <Button size="sm" variant="danger" onPress={onDelete} isDisabled={busy}>
            <IconTrash className="size-4" />
            {t("common.delete")}
          </Button>
        </div>
      </Card.Footer>
    </Card>
  );
}

function AddMcpModal({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: ReturnType<typeof buildMcpInput>) => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  const [error, setError] = useState<string | null>(null);
  const patch = (value: Partial<McpFormState>): void =>
    setForm((current) => ({ ...current, ...value }));
  const close = (): void => {
    setError(null);
    setForm(EMPTY_MCP_FORM);
    onClose();
  };
  const save = (): void => {
    try {
      setError(null);
      void onCreate(buildMcpInput(form)).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => (!isOpen ? close() : undefined)}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[92vh] w-[min(880px,calc(100vw-24px))] overflow-hidden">
            <Modal.Header>
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{t("tools.mcp.add")}</h3>
                  <p className="line-clamp-2 text-sm text-foreground/50">
                    Manual MCP server connection.
                  </p>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={close}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>
            <Modal.Body className="min-h-0 overflow-y-auto">
              <div className="grid gap-4">
                {error ? (
                  <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="服务类型">
                    <select
                      className="h-10 min-w-0 rounded-md border border-foreground/10 bg-background px-3 text-sm"
                      value={form.transport}
                      onChange={(event) =>
                        patch({ transport: event.target.value as McpTransportKind })
                      }
                    >
                      <option value="stdio">STDIO</option>
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </Field>
                  <Field label="服务器名称">
                    <Input
                      value={form.name}
                      placeholder="my-mcp-server"
                      onChange={(event) => patch({ name: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("tools.field.description")}>
                  <TextArea
                    rows={2}
                    value={form.description}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                </Field>
                {form.transport === "stdio" ? (
                  <Field label="命令">
                    <TextArea
                      rows={3}
                      value={form.commandLine}
                      placeholder="npx -y @modelcontextprotocol/server-filesystem"
                      className="font-mono text-sm"
                      onChange={(event) => patch({ commandLine: event.target.value })}
                    />
                  </Field>
                ) : (
                  <Field label={t("tools.field.url")}>
                    <Input
                      value={form.url}
                      placeholder="https://example.com/mcp"
                      onChange={(event) => patch({ url: event.target.value })}
                    />
                  </Field>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label={form.transport === "stdio" ? "环境变量（可选）" : "Headers（可选）"}
                  >
                    <TextArea
                      rows={4}
                      value={form.transport === "stdio" ? form.env : form.headers}
                      placeholder={
                        form.transport === "stdio"
                          ? "API_KEY=your-api-key"
                          : "Authorization=Bearer token"
                      }
                      className="font-mono text-sm"
                      onChange={(event) =>
                        form.transport === "stdio"
                          ? patch({ env: event.target.value })
                          : patch({ headers: event.target.value })
                      }
                    />
                  </Field>
                  <div className="grid gap-3">
                    <Field label={t("tools.field.cwd")}>
                      <Input
                        value={form.cwd}
                        onChange={(event) => patch({ cwd: event.target.value })}
                      />
                    </Field>
                    <Field label="超时时间（秒）">
                      <Input
                        type="number"
                        min={1}
                        max={600}
                        value={form.timeoutSeconds}
                        onChange={(event) => patch({ timeoutSeconds: event.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={close}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" isPending={busy} onPress={save}>
                  <IconCheck className="size-4" />
                  {t("tools.mcp.add")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function AddSkillModal({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (markdown: string, source: "upload" | "ai") => Promise<void>;
}): React.JSX.Element {
  const { t, locale } = useT();
  const skillFileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [draft, setDraft] = useState<SkillPackageDraft | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [source, setSource] = useState<"upload" | "ai">("upload");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const reset = (): void => {
    setAiPrompt("");
    setDraft(null);
    setMarkdown("");
    setSource("upload");
    setError(null);
  };
  const close = (): void => {
    reset();
    onClose();
  };
  const loadMarkdown = (text: string, nextSource: "upload" | "ai"): void => {
    try {
      const nextDraft = parseSkillMarkdown(text, nextSource);
      setDraft(nextDraft);
      setMarkdown(nextDraft.markdown);
      setSource(nextSource);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const install = (): void => {
    try {
      parseSkillMarkdown(markdown, source);
      void onCreate(markdown, source).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const generate = (): void => {
    setGenerating(true);
    setError(null);
    void api.tools.skills
      .generateDraft({ prompt: aiPrompt })
      .then((result) => loadMarkdown(result.markdown, "ai"))
      .catch((err) => notify.error(t("tools.toast.failed"), err, locale))
      .finally(() => setGenerating(false));
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => (!isOpen ? close() : undefined)}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[92vh] w-[min(920px,calc(100vw-24px))] overflow-hidden">
            <Modal.Header>
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{t("tools.skill.add")}</h3>
                  <p className="line-clamp-2 text-sm text-foreground/50">
                    Upload a SKILL.md package or create one with AI.
                  </p>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={close}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>
            <Modal.Body className="min-h-0 overflow-y-auto">
              <div className="grid gap-4">
                {error ? (
                  <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button variant="secondary" onPress={() => skillFileRef.current?.click()}>
                    <IconList className="size-4" />
                    SKILL.md
                  </Button>
                  <Button variant="secondary" onPress={() => folderRef.current?.click()}>
                    <IconList className="size-4" />
                    Folder
                  </Button>
                  <Button variant="secondary" onPress={() => zipRef.current?.click()}>
                    <IconList className="size-4" />
                    ZIP
                  </Button>
                </div>
                <input
                  ref={skillFileRef}
                  className="hidden"
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  onChange={(event) => void handleSkillFile(event, loadMarkdown, setError)}
                />
                <input
                  ref={folderRef}
                  className="hidden"
                  type="file"
                  multiple
                  {...({ webkitdirectory: "" } as Record<string, string>)}
                  onChange={(event) => void handleSkillFolder(event, loadMarkdown, setError)}
                />
                <input
                  ref={zipRef}
                  className="hidden"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => void handleSkillZip(event, loadMarkdown, setError)}
                />

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label="AI prompt">
                    <TextArea
                      rows={3}
                      value={aiPrompt}
                      placeholder="Describe the skill you want to create"
                      onChange={(event) => setAiPrompt(event.target.value)}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      className="w-full md:w-auto"
                      variant="primary"
                      isDisabled={!aiPrompt.trim()}
                      isPending={generating}
                      onPress={generate}
                    >
                      <IconSparkles className="size-4" />
                      AI Create
                    </Button>
                  </div>
                </div>

                <Field label="SKILL.md preview">
                  <TextArea
                    rows={12}
                    value={markdown}
                    className="font-mono text-xs"
                    onChange={(event) => {
                      setMarkdown(event.target.value);
                      try {
                        setDraft(parseSkillMarkdown(event.target.value, source));
                        setError(null);
                      } catch {
                        setDraft(null);
                      }
                    }}
                  />
                </Field>
                {draft ? (
                  <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
                    <p className="truncate text-sm font-medium">{draft.name}</p>
                    <p className="line-clamp-2 text-xs text-foreground/55">{draft.description}</p>
                  </div>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={close}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" isDisabled={!draft} isPending={busy} onPress={install}>
                  <IconCheck className="size-4" />
                  {t("tools.skill.add")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function MetricCard({ label, value }: { label: string; value: number }): React.JSX.Element {
  const { f } = useT();
  return (
    <div className="rounded-md border border-foreground/10 px-4 py-3">
      <p className="truncate text-xs text-foreground/45">{label}</p>
      <p className="mt-1 text-xl font-semibold">{f.number(value)}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="grid min-w-0 gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      {children}
    </label>
  );
}

function ReadStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={["min-w-0 rounded-md bg-foreground/[0.03] px-3 py-2", className].join(" ")}>
      <p className="truncate text-[11px] text-foreground/40">{label}</p>
      <p className="mt-1 break-all text-xs text-foreground/70">{value || "-"}</p>
    </div>
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
    <div className="rounded-md border border-dashed border-foreground/15 px-4 py-12 text-center">
      <p className="text-sm text-foreground/45">{message}</p>
      {action && onAction ? (
        <Button className="mt-4" variant="primary" size="sm" onPress={onAction}>
          <IconPlus className="size-4" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

async function handleSkillFile(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    onLoad(await file.text(), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

async function handleSkillFolder(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  const skill = files.find(
    (file) => file.name === "SKILL.md" || file.webkitRelativePath.endsWith("/SKILL.md"),
  );
  if (!skill) {
    onError("Folder must contain SKILL.md.");
    return;
  }
  try {
    onLoad(await skill.text(), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

async function handleSkillZip(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const entryName = Object.keys(entries).find(
      (name) => name === "SKILL.md" || name.endsWith("/SKILL.md"),
    );
    if (!entryName) throw new Error("ZIP must contain SKILL.md.");
    onLoad(strFromU8(entries[entryName]!), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

function localizeToolName(t: (key: string) => string, tool: ToolRecord): string {
  if (isChatToolId(tool.name)) return t(`chatTools.${tool.name}.label`);
  return tool.title ?? tool.name;
}

function localizeToolDescription(t: (key: string) => string, tool: ToolRecord): string {
  if (isChatToolId(tool.name)) return t(`chatTools.${tool.name}.description`);
  return tool.description;
}

function groupByServer(tools: ToolRecord[]): Map<string, ToolRecord[]> {
  const grouped = new Map<string, ToolRecord[]>();
  for (const tool of tools) {
    if (!tool.server_id) continue;
    grouped.set(tool.server_id, [...(grouped.get(tool.server_id) ?? []), tool]);
  }
  return grouped;
}

function formatEndpoint(server: ToolServer): string {
  if (server.transport === "stdio") {
    const args = safeJsonArray(server.args_json).join(" ");
    return [server.command, args].filter(Boolean).join(" ") || server.transport;
  }
  return server.url ?? server.transport;
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toToolsTab(value: unknown): ToolsTab {
  return value === "mcp" || value === "skills" ? value : "registry";
}
