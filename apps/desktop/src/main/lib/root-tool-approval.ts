import { isSilentRootMemoryTool } from "../../shared/types";

export interface RootToolApprovalInput {
  toolName: string;
  toolInput?: unknown;
  reviewAll: boolean;
  dynamicallyRequiresApproval: boolean;
  policyRequiresApproval: boolean;
}

export function builtinChatToolRequiresApproval(toolName: string, input?: unknown): boolean {
  if (toolName === "conversation_search") return true;
  if (toolName !== "cron") return false;
  const action = readStringProperty(input, "action");
  return action !== "list" && action !== "get";
}

export function rootToolRequiresApproval(input: RootToolApprovalInput): boolean {
  if (isSilentRootMemoryTool(input.toolName)) return false;
  return (
    input.reviewAll ||
    input.dynamicallyRequiresApproval ||
    input.policyRequiresApproval ||
    builtinChatToolRequiresApproval(input.toolName, input.toolInput)
  );
}

function readStringProperty(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
