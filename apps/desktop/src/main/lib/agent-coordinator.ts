import { randomUUID } from "node:crypto";
import type {
  AgentCollaborationAction,
  AgentCollaborationMessage,
  AgentInstanceRecord,
  AgentRuntimeProtocolEvent,
} from "../../shared/types";

export interface AgentTurnInput {
  instance: AgentInstanceRecord;
  message: string;
  mailbox: AgentCollaborationMessage[];
  abortSignal: AbortSignal;
}

export type AgentTurnExecutor = (input: AgentTurnInput) => Promise<string>;

interface ManagedInstance {
  record: AgentInstanceRecord;
  execute: AgentTurnExecutor;
  controller: AbortController;
  mailbox: AgentCollaborationMessage[];
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

export interface SpawnAgentInput {
  agentId: string;
  parentPath: string;
  taskName: string;
  message: string;
  execute: AgentTurnExecutor;
}

export class AgentCoordinator {
  readonly runId: string;
  readonly rootPath = "/root";
  private readonly maxConcurrentSubagents: number;
  private readonly instances = new Map<string, ManagedInstance>();
  private readonly messages: AgentCollaborationMessage[] = [];
  private readonly queue: string[] = [];
  private activeCount = 0;
  private sequence = 0;
  private ownerPath = this.rootPath;

  constructor(input: {
    runId: string;
    maxConcurrentSubagents?: number;
    onEvent?: (event: AgentRuntimeProtocolEvent) => void;
  }) {
    this.runId = input.runId;
    this.maxConcurrentSubagents = Math.max(1, Math.floor(input.maxConcurrentSubagents ?? 3));
    this.onEvent = input.onEvent;
  }

  private readonly onEvent?: (event: AgentRuntimeProtocolEvent) => void;

  spawnAgent(input: SpawnAgentInput): AgentInstanceRecord {
    this.emitCollaboration("spawn_agent", input.parentPath, { taskName: input.taskName });
    const path = this.createPath(input.parentPath, input.taskName);
    const now = Date.now();
    let resolve!: (value: string) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const parent = this.instances.get(input.parentPath);
    const record: AgentInstanceRecord = {
      id: randomUUID(),
      run_id: this.runId,
      agent_id: input.agentId,
      agent_path: path,
      parent_instance_id: parent?.record.id ?? null,
      parent_agent_path: input.parentPath,
      status: "queued",
      task_name: input.taskName,
      task_summary: input.message,
      turn_count: 0,
      last_message: input.message,
      error: null,
      started_at: null,
      finished_at: null,
      created_at: now,
      updated_at: now,
    };
    const taskMessage = this.createMessage(input.parentPath, path, "task", input.message);
    this.instances.set(path, {
      record,
      execute: input.execute,
      controller: new AbortController(),
      mailbox: [taskMessage],
      promise,
      resolve,
      reject,
    });
    this.queue.push(path);
    this.emit("agent.lifecycle", path, input.parentPath, "start", { status: "queued" });
    this.drainQueue();
    return { ...record };
  }

  sendMessage(
    authorPath: string,
    recipientPath: string,
    content: string,
  ): AgentCollaborationMessage {
    this.emitCollaboration("send_message", authorPath, { recipientPath });
    const target = this.requireInstance(recipientPath);
    const message = this.createMessage(authorPath, recipientPath, "message", content);
    target.mailbox.push(message);
    target.record.last_message = content;
    target.record.updated_at = Date.now();
    this.emit("agent.message", recipientPath, target.record.parent_agent_path, "progress", {
      authorPath,
      content,
    });
    return message;
  }

  async followupTask(path: string, content: string): Promise<string> {
    this.emitCollaboration("followup_task", this.rootPath, { path });
    const instance = this.requireInstance(path);
    if (instance.record.status === "running" || instance.record.status === "queued") {
      this.sendMessage(this.rootPath, path, content);
      return await instance.promise;
    }
    instance.controller = new AbortController();
    instance.record.status = "queued";
    instance.record.finished_at = null;
    instance.record.error = null;
    instance.record.last_message = content;
    instance.record.updated_at = Date.now();
    instance.promise = new Promise<string>((resolve, reject) => {
      instance.resolve = resolve;
      instance.reject = reject;
    });
    instance.mailbox.push(this.createMessage(this.rootPath, path, "task", content));
    this.queue.push(path);
    this.drainQueue();
    return await instance.promise;
  }

  async waitAgent(path: string): Promise<string> {
    this.emitCollaboration("wait_agent", this.rootPath, { path });
    return await this.requireInstance(path).promise;
  }

  interruptAgent(path: string): AgentInstanceRecord {
    this.emitCollaboration("interrupt_agent", this.rootPath, { path });
    const instance = this.requireInstance(path);
    instance.controller.abort();
    instance.record.status = "interrupted";
    instance.record.finished_at = Date.now();
    instance.record.updated_at = Date.now();
    instance.reject(new DOMException("Agent interrupted", "AbortError"));
    this.emit("agent.lifecycle", path, instance.record.parent_agent_path, "end", {
      status: "interrupted",
    });
    return { ...instance.record };
  }

  listAgents(): AgentInstanceRecord[] {
    this.emitCollaboration("list_agents", this.rootPath, {});
    return [...this.instances.values()].map((item) => ({ ...item.record }));
  }

  listMessages(): AgentCollaborationMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  transferOwnership(path: string): void {
    const instance = this.requireInstance(path);
    const previousOwnerPath = this.ownerPath;
    this.ownerPath = path;
    this.emit("ownership.changed", path, instance.record.parent_agent_path, "progress", {
      previousOwnerPath,
      ownerPath: path,
    });
  }

  currentOwnerPath(): string {
    return this.ownerPath;
  }

  interruptAll(): void {
    for (const instance of this.instances.values()) {
      if (instance.record.status === "running" || instance.record.status === "queued") {
        instance.controller.abort();
        instance.record.status = "interrupted";
        instance.record.finished_at = Date.now();
        instance.record.updated_at = Date.now();
        instance.reject(new DOMException("Run cancelled", "AbortError"));
      }
    }
    this.queue.length = 0;
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrentSubagents && this.queue.length > 0) {
      const path = this.queue.shift();
      if (!path) return;
      const instance = this.instances.get(path);
      if (!instance || instance.record.status !== "queued") continue;
      this.activeCount += 1;
      void this.runInstance(instance).finally(() => {
        this.activeCount -= 1;
        this.drainQueue();
      });
    }
  }

  private async runInstance(instance: ManagedInstance): Promise<void> {
    const now = Date.now();
    instance.record.status = "running";
    instance.record.started_at ??= now;
    instance.record.turn_count += 1;
    instance.record.updated_at = now;
    this.emit(
      "agent.lifecycle",
      instance.record.agent_path,
      instance.record.parent_agent_path,
      "progress",
      { status: "running", turn: instance.record.turn_count },
    );
    try {
      const message = instance.record.last_message ?? instance.record.task_summary;
      const output = await instance.execute({
        instance: { ...instance.record },
        message,
        mailbox: instance.mailbox.map((item) => ({ ...item })),
        abortSignal: instance.controller.signal,
      });
      instance.record.status = "completed";
      instance.record.last_message = output;
      instance.record.finished_at = Date.now();
      instance.record.updated_at = Date.now();
      const finalMessage = this.createMessage(
        instance.record.agent_path,
        instance.record.parent_agent_path ?? this.rootPath,
        "final_answer",
        output,
      );
      finalMessage.delivered_at = Date.now();
      instance.resolve(output);
      this.emit(
        "agent.lifecycle",
        instance.record.agent_path,
        instance.record.parent_agent_path,
        "end",
        { status: "completed" },
      );
    } catch (error) {
      if (instance.controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      instance.record.status = "failed";
      instance.record.error = message;
      instance.record.finished_at = Date.now();
      instance.record.updated_at = Date.now();
      instance.reject(error);
      this.emit(
        "agent.lifecycle",
        instance.record.agent_path,
        instance.record.parent_agent_path,
        "error",
        { status: "failed", error: message },
      );
    }
  }

  private createPath(parentPath: string, taskName: string): string {
    const slug =
      taskName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) || "agent";
    let candidate = `${parentPath}/${slug}`;
    let suffix = 2;
    while (this.instances.has(candidate)) candidate = `${parentPath}/${slug}-${suffix++}`;
    return candidate;
  }

  private requireInstance(path: string): ManagedInstance {
    const instance = this.instances.get(path);
    if (!instance) throw new Error(`Agent instance '${path}' not found.`);
    return instance;
  }

  private createMessage(
    authorPath: string,
    recipientPath: string,
    kind: AgentCollaborationMessage["kind"],
    content: string,
  ): AgentCollaborationMessage {
    const message: AgentCollaborationMessage = {
      id: randomUUID(),
      run_id: this.runId,
      author_path: authorPath,
      recipient_path: recipientPath,
      kind,
      content,
      created_at: Date.now(),
      delivered_at: null,
    };
    this.messages.push(message);
    return message;
  }

  private emitCollaboration(
    action: AgentCollaborationAction,
    agentPath: string,
    payload: Record<string, unknown>,
  ): void {
    this.emit("collaboration.call", agentPath, null, "progress", { action, ...payload });
  }

  private emit(
    type: AgentRuntimeProtocolEvent["type"],
    agentPath: string,
    parentAgentPath: string | null,
    phase: AgentRuntimeProtocolEvent["phase"],
    payload: Record<string, unknown>,
  ): void {
    this.onEvent?.({
      id: randomUUID(),
      runId: this.runId,
      sequence: ++this.sequence,
      type,
      agentPath,
      parentAgentPath,
      phase,
      createdAt: Date.now(),
      payload,
    });
  }
}
