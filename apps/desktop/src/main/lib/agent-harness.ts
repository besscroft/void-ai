import type { AgentRuntimeProtocolEvent } from "../../shared/types";

export interface HarnessResumeState {
  sessionId: string;
  adapterId: string;
  payload: Record<string, unknown>;
}

export interface HarnessSession {
  readonly id: string;
  run(
    prompt: string,
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<AgentRuntimeProtocolEvent>;
  detach(): Promise<HarnessResumeState>;
  stop(): Promise<HarnessResumeState>;
  destroy(): Promise<void>;
}

export interface HarnessAdapter {
  readonly id: string;
  createSession(input: {
    runId: string;
    workspaceRoot: string;
    instructions?: string;
  }): Promise<HarnessSession>;
  resumeSession(state: HarnessResumeState): Promise<HarnessSession>;
}
