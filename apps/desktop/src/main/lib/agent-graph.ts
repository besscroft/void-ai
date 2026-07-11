import { DEFAULT_AGENT_ID, type AgentProfile } from "../../shared/types";
import { getAgent, listAgents } from "./db";
import { isRoutableAgent } from "./agent-routing";

export interface AgentGraph {
  rootAgent: AgentProfile;
  enabledChildren: AgentProfile[];
  enabledAgents: AgentProfile[];
  childrenOf(agentId: string): AgentProfile[];
}

export function loadAgentGraph(rootAgentId = DEFAULT_AGENT_ID): AgentGraph {
  const rootAgent = getAgent(rootAgentId);
  if (!rootAgent) throw new Error("Root agent profile is missing.");
  const enabledAgents = listAgents().filter(isRoutableAgent);
  const childrenOf = (agentId: string): AgentProfile[] =>
    enabledAgents.filter((agent) => (agent.parent_agent_id ?? rootAgentId) === agentId);
  return { rootAgent, enabledChildren: childrenOf(rootAgentId), enabledAgents, childrenOf };
}
