import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Slider,
  Switch,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from "./ui";
import {
  api,
  type AgentMemoryFileSnapshot,
  type AgentProfile,
  type MemoryFileKind,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type RuntimeEvent,
} from "../lib/api";
import { useT } from "../lib/i18n";
import { AgentsPanel } from "./AgentsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconDatabase,
  IconEdit,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconTrash,
  IconX,
} from "./icons";
import { cn } from "../lib/utils";

export type MainSection = "agents" | "tools" | "memory";

interface MainPanelViewProps {
  section: MainSection;
}

interface PanelData {
  agents: AgentProfile[];
  runtimeEvents: RuntimeEvent[];
}

const MEMORY_SCOPES: MemoryScope[] = ["global", "agent", "conversation"];
const MEMORY_KINDS: MemoryKind[] = ["fact", "preference", "episode", "profile", "skill"];

export function MainPanelView({ section }: MainPanelViewProps): React.JSX.Element {
  useT();
  const [data, setData] = useState<PanelData>({
    agents: [],
    runtimeEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    void Promise.allSettled([api.agents.list(), api.runtime.events.list()])
      .then(([agentsResult, runtimeEventsResult]) => {
        setData((current) => ({
          agents: agentsResult.status === "fulfilled" ? agentsResult.value : current.agents,
          runtimeEvents:
            runtimeEventsResult.status === "fulfilled"
              ? runtimeEventsResult.value
              : current.runtimeEvents,
        }));
        if (agentsResult.status === "rejected") {
          console.error("[agents] Failed to load agent profiles", agentsResult.reason);
        }
        if (runtimeEventsResult.status === "rejected") {
          console.error("[agents] Failed to load runtime events", runtimeEventsResult.reason);
        }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(refresh, []);

  if (section === "tools") {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <ToolsPanel />
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-5">
        {section === "agents" && (
          <AgentsPanel
            agents={data.agents}
            events={data.runtimeEvents}
            onRefresh={refresh}
            loading={loading || refreshing}
          />
        )}
        {section === "memory" && <MemoryPanel />}
      </div>
    </main>
  );
}

type MemoryPanelTab = "entries" | MemoryFileKind;

function MemoryPanel(): React.JSX.Element {
  const { t, f } = useT();
  const [activeTab, setActiveTab] = useState<MemoryPanelTab>("entries");
  const [memoryFiles, setMemoryFiles] = useState<Record<
    MemoryFileKind,
    AgentMemoryFileSnapshot
  > | null>(null);

  const loadFiles = useCallback(async () => {
    const files = await api.agents.memoryFiles.list();
    setMemoryFiles(files);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFiles();
  }, [loadFiles]);

  const sidebarItems: {
    key: MemoryPanelTab;
    label: string;
    meta?: string;
    status?: string;
  }[] = [
    { key: "entries", label: t("main.memory.tab.entries") },
    {
      key: "soul",
      label: t("main.memory.tab.soul"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.soul.charCount),
            limit: f.number(memoryFiles.soul.charLimit),
          })
        : undefined,
      status: memoryFiles?.soul.userLocked ? t("main.memory.file.locked") : undefined,
    },
    {
      key: "user",
      label: t("main.memory.tab.user"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.user.charCount),
            limit: f.number(memoryFiles.user.charLimit),
          })
        : undefined,
      status: memoryFiles?.user.userLocked ? t("main.memory.file.locked") : undefined,
    },
    {
      key: "memory",
      label: t("main.memory.tab.memory"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.memory.charCount),
            limit: f.number(memoryFiles.memory.charLimit),
          })
        : undefined,
      status: memoryFiles?.memory.userLocked ? t("main.memory.file.locked") : undefined,
    },
  ];

  return (
    <div className="flex h-full items-start gap-4">
      {/* 左侧记忆导航 */}
      <div className="flex w-56 shrink-0 flex-col gap-2 self-stretch rounded-lg border border-border bg-card p-3">
        <h2 className="px-1 py-1 text-sm font-semibold">{t("main.title.memory")}</h2>

        <div className="flex flex-col gap-1">
          {sidebarItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="font-medium">{item.label}</span>
                {(item.meta || item.status) && (
                  <span
                    className={cn(
                      "text-xs",
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {item.meta}
                    {item.meta && item.status && " · "}
                    {item.status}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧内容区域 */}
      <div className="min-w-0 flex-1">
        {activeTab === "entries" && <MemoryEntriesPanel />}
        {activeTab !== "entries" && memoryFiles && (
          <MemoryFilePanel
            kind={activeTab}
            snapshot={memoryFiles[activeTab]}
            onRefresh={loadFiles}
          />
        )}
        {activeTab !== "entries" && !memoryFiles && (
          <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
        )}
      </div>
    </div>
  );
}

function MemoryFilePanel({
  kind,
  snapshot,
  onRefresh,
}: {
  kind: MemoryFileKind;
  snapshot: AgentMemoryFileSnapshot;
  onRefresh: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(snapshot.content);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(snapshot.content);
    setError(null);
  }, [snapshot.content, snapshot.updatedAt]);

  const isOverLimit = draft.length > snapshot.charLimit;

  const handleSave = async (): Promise<void> => {
    if (isOverLimit) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.agents.memoryFiles.save(kind, draft);
      setIsEditing(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReload = async (): Promise<void> => {
    try {
      await api.agents.memoryFiles.reload(kind);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold uppercase">{kind}.md</h2>
          {snapshot.userLocked && (
            <Chip size="sm" variant="soft">
              {t("main.memory.file.locked")}
            </Chip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onPress={handleReload} isDisabled={isSaving}>
            <IconRotateCcw className="size-4" />
            {t("main.memory.file.refresh")}
          </Button>
          {isEditing ? (
            <>
              <Button
                variant="tertiary"
                size="sm"
                onPress={() => setIsEditing(false)}
                isDisabled={isSaving}
              >
                {t("main.memory.file.done")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={handleSave}
                isPending={isSaving}
                isDisabled={isOverLimit}
              >
                {t("main.memory.file.save")}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onPress={() => setIsEditing(true)}>
              <IconEdit className="size-4" />
              {t("main.memory.file.edit")}
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          className="font-mono text-sm"
        />
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-background p-3">
          <pre className="whitespace-pre-wrap font-mono text-sm text-foreground/80">
            {snapshot.content}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className={cn(isOverLimit && "font-medium text-danger")}>
          {t("main.memory.file.charCount", { count: draft.length, limit: snapshot.charLimit })}
        </span>
        <span>{t("main.memory.file.updatedAt", { time: f.dateTime(snapshot.updatedAt) })}</span>
      </div>

      {isOverLimit && (
        <p className="text-xs text-danger">
          {t("main.memory.file.overLimit", { limit: snapshot.charLimit })}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function MemoryEntriesPanel(): React.JSX.Element {
  const { t } = useT();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<{
    scope: MemoryScope | "all";
    kind: MemoryKind | "all";
    pinned: boolean | null;
  }>({ scope: "all", kind: "all", pinned: null });
  const [sortBy, setSortBy] = useState<"salience" | "updated" | "created">("salience");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [deleteBatchIds, setDeleteBatchIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await api.memories.search({
        query: debouncedQuery,
        scope: filters.scope === "all" ? null : filters.scope,
        kind: filters.kind === "all" ? null : filters.kind,
        pinned: filters.pinned,
        sortBy,
        sortOrder,
        limit: 200,
      });
      setMemories(results);
      setSelectedIds((prev) => {
        const ids = new Set(results.map((m) => m.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    } finally {
      setIsLoading(false);
    }
  }, [debouncedQuery, filters, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pinnedCount = useMemo(() => memories.filter((m) => m.pinned === 1).length, [memories]);

  const toggleSelection = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = (): void => {
    setSelectedIds(new Set());
  };

  const handleRefresh = (): void => {
    void load();
  };

  const openNewMemory = (): void => {
    setEditingMemory(null);
    setIsEditModalOpen(true);
  };

  const openEditMemory = (memory: MemoryRecord): void => {
    setEditingMemory(memory);
    setIsEditModalOpen(true);
  };

  const closeEditModal = (): void => {
    if (isSaving) return;
    setIsEditModalOpen(false);
    setEditingMemory(null);
  };

  const handleSaveMemory = async (memory: MemoryRecord): Promise<void> => {
    setIsSaving(true);
    try {
      await api.memories.save(memory);
      setIsEditModalOpen(false);
      setEditingMemory(null);
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    await api.memories.delete(deleteTarget.id);
    setDeleteTarget(null);
    await load();
  };

  const handleDeleteBatch = async (): Promise<void> => {
    if (deleteBatchIds.length === 0) return;
    await api.memories.deleteBatch(deleteBatchIds);
    setDeleteBatchIds([]);
    await load();
  };

  const handleUpdateBatch = async (
    patch: Partial<Pick<MemoryRecord, "pinned" | "kind" | "scope">>,
  ): Promise<void> => {
    if (selectedIds.size === 0) return;
    await api.memories.updateBatch([...selectedIds], patch);
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t("main.memory.search")}</h2>
          <span className="text-sm text-muted-foreground">
            {t("main.memory.selected", { count: selectedIds.size })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onPress={handleRefresh} isDisabled={isLoading}>
            <IconRotateCcw className={cn("size-4", isLoading && "animate-spin")} />
            {t("main.refresh")}
          </Button>
          <Button variant="primary" size="sm" onPress={openNewMemory}>
            <IconPlus className="size-4" />
            {t("main.memory.new")}
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("main.memory.search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label={t("main.memory.filter.scope")}
            value={filters.scope}
            onChange={(scope) =>
              setFilters((prev) => ({ ...prev, scope: scope as typeof prev.scope }))
            }
            options={[
              { value: "all", label: t("main.memory.filter.all") },
              ...MEMORY_SCOPES.map((s) => ({ value: s, label: t(`main.memory.scope.${s}`) })),
            ]}
          />
          <FilterSelect
            label={t("main.memory.filter.kind")}
            value={filters.kind}
            onChange={(kind) => setFilters((prev) => ({ ...prev, kind: kind as typeof prev.kind }))}
            options={[
              { value: "all", label: t("main.memory.filter.all") },
              ...MEMORY_KINDS.map((k) => ({ value: k, label: t(`main.memory.kind.${k}`) })),
            ]}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("main.memory.filter.pinned")}</span>
            <ToggleButtonGroup
              selectedKeys={
                filters.pinned === null ? ["all"] : filters.pinned ? ["pinned"] : ["unpinned"]
              }
              onSelectionChange={(keys) => {
                const key = [...keys][0];
                setFilters((prev) => ({
                  ...prev,
                  pinned: key === "pinned" ? true : key === "unpinned" ? false : null,
                }));
              }}
              size="sm"
            >
              <ToggleButton id="all">{t("main.memory.filter.all")}</ToggleButton>
              <ToggleButton id="pinned">{t("main.memory.bulk.pin")}</ToggleButton>
              <ToggleButton id="unpinned">{t("main.memory.bulk.unpin")}</ToggleButton>
            </ToggleButtonGroup>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("main.memory.sort.by")}</span>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="salience">{t("main.memory.sort.salience")}</option>
              <option value="updated">{t("main.memory.sort.updated")}</option>
              <option value="created">{t("main.memory.sort.created")}</option>
            </select>
            <ToggleButtonGroup
              selectedKeys={[sortOrder]}
              onSelectionChange={(keys) => {
                const key = [...keys][0];
                if (key === "asc" || key === "desc") setSortOrder(key);
              }}
              size="sm"
            >
              <ToggleButton id="desc">{t("main.memory.sort.desc")}</ToggleButton>
              <ToggleButton id="asc">{t("main.memory.sort.asc")}</ToggleButton>
            </ToggleButtonGroup>
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onPress={clearSelection}>
              <IconX className="size-4" />
              {t("common.cancel")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("main.memory.selected", { count: selectedIds.size })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onPress={() => handleUpdateBatch({ pinned: 1 })}>
              {t("main.memory.bulk.pin")}
            </Button>
            <Button variant="secondary" size="sm" onPress={() => handleUpdateBatch({ pinned: 0 })}>
              {t("main.memory.bulk.unpin")}
            </Button>
            <BulkSelect
              value=""
              placeholder={t("main.memory.filter.kind")}
              options={MEMORY_KINDS.map((k) => ({ value: k, label: t(`main.memory.kind.${k}`) }))}
              onChange={(kind) => handleUpdateBatch({ kind: kind as MemoryKind })}
            />
            <BulkSelect
              value=""
              placeholder={t("main.memory.filter.scope")}
              options={MEMORY_SCOPES.map((s) => ({ value: s, label: t(`main.memory.scope.${s}`) }))}
              onChange={(scope) => handleUpdateBatch({ scope: scope as MemoryScope })}
            />
            <Button variant="danger" size="sm" onPress={() => setDeleteBatchIds([...selectedIds])}>
              <IconTrash className="size-4" />
              {t("main.memory.bulk.delete")}
            </Button>
          </div>
        </div>
      )}

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <Card.Content className="space-y-4 p-4">
            <Metric label={t("main.metric.memories")} value={memories.length} />
            <Metric label={t("main.metric.pinned", { count: pinnedCount })} value={pinnedCount} />
          </Card.Content>
        </Card>
        <div className="grid gap-3 md:grid-cols-2">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              selected={selectedIds.has(memory.id)}
              onToggleSelect={() => toggleSelection(memory.id)}
              onEdit={() => openEditMemory(memory)}
              onDelete={() => setDeleteTarget(memory)}
            />
          ))}
          {memories.length === 0 && !isLoading && (
            <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
          )}
        </div>
      </div>

      {/* Edit modal */}
      {isEditModalOpen && (
        <MemoryEditModal
          memory={editingMemory}
          onClose={closeEditModal}
          onSave={handleSaveMemory}
          isSaving={isSaving}
        />
      )}

      {/* Delete confirmations */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t("main.memory.delete")}
        message={
          deleteTarget
            ? t("main.memory.deleteConfirm", { title: deleteTarget.title })
            : t("main.memory.deleteConfirm", { title: "" })
        }
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
      />
      <ConfirmDialog
        open={deleteBatchIds.length > 0}
        title={t("main.memory.delete")}
        message={t("main.memory.deleteBatchConfirm", { count: deleteBatchIds.length })}
        danger
        onConfirm={handleDeleteBatch}
        onClose={() => setDeleteBatchIds([])}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );
}

function MemoryCard({
  memory,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  memory: MemoryRecord;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <Card className={cn("transition", selected && "border-ring/50 bg-muted/30")}>
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="mt-1 size-4 shrink-0 rounded border-border"
              aria-label={t("main.memory.selected", { count: 1 })}
            />
            <div className="min-w-0 flex-1">
              <Card.Title className="truncate">{memory.title}</Card.Title>
              <Card.Description>
                <span className="inline-flex flex-wrap gap-1">
                  <Chip size="sm" variant="soft">
                    {t(`main.memory.scope.${memory.scope}`)}
                  </Chip>
                  <Chip size="sm" variant="secondary">
                    {t(`main.memory.kind.${memory.kind}`)}
                  </Chip>
                  {memory.pinned !== 0 && (
                    <Chip size="sm" variant="soft">
                      {t("main.metric.pinned", { count: 1 })}
                    </Chip>
                  )}
                </span>
              </Card.Description>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="tertiary" size="sm" isIconOnly onPress={onEdit}>
              <IconEdit className="size-4" />
            </Button>
            <Button variant="tertiary" size="sm" isIconOnly onPress={onDelete}>
              <IconTrash className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <p className="line-clamp-4 text-sm text-foreground/60">{memory.content}</p>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("main.memory.field.salience")}: {memory.salience}
          </span>
          <span>
            {memory.updated_at === memory.created_at ? "" : t("main.memory.sort.updated")}
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}

function MemoryEditModal({
  memory,
  onClose,
  onSave,
  isSaving,
}: {
  memory: MemoryRecord | null;
  onClose: () => void;
  onSave: (memory: MemoryRecord) => Promise<void>;
  isSaving: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? "global");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "fact");
  const [salience, setSalience] = useState(memory?.salience ?? 70);
  const [pinned, setPinned] = useState((memory?.pinned ?? 0) === 1);

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValid) return;
    const now = Date.now();
    const record: MemoryRecord = {
      id: memory?.id ?? crypto.randomUUID(),
      scope,
      kind,
      title: title.trim().slice(0, 120),
      content: content.trim().slice(0, 4000),
      agent_id: memory?.agent_id ?? null,
      conversation_id: memory?.conversation_id ?? null,
      source_run_id: memory?.source_run_id ?? null,
      salience,
      pinned: pinned ? 1 : 0,
      created_at: memory?.created_at ?? now,
      updated_at: now,
    };
    await onSave(record);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mx-4 w-full max-w-lg overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-foreground/10 px-5 py-3">
          <h3 className="text-sm font-semibold">
            {memory ? t("main.memory.edit") : t("main.memory.new")}
          </h3>
          <button
            type="button"
            className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconX className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 px-5 py-4">
            <div className="grid gap-1.5">
              <Label>{t("main.memory.field.title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("main.memory.field.title")}
                maxLength={120}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("main.memory.field.content")}</Label>
              <TextArea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("main.memory.field.content")}
                rows={5}
                maxLength={4000}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("main.memory.filter.scope")}</Label>
              <ToggleButtonGroup
                selectedKeys={[scope]}
                onSelectionChange={(keys) => {
                  const key = [...keys][0];
                  if (MEMORY_SCOPES.includes(key as MemoryScope)) setScope(key as MemoryScope);
                }}
                size="sm"
                fullWidth
              >
                {MEMORY_SCOPES.map((s) => (
                  <ToggleButton key={s} id={s}>
                    {t(`main.memory.scope.${s}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("main.memory.filter.kind")}</Label>
              <ToggleButtonGroup
                selectedKeys={[kind]}
                onSelectionChange={(keys) => {
                  const key = [...keys][0];
                  if (MEMORY_KINDS.includes(key as MemoryKind)) setKind(key as MemoryKind);
                }}
                size="sm"
                fullWidth
              >
                {MEMORY_KINDS.map((k) => (
                  <ToggleButton key={k} id={k}>
                    {t(`main.memory.kind.${k}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </div>
            <div className="grid gap-1.5">
              <Label>
                {t("main.memory.field.salience")}: {salience}
              </Label>
              <Slider
                value={[salience]}
                onValueChange={(values) => setSalience(values[0] ?? 70)}
                min={1}
                max={100}
                step={1}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch isSelected={pinned} onChange={setPinned}>
                {t("main.memory.field.pinned")}
              </Switch>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-foreground/10 px-5 py-3">
            <Button variant="tertiary" size="sm" onPress={onClose} isDisabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isPending={isSaving}
              isDisabled={!isValid}
            >
              {t("main.memory.save")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function BulkSelect({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <select
      className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
      value={value}
      onChange={(e) => {
        if (e.target.value) {
          onChange(e.target.value);
          e.target.value = "";
        }
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Label({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="text-sm font-medium">{children}</span>;
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs text-foreground/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }): React.JSX.Element {
  return (
    <Card>
      <Card.Content className="flex min-h-48 flex-col items-center justify-center gap-3 text-foreground/45">
        <span className="text-2xl">{icon}</span>
        <p className="text-sm">{title}</p>
      </Card.Content>
    </Card>
  );
}
