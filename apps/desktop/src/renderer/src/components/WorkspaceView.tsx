import { useEffect, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { api, type WorkspaceSnapshot } from "../lib/api";
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

const sectionTitle: Record<WorkspaceSection, string> = {
  dashboard: "Void OS",
  agents: "Agents",
  workflows: "Workflows",
  memory: "Memory",
  harness: "Harness",
  server: "Server",
  interactions: "Interactions",
  sync: "Sync",
};

const sectionSubtitle: Record<WorkspaceSection, string> = {
  dashboard: "Local-first AI desktop architecture",
  agents: "Persistent personalities, roles, voices and soul prompts",
  workflows: "Composable runs for repeated agentic work",
  memory: "Pinned facts, preferences, episodes and identity context",
  harness: "Tool calls, tests, approvals and automation audit trail",
  server: "Loopback runtime and optional remote services",
  interactions: "Chat, voice, video, mouse intent and desktop companion surfaces",
  sync: "Device identity, encryption and conflict strategy",
};

export function WorkspaceView({ section }: WorkspaceViewProps): React.JSX.Element {
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
            {sectionTitle[section]}
          </h1>
          <p className="mt-1 text-sm text-foreground/55">{sectionSubtitle[section]}</p>
        </div>
        <Button variant="secondary" size="sm" onPress={refresh} isPending={loading}>
          <IconRotateCcw className="size-3.5" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-5">
        {!snapshot ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground/45">
            Loading workspace...
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
  const activeAgents = snapshot.agents.filter((agent) => agent.status === "active").length;
  const enabledWorkflows = snapshot.workflows.filter(
    (workflow) => workflow.status === "enabled",
  ).length;
  const enabledInteractions = snapshot.interactionProfiles.filter((item) => item.enabled).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconCpu />}
          label="Active agents"
          value={activeAgents}
          detail={`${snapshot.agents.length} total`}
        />
        <MetricCard
          icon={<IconSliders />}
          label="Workflows"
          value={enabledWorkflows}
          detail={`${snapshot.workflowRuns.length} runs`}
        />
        <MetricCard
          icon={<IconDatabase />}
          label="Memories"
          value={snapshot.memories.length}
          detail={`${snapshot.memories.filter((m) => m.pinned).length} pinned`}
        />
        <MetricCard
          icon={<IconLayout />}
          label="Inputs"
          value={enabledInteractions}
          detail={`${snapshot.interactionProfiles.length} surfaces`}
        />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <SectionHeading title="Architecture Layers" />
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Client", "Electron shell, responsive React renderer, Web-ready component model"],
              ["Runtime", "Loopback Hono server, AI SDK streaming, provider isolation"],
              ["State", "SQLite WAL, Drizzle schema, encrypted API keys, cache budget"],
              [
                "Cloud",
                "Optional sync server with encrypted device merge and reviewable conflicts",
              ],
            ].map(([title, detail]) => (
              <Card key={title} className="min-h-32">
                <Card.Header>
                  <Card.Title>{title}</Card.Title>
                  <Card.Description>{detail}</Card.Description>
                </Card.Header>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <SectionHeading title="Recent Harness" />
          <Timeline items={snapshot.harnessEvents.slice(0, 5)} />
        </div>
      </section>
    </div>
  );
}

function AgentsPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {snapshot.agents.map((agent) => (
        <Card key={agent.id}>
          <Card.Header>
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                {agent.avatar}
              </span>
              <Chip
                size="sm"
                color={agent.status === "active" ? "success" : "default"}
                variant="soft"
              >
                {agent.status}
              </Chip>
            </div>
            <Card.Title>{agent.name}</Card.Title>
            <Card.Description>{agent.role}</Card.Description>
          </Card.Header>
          <Card.Content>
            <p className="text-sm text-foreground/70">{agent.description}</p>
            <div className="mt-4 grid gap-2 text-xs text-foreground/55">
              <InfoRow label="Personality" value={agent.personality} />
              <InfoRow label="Soul" value={agent.soul_prompt} />
              <InfoRow label="Voice" value={agent.voice ?? "not set"} />
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function WorkflowsPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-2">
        {snapshot.workflows.map((workflow) => {
          const steps = parseJson<WorkflowStep[]>(workflow.steps_json, []);
          return (
            <Card key={workflow.id}>
              <Card.Header>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Chip
                    size="sm"
                    color={workflow.status === "enabled" ? "success" : "default"}
                    variant="soft"
                  >
                    {workflow.status}
                  </Chip>
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
                        {index + 1}
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

      <SectionHeading title="Runs" />
      <div className="grid gap-2">
        {snapshot.workflowRuns.map((run) => (
          <div
            key={run.id}
            className="grid gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto]"
          >
            <span className="font-medium">{run.workflow_id}</span>
            <StatusChip status={run.status} />
            <span className="text-xs text-foreground/45">{formatTime(run.started_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {snapshot.memories.map((memory) => (
        <Card key={memory.id}>
          <Card.Header>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Chip size="sm" color={memory.pinned ? "accent" : "default"} variant="soft">
                {memory.scope} · {memory.kind}
              </Chip>
              <span className="text-xs text-foreground/45">{memory.salience}</span>
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
  return <Timeline items={snapshot.harnessEvents} />;
}

function ServerPanel({ snapshot }: { snapshot: WorkspaceSnapshot }): React.JSX.Element {
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
                  {node.kind} · {node.status}
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
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {snapshot.interactionProfiles.map((profile) => {
        const config = parseJson<Record<string, string>>(profile.config_json, {});
        return (
          <Card key={profile.id}>
            <Card.Header>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Chip size="sm" color={profile.enabled ? "success" : "default"} variant="soft">
                  {profile.enabled ? "enabled" : "off"}
                </Chip>
                <Chip size="sm" variant="tertiary">
                  {profile.status}
                </Chip>
              </div>
              <Card.Title>{profile.label}</Card.Title>
              <Card.Description>{profile.kind}</Card.Description>
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
  const sync = snapshot.syncState;
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <Card.Header>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Chip size="sm" color="accent" variant="soft">
              {sync.mode}
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
          <Card.Title>Device Sync</Card.Title>
          <Card.Description>{sync.endpoint ?? "Local vault only"}</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="grid gap-2 text-xs text-foreground/60">
            <InfoRow label="Device" value={sync.device_id} />
            <InfoRow label="Encryption" value={sync.encryption_enabled ? "enabled" : "disabled"} />
            <InfoRow label="Conflicts" value={sync.conflict_strategy} />
            <InfoRow
              label="Last sync"
              value={sync.last_synced_at ? formatTime(sync.last_synced_at) : "never"}
            />
          </div>
        </Card.Content>
      </Card>

      <div className="space-y-3">
        <SectionHeading title="Sync Plan" />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Local vault", "SQLite remains the source of truth for desktop-only use"],
            ["Outbox", "Changes become encrypted operations before leaving device"],
            ["Merge", "Conflicts are reviewable when memory or persona diverges"],
          ].map(([title, detail]) => (
            <Card key={title}>
              <Card.Header>
                <Card.Title>{title}</Card.Title>
                <Card.Description>{detail}</Card.Description>
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
  icon: React.ReactNode;
  label: string;
  value: number;
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
            <span className="text-xs text-foreground/40">{formatTime(event.created_at)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title }: { title: string }): React.JSX.Element {
  return <h2 className="text-sm font-semibold text-foreground/70">{title}</h2>;
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
  const color =
    status === "succeeded"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "running"
          ? "accent"
          : "default";
  return (
    <Chip size="sm" color={color} variant="soft">
      {status}
    </Chip>
  );
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
