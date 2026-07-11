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
  type AgentProfile,
  type MemoryKind,
  type MemoryPendingSuggestion,
  type MemoryRecord,
  type MemoryScope,
  type RuntimeEvent,
} from "../lib/api";
import { useT } from "../lib/i18n";
import { AgentsPanel } from "./AgentsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClock,
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
  const { t } = useT();
  const [data, setData] = useState<PanelData>({
    agents: [],
    runtimeEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    void Promise.all([api.agents.list(), api.runtime.events.list()])
      .then(([agents, runtimeEvents]) => {
        setData({ agents, runtimeEvents });
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

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
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t(`main.title.${section}`)}</h1>
            <p className="mt-1 text-sm text-foreground/50">{t(`main.subtitle.${section}`)}</p>
          </div>
          <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
            <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
            {t("main.refresh")}
          </Button>
        </div>

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

function MemoryPanel(): React.JSX.Element {
  const { t, f } = useT();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [pending, setPending] = useState<MemoryPendingSuggestion[]>([]);
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
      const [results, pendingList] = await Promise.all([
        api.memories.search({
          query: debouncedQuery,
          scope: filters.scope === "all" ? null : filters.scope,
          kind: filters.kind === "all" ? null : filters.kind,
          pinned: filters.pinned,
          sortBy,
          sortOrder,
          limit: 200,
        }),
        api.memories.pending.list(),
      ]);
      setMemories(results);
      setPending(pendingList);
      setSelectedIds((prev) => {
        const ids = new Set(results.map((m) => m.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    } finally {
      setIsLoading(false);
    }
  }, [debouncedQuery, filters, sortBy, sortOrder]);

  useEffect(() => {
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

  const handleConfirmPending = async (id: string): Promise<void> => {
    await api.memories.pending.confirm(id);
    await load();
  };

  const handleRejectPending = async (id: string): Promise<void> => {
    await api.memories.pending.reject(id);
    await load();
  };

  const handleConfirmAllPending = async (): Promise<void> => {
    await api.memories.pending.confirmAll();
    await load();
  };

  const handleRejectAllPending = async (): Promise<void> => {
    await api.memories.pending.rejectAll();
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
            <Metric label={t("main.memory.pending.title")} value={pending.length} />
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

      {/* Pending section */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {t("main.memory.pending.title")} ({pending.length})
            </h3>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onPress={handleConfirmAllPending}>
                <IconCheck className="size-4" />
                {t("main.memory.pending.confirmAll")}
              </Button>
              <Button variant="tertiary" size="sm" onPress={handleRejectAllPending}>
                <IconX className="size-4" />
                {t("main.memory.pending.rejectAll")}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    <Chip size="sm" variant="soft">
                      {t(`main.memory.kind.${item.kind}`)}
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      {t(`main.memory.scope.${item.scope}`)}
                    </Chip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/60">{item.content}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <IconClock className="size-3" />
                    {f.dateTime(item.suggestedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => handleConfirmPending(item.id)}
                  >
                    <IconCheck className="size-4" />
                    {t("main.memory.pending.confirm")}
                  </Button>
                  <Button variant="tertiary" size="sm" onPress={() => handleRejectPending(item.id)}>
                    <IconX className="size-4" />
                    {t("main.memory.pending.reject")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
