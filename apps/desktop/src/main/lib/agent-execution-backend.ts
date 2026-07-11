import type { AgentBackendCapabilities, AgentRuntimeProtocolEvent } from "../../shared/types";

export interface AgentExecutionRequest {
  runId: string;
  agentId: string;
  agentPath: string;
  parentAgentPath: string | null;
  prompt: string;
  abortSignal?: AbortSignal;
}

export interface AgentExecutionResult {
  text: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AgentExecutionBackend {
  readonly id: string;
  readonly capabilities: AgentBackendCapabilities;
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
  subscribe?(listener: (event: AgentRuntimeProtocolEvent) => void): () => void;
}

export class AiSdkExecutionBackend implements AgentExecutionBackend {
  readonly id = "ai-sdk";
  readonly capabilities = AI_SDK_BACKEND_CAPABILITIES;

  constructor(
    private readonly executor: (request: AgentExecutionRequest) => Promise<AgentExecutionResult>,
  ) {}

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    return await this.executor(request);
  }
}

export const AI_SDK_BACKEND_CAPABILITIES: AgentBackendCapabilities = {
  provider: "ai-sdk",
  hostedCollaboration: false,
  perAgentToolPolicies: true,
  httpOutputItemReplay: false,
  batchPendingFunctionCalls: false,
  websocketInjection: false,
  injectionAcknowledgements: false,
  responseCompletedContinuation: false,
};

export const OPENAI_RESPONSES_MULTI_AGENT_CAPABILITIES: AgentBackendCapabilities = {
  provider: "openai-responses-multi-agent",
  hostedCollaboration: true,
  perAgentToolPolicies: false,
  httpOutputItemReplay: true,
  batchPendingFunctionCalls: true,
  websocketInjection: true,
  injectionAcknowledgements: true,
  responseCompletedContinuation: true,
};

export function canUseHostedMultiAgent(input: {
  capabilities: AgentBackendCapabilities;
  toolPolicySignatures: string[];
}): boolean {
  if (!input.capabilities.hostedCollaboration) return false;
  if (input.capabilities.perAgentToolPolicies) return true;
  return new Set(input.toolPolicySignatures).size <= 1;
}
