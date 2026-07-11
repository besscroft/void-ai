import { DEFAULT_AGENT_ID, type AgentProfile } from "@shared/types";

export type AgentListTab = "active" | "draft";

export function getVisibleAgents(
  agents: AgentProfile[],
  tab: AgentListTab,
  query: string,
): AgentProfile[] {
  const normalizedQuery = query.trim().toLowerCase();
  return agents
    .filter((agent) => {
      if (agent.status === "archived") return false;
      if (tab === "draft" && agent.status !== "draft") return false;
      if (tab === "active" && agent.status === "draft") return false;
      if (!normalizedQuery) return true;
      return [agent.name, agent.role, agent.description, agent.model_ref ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((a, b) => {
      if (a.id === DEFAULT_AGENT_ID) return -1;
      if (b.id === DEFAULT_AGENT_ID) return 1;
      return b.updated_at - a.updated_at;
    });
}
