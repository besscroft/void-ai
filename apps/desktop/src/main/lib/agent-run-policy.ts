import { isLoopFinished } from "ai";
import type { StopCondition, ToolSet } from "ai";

/**
 * Root chat runs are user-controlled: a model may finish naturally, while an
 * explicit abort from the chat UI stops the request. Tool-loop step counts do
 * not terminate the root agent.
 */
export const ROOT_AGENT_STOP_WHEN: StopCondition<ToolSet> = isLoopFinished();
