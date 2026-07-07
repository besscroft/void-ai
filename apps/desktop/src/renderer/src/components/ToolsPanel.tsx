import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, Input, Switch } from "@heroui/react";
import { api, type ToolsSnapshot } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { filterToolRecords, type ToolKindFilter, type ToolStatusFilter } from "../lib/tools-filter";
import type { ToolRecord, ToolServer } from "@shared/types";
import { IconRotateCcw, IconSearch, IconWrench } from "./icons";

export function ToolsPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ToolKindFilter>("all");
  const [status, setStatus] = useState<ToolStatusFilter>("all");

  const refresh = (): void => {
    setLoading(true);
    void api.tools
      .snapshot()
      .then(setSnapshot)
      .catch((error) => notify.error(t("tools.toast.failed"), error, locale))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const rows = useMemo(() => {
    return filterToolRecords(snapshot?.toolRecords ?? [], { query, kind, status });
  }, [kind, query, snapshot, status]);

  const mcpServers = snapshot?.toolServers.filter((server) => server.kind === "mcp") ?? [];
  const recentEvents = snapshot?.runtimeEvents.slice(0, 6) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("main.title.tools")}</h2>
          <p className="mt-1 text-sm text-foreground/50">{t("main.subtitle.tools")}</p>
        </div>
        <Button variant="secondary" size="sm" onPress={refresh} isPending={loading}>
          <IconRotateCcw className="size-4" />
          {t("main.refresh")}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label={t("tools.metric.tools")} value={snapshot?.toolRecords.length ?? 0} />
        <MetricCard label={t("tools.metric.mcp")} value={mcpServers.length} />
        <MetricCard label={t("tools.metric.skills")} value={snapshot?.skills.length ?? 0} />
        <MetricCard label={t("tools.metric.secrets")} value={snapshot?.secrets.length ?? 0} />
      </div>

      <Card>
        <Card.Content className="space-y-4 p-4">
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

          {loading && !snapshot ? (
            <p className="py-12 text-center text-sm text-foreground/45">{t("main.loading")}</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-foreground/45">{t("tools.empty")}</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-foreground/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-foreground/[0.03] text-xs text-foreground/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("tools.table.name")}</th>
                    <th className="px-4 py-3 font-medium">{t("tools.field.category")}</th>
                    <th className="px-4 py-3 font-medium">{t("tools.table.status")}</th>
                    <th className="px-4 py-3 font-medium">{t("tools.approval")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {rows.map((tool) => (
                    <ToolRow key={tool.id} tool={tool} servers={snapshot?.toolServers ?? []} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t("settings.diagnostics.title")}</Card.Title>
          <Card.Description>{t("settings.diagnostics.subtitle")}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-2">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-foreground/45">{t("tools.audit.empty")}</p>
          ) : (
            recentEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 px-3 py-2 text-sm"
              >
                <span className="truncate">{event.title}</span>
                <Chip
                  size="sm"
                  variant="soft"
                  color={event.status === "failed" ? "danger" : "default"}
                >
                  {event.kind}
                </Chip>
              </div>
            ))
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function ToolRow({
  tool,
  servers,
}: {
  tool: ToolRecord;
  servers: ToolServer[];
}): React.JSX.Element {
  const server = tool.server_id ? servers.find((item) => item.id === tool.server_id) : null;
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5">
            <IconWrench className="size-4 text-foreground/60" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{tool.title ?? tool.name}</p>
            <p className="truncate text-xs text-foreground/45">{server?.name ?? tool.reference}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Chip size="sm" variant="soft">
          {tool.kind}
        </Chip>
      </td>
      <td className="px-4 py-3">
        <Switch isSelected={tool.enabled !== 0} isDisabled aria-label={tool.name} />
      </td>
      <td className="px-4 py-3">
        <Chip size="sm" variant={tool.requires_approval ? "soft" : "tertiary"}>
          {tool.requires_approval ? "approval" : "auto"}
        </Chip>
      </td>
    </tr>
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
