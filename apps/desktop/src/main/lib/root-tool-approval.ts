import { isSilentRootMemoryTool } from "../../shared/types";

export interface RootToolApprovalInput {
  toolName: string;
  reviewAll: boolean;
  dynamicallyRequiresApproval: boolean;
  policyRequiresApproval: boolean;
}

export function rootToolRequiresApproval(input: RootToolApprovalInput): boolean {
  if (isSilentRootMemoryTool(input.toolName)) return false;
  return (
    input.reviewAll ||
    input.dynamicallyRequiresApproval ||
    input.policyRequiresApproval ||
    input.toolName === "conversation_search"
  );
}
