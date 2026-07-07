import { DEFAULT_AGENT_ID, type AgentProfile } from "../../shared/types";
import { getAgent, listAgents } from "./db";
import { isRoutableAgent } from "./agent-routing";

export interface AgentGraph {
  rootAgent: AgentProfile;
  enabledChildren: AgentProfile[];
}

export function loadAgentGraph(rootAgentId = DEFAULT_AGENT_ID): AgentGraph {
  const rootAgent = getAgent(rootAgentId);
  if (!rootAgent) throw new Error("Root agent profile is missing.");
  const enabledChildren = listAgents().filter(isRoutableAgent);
  return { rootAgent, enabledChildren };
}
