import type { AgentProfile } from "../../shared/types";

export function isRoutableAgent(
  agent: Pick<AgentProfile, "kind" | "status" | "locked" | "enabled">,
): boolean {
  return (
    agent.kind === "child" && agent.status === "active" && agent.locked === 0 && agent.enabled !== 0
  );
}
