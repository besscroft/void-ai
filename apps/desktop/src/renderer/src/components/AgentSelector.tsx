import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "./ui";
import { api } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { SettingKey, DEFAULT_AGENT_ID, type AgentProfile } from "@shared/types";
import { IconCheck, IconChevronDown, IconCpu } from "./icons";

interface AgentSelectorProps {
  value: string | null;
  onChange: (agentId: string) => void;
  placement?: "top" | "bottom";
}

const AGENT_STATUS_KEYS: Record<string, TranslationKey> = {
  active: "status.agent.active",
  archived: "status.agent.archived",
  draft: "status.agent.draft",
};

export function AgentSelector({
  value,
  onChange,
  placement = "bottom",
}: AgentSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.agents.list().then((items) => {
      const visible = items.filter(
        (agent) => agent.status !== "archived" || agent.id === DEFAULT_AGENT_ID,
      );
      setAgents(visible);
      if (!value && visible.length > 0) onChange(visible[0].id);
      if (value && !visible.some((agent) => agent.id === value) && visible.length > 0) {
        onChange(visible[0].id);
      }
    });
  }, [onChange, value]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected =
    agents.find((agent) => agent.id === value) ??
    agents.find((agent) => agent.id === DEFAULT_AGENT_ID);

  const selectAgent = (agent: AgentProfile): void => {
    onChange(agent.id);
    void api.settings.set(SettingKey.ActiveAgentId, agent.id);
    setOpen(false);
  };

  const menuPlacement = placement === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0";

  return (
    <div ref={ref} className="relative min-w-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 min-w-0 gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.035] px-2 text-[13px] shadow-sm hover:bg-foreground/[0.06]"
        onPress={() => setOpen((next) => !next)}
        aria-label={t("agent.selector.label")}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
          {selected?.avatar ?? "V"}
        </span>
        <span className="max-w-[104px] truncate">{selected?.name ?? "Void"}</span>
        <IconChevronDown className={`size-3 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </Button>

      {open && (
        <div
          className={`absolute z-50 w-80 overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl ${menuPlacement}`}
        >
          <div className="border-b border-foreground/10 px-3 py-2 text-xs font-medium text-foreground/50">
            {t("agent.selector.title")}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {agents.map((agent) => {
              const active = agent.id === selected?.id;
              const statusKey = AGENT_STATUS_KEYS[agent.status];
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={[
                    "flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition",
                    active ? "bg-accent/10 text-accent" : "hover:bg-foreground/5",
                  ].join(" ")}
                  onClick={() => selectAgent(agent)}
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                    {agent.avatar}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{agent.name}</span>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={agent.status === "active" ? "success" : "default"}
                      >
                        {statusKey ? t(statusKey) : agent.status}
                      </Chip>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-foreground/55">
                      {agent.kind === "child" ? `${agent.role} · routed by Void` : agent.role}
                    </span>
                  </span>
                  {active ? (
                    <IconCheck className="mt-2 size-4 shrink-0" />
                  ) : (
                    <IconCpu className="mt-2 size-4 shrink-0 opacity-35" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
