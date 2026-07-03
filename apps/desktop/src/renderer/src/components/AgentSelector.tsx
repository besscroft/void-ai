import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "../lib/api";
import { SettingKey, DEFAULT_AGENT_ID, type AgentProfile } from "@shared/types";
import { IconCheck, IconChevronDown, IconCpu } from "./icons";

interface AgentSelectorProps {
  value: string | null;
  onChange: (agentId: string) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps): React.JSX.Element {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.agents.list().then((items) => {
      setAgents(items);
      if (!value && items.length > 0) onChange(items[0].id);
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

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onPress={() => setOpen((next) => !next)}>
        <span className="flex size-5 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
          {selected?.avatar ?? "V"}
        </span>
        <span className="max-w-[140px] truncate">{selected?.name ?? "Void"}</span>
        <IconChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-md border border-foreground/15 bg-background shadow-xl">
          <div className="border-b border-foreground/10 px-3 py-2 text-xs font-medium text-foreground/50">
            Agents
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {agents.map((agent) => {
              const active = agent.id === selected?.id;
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
                        {agent.status}
                      </Chip>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-foreground/55">
                      {agent.role}
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
