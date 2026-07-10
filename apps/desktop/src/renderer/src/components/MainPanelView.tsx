import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, Card, Chip } from "./ui";
import { api, type AgentProfile, type MemoryRecord, type RuntimeEvent } from "../lib/api";
import { useT } from "../lib/i18n";
import { AgentsPanel } from "./AgentsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { IconDatabase, IconRotateCcw } from "./icons";
import { cn } from "../lib/utils";

export type MainSection = "agents" | "tools" | "memory";

interface MainPanelViewProps {
  section: MainSection;
}

interface PanelData {
  agents: AgentProfile[];
  memories: MemoryRecord[];
  runtimeEvents: RuntimeEvent[];
}

export function MainPanelView({ section }: MainPanelViewProps): React.JSX.Element {
  const { t } = useT();
  const [data, setData] = useState<PanelData>({
    agents: [],
    memories: [],
    runtimeEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    void Promise.all([api.agents.list(), api.memories.list(), api.runtime.events.list()])
      .then(([agents, memories, runtimeEvents]) => {
        setData({ agents, memories, runtimeEvents });
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
        {section === "memory" && <MemoryPanel memories={data.memories} />}
      </div>
    </main>
  );
}

function MemoryPanel({ memories }: { memories: MemoryRecord[] }): React.JSX.Element {
  const { t } = useT();
  const pinned = memories.filter((memory) => memory.pinned);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <Card.Content className="space-y-4 p-4">
          <Metric label={t("main.metric.memories")} value={memories.length} />
          <Metric label={t("main.metric.pinned", { count: pinned.length })} value={pinned.length} />
        </Card.Content>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {memories.map((memory) => (
          <Card key={memory.id}>
            <Card.Header>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Card.Title>{memory.title}</Card.Title>
                  <Card.Description>
                    {memory.scope} / {memory.kind}
                  </Card.Description>
                </div>
                {memory.pinned !== 0 && (
                  <Chip size="sm" variant="soft">
                    {t("main.metric.pinned", { count: 1 })}
                  </Chip>
                )}
              </div>
            </Card.Header>
            <Card.Content>
              <p className="line-clamp-4 text-sm text-foreground/60">{memory.content}</p>
            </Card.Content>
          </Card>
        ))}
        {memories.length === 0 && (
          <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
        )}
      </div>
    </div>
  );
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
