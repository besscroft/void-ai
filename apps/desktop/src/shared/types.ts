/**
 * 涓昏繘绋嬩笌娓叉煋杩涚▼鍏变韩鐨勭被鍨嬪畾涔?
 *
 * 杩欎簺绫诲瀷鎻忚堪浜嗛€氳繃 IPC 鍦ㄤ袱涓繘绋嬮棿浼犻€掔殑鏁版嵁缁撴瀯銆?
 * main 鍜?preload 閮戒粠杩欓噷 import锛屾覆鏌撹繘绋嬮€氳繃 preload 鐨?d.ts 闂存帴鑾峰彇銆?
 */

/** 浼氳瘽璁板綍 */
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

/** 娑堟伅璁板綍锛堝搴?DB 涓殑 messages 琛級 */
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  /** Serialized UIMessage JSON. Kept for renderer compatibility. */
  content: string;
  content_json?: string;
  metadata_json?: string;
  created_at: number;
}

export type AgentStatus = "active" | "draft" | "archived";
export type AgentKind = "main" | "child";
export type AgentHandoffMode = "handoff" | "consult" | "both";
export type AgentRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "reviewing"
  | "handoff"
  | "tool_calling"
  | "sandbox"
  | "learning"
  | "failed";

export type AgentReviewPolicy = "inherit" | "auto" | "review_sensitive" | "review_all";
export type AgentSandboxPolicy = "inherit" | "disabled" | "local" | "docker";
export type ChatToolReference = string;

export interface AgentToolPolicy {
  mode: "inherit" | "custom";
  allowedToolIds: ChatToolReference[];
  requireApprovalToolIds: ChatToolReference[];
}

export interface AgentHandoffConfig {
  mode: AgentHandoffMode;
  priority: "low" | "normal" | "high";
  accepts: string[];
  expectedOutput: string;
}

export interface AgentRuntimeConfig {
  maxTurns: number;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoning?: ChatReasoningLevel;
  reviewPolicy?: AgentReviewPolicy;
  sandboxPolicy?: AgentSandboxPolicy;
  notes?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  instructions?: string;
  persona?: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status: AgentStatus;
  kind: AgentKind;
  parent_agent_id: string | null;
  locked: number;
  enabled: number;
  tool_policy_json: string;
  handoff_config_json: string;
  runtime_config_json: string;
  model_ref: string | null;
  voice: string | null;
  created_at: number;
  updated_at: number;
}

export interface AgentInput {
  name: string;
  role: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status?: AgentStatus;
  enabled?: boolean | number;
  model_ref?: string | null;
  voice?: string | null;
  tool_policy_json?: string;
  handoff_config_json?: string;
  runtime_config_json?: string;
}

export interface RuntimeRun {
  id: string;
  conversation_id: string | null;
  root_agent_id: string | null;
  final_agent_id: string | null;
  workflow_id?: string | null;
  status: RunStatus;
  model_ref: string | null;
  started_at: number;
  finished_at: number | null;
  trace_id: string | null;
  input_summary: string | null;
  output_summary: string | null;
  error: string | null;
  usage_json: string | null;
  metadata_json?: string;
  updated_at?: number;
}

export type RuntimeStepKind =
  | "model"
  | "tool"
  | "approval"
  | "handoff"
  | "memory"
  | "workflow"
  | "sandbox"
  | "guardrail"
  | "diagnostic"
  | "error";

export interface RuntimeStep {
  id: string;
  run_id: string;
  agent_id: string | null;
  tool_id?: string | null;
  kind: RuntimeStepKind;
  status: RunStatus;
  title: string;
  detail_json: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
}

export interface AgentRuntimeState {
  agent_id: string;
  status: AgentRuntimeStatus;
  current_run_id: string | null;
  last_handoff_at: number | null;
  last_tool_at: number | null;
  last_learning_at: number | null;
  last_error: string | null;
  updated_at: number;
}

export interface ConversationAgentState {
  conversation_id: string;
  active_agent_id: string | null;
  current_run_id: string | null;
  current_step_id: string | null;
  status: AgentRuntimeStatus;
  summary: string | null;
  updated_at: number;
}

export type MemoryScope = "global" | "agent" | "conversation";
export type MemoryKind = "fact" | "preference" | "episode" | "profile" | "skill";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  content: string;
  agent_id: string | null;
  conversation_id: string | null;
  source_run_id?: string | null;
  salience: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}

/** 智能体自动提取后、等待用户确认的记忆建议（已废弃，保留类型避免旧数据反序列化失败） */
export interface MemoryPendingSuggestion {
  id: string;
  title: string;
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  salience: number;
  suggestedAt: number;
  sourceConversationId: string;
  sourceAgentId: string | null;
}

/** 有界记忆文件类型 */
export type MemoryFileKind = "soul" | "user" | "memory";

/** 记忆文件快照，供渲染层记忆页面展示 */
export interface AgentMemoryFileSnapshot {
  kind: MemoryFileKind;
  content: string;
  charLimit: number;
  charCount: number;
  updatedAt: number;
  userLocked: boolean;
}

export type WorkflowStatus = "enabled" | "paused" | "draft";

export interface WorkflowStep {
  id: string;
  type: "prompt" | "tool" | "approval" | "memory" | "handoff";
  title: string;
  detail: string;
}

/**
 * 工作流节点类型。在 OpenAI Orchestration 范式之上扩展：
 * - handoff 节点把控制权转交给子代理（OpenAI Handoffs 范式）
 * - consult 节点作为受限能力被父代理调用（Agents-as-tools 范式）
 * - parallel / branch / delay 提供控制流
 */
export type WorkflowNodeKind =
  | "prompt"
  | "tool"
  | "approval"
  | "memory"
  | "handoff"
  | "consult"
  | "parallel"
  | "branch"
  | "delay";

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "waiting_approval"
  | "waiting_handoff";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_handoff"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowOnErrorPolicy = "fail" | "continue" | "compensate" | "fallback";

/**
 * Chat 页面悬浮状态框专用快照：与主进程 `getActiveWorkflowRunForConversation` 返回值对齐。
 * - 活动 run：status 在 queued/running/waiting_approval/waiting_handoff 之一
 * - 终态 run：用于显示短暂 toast（5s 后自动隐藏）
 */
export interface ActiveWorkflowRunSnapshot {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt: number | null;
  currentNodeId: string | null;
}

export interface WorkflowRetryPolicy {
  maxAttempts: number; // 0 = 不重试
  backoffMs: number; // 首次退避毫秒
  backoffMultiplier: number; // 指数退避倍率
}

export interface WorkflowBranchOption {
  nodeId: string; // 分支选中的下一节点 id
  when?: string; // 极简表达式，命中条件（缺省/空 = 默认分支）
}

export interface WorkflowNodeConfig {
  // 通用
  agentId?: string;
  /**
   * 该节点归属的 agent 路径（OpenAI Responses Multi-agent 风格的层级命名，例如
   * "/root"、"/root/researcher"）。缺省时引擎回退到 "/root"。UI 可按此字段对节点
   * 事件做来源分组/着色；目前仅 engine 透传到 EngineEvent 与 step_run.metadata_json，
   * 不持久化到独立列。
   */
  agentPath?: string;
  // prompt
  systemPrompt?: string;
  promptTemplate?: string;
  // tool
  toolRef?: string; // "skill:<id>" / "<chatToolId>" / "mcp:<serverId>:<toolName>"
  toolInput?: JsonObject;
  // approval
  approvalPrompt?: string;
  // memory
  memoryQuery?: string;
  memoryKind?: MemoryKind;
  memoryWrite?: { title: string; content: string; kind: MemoryKind };
  // handoff / consult
  targetAgentId?: string;
  handoffTask?: string;
  handoffExpectedOutput?: string;
  // parallel
  parallelNodes?: string[]; // 参与并行的节点 id 列表
  // branch
  conditionExpression?: string; // 整条表达式的入口；branches 缺省时用此求值
  branches?: WorkflowBranchOption[]; // 多路分支，第一个 when 求值为 truthy 的胜出
  // delay
  delayMs?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  description?: string;
  dependsOn: string[]; // DAG 前置节点
  config: WorkflowNodeConfig;
  retryPolicy: WorkflowRetryPolicy;
  onError: WorkflowOnErrorPolicy;
  fallbackNodeId?: string; // onError=fallback 时跳转的节点
  timeoutMs?: number; // 节点级超时
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  trigger: string;
  version: number;
  entryNodeId: string;
  nodes: WorkflowNode[];
  // 旧版 ToolSkillStep JSON，保留以兼容存量数据
  steps_json?: string;
  created_at: number;
  updated_at: number;
}

export type RunStatus = WorkflowRunStatus;

export interface WorkflowStepRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: WorkflowNodeStatus;
  attempt: number;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  assigned_agent_id: string | null;
  metadata_json: string;
}

export interface WorkflowTransition {
  id: string;
  workflow_run_id: string;
  from_node_id: string | null;
  to_node_id: string;
  reason: string;
  created_at: number;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  runtime_run_id?: string | null;
  status: RunStatus;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  context_json: string;
  started_at: number;
  finished_at: number | null;
  triggered_by: "void-tool" | "manual" | "schedule" | "skill";
  triggered_by_agent_id: string | null;
  conversation_id: string | null;
}

export interface RuntimeEvent {
  id: string;
  run_id: string | null;
  step_id: string | null;
  conversation_id: string | null;
  agent_id: string | null;
  tool_id: string | null;
  owner_type: string | null;
  owner_id: string | null;
  kind: RuntimeStepKind;
  status: RunStatus;
  severity: "debug" | "info" | "warning" | "error";
  title: string;
  detail_json: string;
  duration_ms: number | null;
  created_at: number;
}

export type SandboxIsolationMode = "docker" | "local";
export type SandboxStatus = "active" | "stopped" | "failed";

export interface SandboxSession {
  id: string;
  conversation_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  root_path: string;
  isolation_mode: SandboxIsolationMode;
  status: SandboxStatus;
  docker_available: number;
  created_at: number;
  updated_at: number;
}

export interface SandboxSnapshot {
  id: string;
  session_id: string;
  label: string;
  manifest_json: string;
  created_at: number;
}

export interface SandboxArtifact {
  id: string;
  session_id: string;
  kind: "file" | "directory" | "preview";
  path: string;
  url: string | null;
  size_bytes: number | null;
  created_at: number;
}

export type ToolStatus = "ready" | "disabled" | "error" | "unknown";
export type McpTransportKind = "stdio" | "http" | "sse" | "builtin";
export type ToolServerKind = "mcp" | "local" | "sandbox";
export type ToolRecordKind = "builtin" | "mcp" | "skill" | "sandbox";
export type ToolSecretOwnerType = "server" | "tool";

export interface ToolServer {
  id: string;
  name: string;
  description: string;
  kind: ToolServerKind;
  transport: McpTransportKind;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  status: ToolStatus;
  command: string | null;
  args_json: string;
  url: string | null;
  headers_json: string;
  env_json: string;
  cwd: string | null;
  timeout_seconds: number;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export interface ToolServerInput {
  name: string;
  description?: string;
  transport: McpTransportKind;
  enabled?: boolean | number;
  auto_use?: boolean | number;
  requires_approval?: boolean | number;
  command?: string | null;
  args?: string[] | string;
  url?: string | null;
  headers?: Record<string, string> | string;
  env?: Record<string, string> | string;
  cwd?: string | null;
  timeout_seconds?: number | string | null;
}

export interface ToolRecord {
  id: string;
  server_id: string | null;
  name: string;
  title: string | null;
  description: string;
  kind: ToolRecordKind;
  category: string;
  reference: string;
  input_schema_json: string;
  output_schema_json: string;
  config_json: string;
  steps_json: string;
  workflow_id: string | null;
  trigger_keywords_json: string;
  tags_json: string;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  discovered_at: number;
  last_run_at: number | null;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export interface ToolDiscoveryResult {
  server: ToolServer;
  tools: ToolRecord[];
  resources: number;
  resourceTemplates: number;
  prompts: number;
  message: string;
}

export type ToolSkillStepType = "prompt" | "tool" | "approval" | "memory" | "handoff";

export interface ToolSkillStep {
  id: string;
  type: ToolSkillStepType;
  title: string;
  detail: string;
}

export interface ToolSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  trigger_keywords_json: string;
  tags_json: string;
  config_schema_json: string;
  config_json: string;
  steps_json: string;
  workflow_id: string | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export interface ToolSkillInput {
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean | number;
  auto_use?: boolean | number;
  requires_approval?: boolean | number;
  triggerKeywords?: string[] | string;
  tags?: string[] | string;
  configSchema?: JsonObject | string;
  config?: JsonObject | string;
  steps?: ToolSkillStep[] | string;
  workflow_id?: string | null;
}

export interface SkillDraftRequest {
  prompt: string;
}

export interface SkillDraftResult {
  markdown: string;
}

export interface ToolSecret {
  id: string;
  owner_type: ToolSecretOwnerType;
  owner_id: string;
  key: string;
  label: string;
  ciphertext: string;
  updated_at: number;
}

export interface ToolSecretInput {
  ownerType: ToolSecretOwnerType;
  ownerId: string;
  key: string;
  label?: string;
  value: string;
}

export interface ToolSecretPublic {
  id: string;
  owner_type: ToolSecretOwnerType;
  owner_id: string;
  key: string;
  label: string;
  updated_at: number;
}

export interface ToolsSnapshot {
  toolServers: ToolServer[];
  toolRecords: ToolRecord[];
  skills: ToolSkill[];
  secrets: ToolSecretPublic[];
  workflowRuns: WorkflowRun[];
  runtimeEvents: RuntimeEvent[];
}

export const CHAT_SESSION_HEADER = "x-void-ai-session";

export interface LocalServerInfo {
  port: number;
  token: string;
}

export interface ChatExecutionMetadata {
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  model?: string;
  agentId?: string | null;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  stepCount?: number;
  toolCallCount?: number;
}

export interface ChatReactionMetadata {
  emoji: string;
  label: string;
  createdAt: number;
}

export interface ChatMessageMetadata {
  execution?: ChatExecutionMetadata;
  reaction?: ChatReactionMetadata;
  mediaGeneration?: JsonObject;
}

export const CHAT_TOOL_IDS = [
  "web_search",
  "current_time",
  "memory_search",
  "runtime_snapshot",
  "model_capabilities",
  "conversation_search",
  "memory_save",
  "memory_update",
  "memory_delete",
  "sandbox_list_files",
  "sandbox_read_file",
  "sandbox_write_file",
  "sandbox_run_command",
  "sandbox_snapshot",
  "sandbox_restore",
  "sandbox_list_artifacts",
  "sandbox_preview_port",
] as const;

export type ChatToolId = (typeof CHAT_TOOL_IDS)[number];
export type ChatToolMode = "off" | "auto" | "manual";

export interface ChatToolSelectionRequest {
  mode: ChatToolMode;
  selectedToolIds: ChatToolReference[];
}

export interface ChatToolsSetting {
  version: 1;
  byConversation: Record<string, ChatToolSelectionRequest>;
}

export interface ChatToolDescriptor {
  id: ChatToolReference;
  label: string;
  description: string;
  kind: "provider" | "host";
  execution?: "provider" | "host";
  category:
    | "web"
    | "system"
    | "memory"
    | "runtime"
    | "model"
    | "conversation"
    | "sandbox"
    | "mcp"
    | "skill";
  defaultAuto: boolean;
  requiresApproval: boolean;
  available: boolean;
  unavailableReason?: string;
  sourceId?: string;
  sourceName?: string;
}

export const DEFAULT_CHAT_TOOL_SELECTION: ChatToolSelectionRequest = {
  mode: "auto",
  selectedToolIds: [],
};

export const DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicy = {
  mode: "inherit",
  allowedToolIds: [],
  requireApprovalToolIds: [
    "conversation_search",
    "memory_save",
    "sandbox_write_file",
    "sandbox_run_command",
    "sandbox_restore",
    "sandbox_preview_port",
  ],
};

export const DEFAULT_AGENT_HANDOFF_CONFIG: AgentHandoffConfig = {
  mode: "consult",
  priority: "normal",
  accepts: [],
  expectedOutput: "Return concise findings, constraints, and recommended next steps.",
};

export const DEFAULT_AGENT_RUNTIME_CONFIG: AgentRuntimeConfig = {
  maxTurns: 8,
  reviewPolicy: "review_sensitive",
  sandboxPolicy: "local",
};

export function normalizeAgentToolPolicy(
  raw: unknown,
  fallback: AgentToolPolicy = DEFAULT_AGENT_TOOL_POLICY,
): AgentToolPolicy {
  const value = readAgentConfigObject(raw);
  return {
    mode: value?.mode === "custom" ? "custom" : fallback.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: normalizeToolIdList(value?.allowedToolIds, fallback.allowedToolIds),
    requireApprovalToolIds: normalizeToolIdList(
      value?.requireApprovalToolIds,
      fallback.requireApprovalToolIds,
    ),
  };
}

export function normalizeAgentHandoffConfig(
  raw: unknown,
  fallback: AgentHandoffConfig = DEFAULT_AGENT_HANDOFF_CONFIG,
): AgentHandoffConfig {
  const value = readAgentConfigObject(raw);
  return {
    mode: isAgentHandoffMode(value?.mode) ? value.mode : fallback.mode,
    priority: isAgentHandoffPriority(value?.priority) ? value.priority : fallback.priority,
    accepts: Array.isArray(value?.accepts)
      ? value.accepts.map(String).filter(Boolean).slice(0, 12)
      : [...fallback.accepts],
    expectedOutput:
      typeof value?.expectedOutput === "string" && value.expectedOutput.trim()
        ? value.expectedOutput.trim()
        : fallback.expectedOutput,
  };
}

export function normalizeAgentRuntimeConfig(
  raw: unknown,
  fallback: AgentRuntimeConfig = DEFAULT_AGENT_RUNTIME_CONFIG,
): AgentRuntimeConfig {
  const value = readAgentConfigObject(raw);
  const config: AgentRuntimeConfig = {
    maxTurns: Math.round(clampFiniteNumber(value?.maxTurns, fallback.maxTurns, 1, 20)),
    reviewPolicy: isAgentReviewPolicy(value?.reviewPolicy)
      ? value.reviewPolicy
      : fallback.reviewPolicy,
    sandboxPolicy: isAgentSandboxPolicy(value?.sandboxPolicy)
      ? value.sandboxPolicy
      : fallback.sandboxPolicy,
  };

  if (typeof value?.temperature === "number") {
    config.temperature = clampFiniteNumber(value.temperature, fallback.temperature ?? 0.7, 0, 2);
  } else if (fallback.temperature !== undefined) {
    config.temperature = fallback.temperature;
  }

  if (typeof value?.topP === "number") {
    config.topP = clampFiniteNumber(value.topP, fallback.topP ?? 1, 0, 1);
  } else if (fallback.topP !== undefined) {
    config.topP = fallback.topP;
  }

  if (typeof value?.maxOutputTokens === "number") {
    config.maxOutputTokens = Math.floor(
      clampFiniteNumber(value.maxOutputTokens, fallback.maxOutputTokens ?? 4096, 1, 32768),
    );
  } else if (fallback.maxOutputTokens !== undefined) {
    config.maxOutputTokens = fallback.maxOutputTokens;
  }

  if (isChatReasoningLevel(value?.reasoning)) {
    config.reasoning = value.reasoning;
  } else if (fallback.reasoning !== undefined) {
    config.reasoning = fallback.reasoning;
  }

  if (typeof value?.notes === "string") {
    config.notes = value.notes;
  } else if (fallback.notes !== undefined) {
    config.notes = fallback.notes;
  }

  return config;
}

export function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

export function isToolRecordReference(value: unknown): value is string {
  return typeof value === "string" && /^mcp:[A-Za-z0-9_.-]+:.+$/.test(value);
}

export function isSkillToolReference(value: unknown): value is string {
  return typeof value === "string" && /^skill:[A-Za-z0-9_.-]+$/.test(value);
}

export function isChatToolReference(value: unknown): value is ChatToolReference {
  return isChatToolId(value) || isToolRecordReference(value) || isSkillToolReference(value);
}

export function isChatToolMode(value: unknown): value is ChatToolMode {
  return value === "off" || value === "auto" || value === "manual";
}

export function normalizeChatToolSelection(raw: unknown): ChatToolSelectionRequest {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CHAT_TOOL_SELECTION };
  const value = raw as Partial<ChatToolSelectionRequest>;
  const ids = Array.isArray(value.selectedToolIds)
    ? value.selectedToolIds.filter(isChatToolReference)
    : [];
  return {
    mode: isChatToolMode(value.mode) ? value.mode : DEFAULT_CHAT_TOOL_SELECTION.mode,
    selectedToolIds: [...new Set(ids)],
  };
}

export function parseChatToolsSetting(raw: string | null | undefined): ChatToolsSetting {
  if (!raw) return { version: 1, byConversation: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatToolsSetting>;
    const byConversation: Record<string, ChatToolSelectionRequest> = {};
    if (
      parsed.version === 1 &&
      parsed.byConversation &&
      typeof parsed.byConversation === "object"
    ) {
      for (const [conversationId, selection] of Object.entries(parsed.byConversation)) {
        if (conversationId) byConversation[conversationId] = normalizeChatToolSelection(selection);
      }
    }
    return { version: 1, byConversation };
  } catch {
    return { version: 1, byConversation: {} };
  }
}

export function getChatToolSelectionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
): ChatToolSelectionRequest {
  const setting = parseChatToolsSetting(rawSetting);
  return setting.byConversation[conversationId] ?? { ...DEFAULT_CHAT_TOOL_SELECTION };
}

export function withChatToolSelectionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
  selection: ChatToolSelectionRequest,
): ChatToolsSetting {
  const setting = parseChatToolsSetting(rawSetting);
  return {
    version: 1,
    byConversation: {
      ...setting.byConversation,
      [conversationId]: normalizeChatToolSelection(selection),
    },
  };
}

function readAgentConfigObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return readAgentConfigObject(parsed);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function normalizeToolIdList(
  raw: unknown,
  fallback: readonly ChatToolReference[],
): ChatToolReference[] {
  const source = Array.isArray(raw) ? raw : fallback;
  return [...new Set(source.filter(isChatToolReference))];
}

function isAgentHandoffMode(value: unknown): value is AgentHandoffMode {
  return value === "handoff" || value === "consult" || value === "both";
}

function isAgentHandoffPriority(value: unknown): value is AgentHandoffConfig["priority"] {
  return value === "low" || value === "normal" || value === "high";
}

function isAgentReviewPolicy(value: unknown): value is AgentReviewPolicy {
  return (
    value === "inherit" ||
    value === "auto" ||
    value === "review_sensitive" ||
    value === "review_all"
  );
}

function isAgentSandboxPolicy(value: unknown): value is AgentSandboxPolicy {
  return value === "inherit" || value === "disabled" || value === "local" || value === "docker";
}

function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export const DEFAULT_AGENT_ID = "agent-void";

export interface InteractionProfile {
  id: string;
  kind: "chat" | "voice" | "video" | "mouse" | "desktop_pet";
  label: string;
  enabled: number;
  status: "ready" | "prototype" | "blocked";
  config_json: string;
  updated_at: number;
}

export type DesktopPetMood =
  | "idle"
  | "hover"
  | "thinking"
  | "working"
  | "learning"
  | "happy"
  | "sleep"
  | "error";

/**
 * 桌宠的"活动状态"，与 mood 不同：
 * - mood 表示情绪/性格状态（来自后端）
 * - activity 表示用户交互触发的瞬时状态（前端本地维护）
 */
export type DesktopPetActivity = "idle" | "hover" | "drag" | "interact" | "sleep" | "hidden";

export interface DesktopPetWindowConfig {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /**
   * 是否"置顶"（永远在其他窗口之上）。
   * 默认 false：桌宠位于其他窗口下方，贴近桌面。
   * 用户可在设置中切换。
   */
  alwaysOnTop: boolean;
  /**
   * 缩放比例（0.5 ~ 1.5），影响桌宠整体视觉大小（不影响窗口 bounds）。
   */
  scale: number;
  /**
   * 窗口整体透明度（0.3 ~ 1.0）。
   */
  opacity: number;
}

export interface DesktopPetInteractionConfig {
  /**
   * 是否播放音效（hover/click/drag-drop）。
   */
  soundEnabled: boolean;
  /**
   * 无操作多少毫秒后进入 sleep 状态；<= 0 表示禁用自动睡眠。
   */
  autoSleepMs: number;
}

export interface DesktopPetConfig {
  version: 1;
  agentId: string;
  conversationId?: string;
  window: DesktopPetWindowConfig;
  interaction: DesktopPetInteractionConfig;
  visual: {
    variant: "void-orb";
  };
}

export type DesktopPetConfigPatch = Omit<
  Partial<DesktopPetConfig>,
  "window" | "visual" | "interaction"
> & {
  window?: Partial<DesktopPetWindowConfig>;
  interaction?: Partial<DesktopPetInteractionConfig>;
  visual?: Partial<DesktopPetConfig["visual"]>;
};

export interface DesktopPetSnapshot {
  profile: InteractionProfile;
  config: DesktopPetConfig;
  agent: AgentProfile | null;
  runtimeState: AgentRuntimeState | null;
  selectedModel: string | null;
  mood: DesktopPetMood;
}

export const DESKTOP_PET_PROFILE_ID = "interaction-pet";

/** 桌宠窗口默认尺寸（CSS px）。只够容纳"宠物球 + 状态文字"，不挡其他软件 */
export const DEFAULT_DESKTOP_PET_WINDOW: DesktopPetWindowConfig = {
  width: 180,
  height: 180,
  alwaysOnTop: false,
  scale: 1,
  opacity: 1,
};

/**
 * 桌宠展开对话气泡时的窗口尺寸（用户主动展开时短暂占用，不影响默认占位）
 */
export const DESKTOP_PET_WINDOW_EXPANDED_SIZE = { width: 280, height: 360 };

/** 桌宠交互默认配置 */
export const DEFAULT_DESKTOP_PET_INTERACTION: DesktopPetInteractionConfig = {
  soundEnabled: false,
  autoSleepMs: 60_000,
};

export const DEFAULT_DESKTOP_PET_CONFIG: DesktopPetConfig = {
  version: 1,
  agentId: DEFAULT_AGENT_ID,
  window: DEFAULT_DESKTOP_PET_WINDOW,
  interaction: DEFAULT_DESKTOP_PET_INTERACTION,
  visual: { variant: "void-orb" },
};

export function normalizeDesktopPetConfig(raw: unknown): DesktopPetConfig {
  const value = readDesktopPetObject(raw);
  const windowValue = readDesktopPetObject(value?.window);
  const interactionValue = readDesktopPetObject(value?.interaction);
  const visualValue = readDesktopPetObject(value?.visual);
  const width = clampDesktopPetNumber(
    windowValue?.width,
    DEFAULT_DESKTOP_PET_WINDOW.width,
    128,
    520,
  );
  const height = clampDesktopPetNumber(
    windowValue?.height,
    DEFAULT_DESKTOP_PET_WINDOW.height,
    128,
    680,
  );
  const x = readOptionalDesktopPetNumber(windowValue?.x);
  const y = readOptionalDesktopPetNumber(windowValue?.y);
  const scale = clampDesktopPetNumber(
    windowValue?.scale,
    DEFAULT_DESKTOP_PET_WINDOW.scale,
    0.5,
    1.5,
  );
  const opacity = clampDesktopPetNumber(
    windowValue?.opacity,
    DEFAULT_DESKTOP_PET_WINDOW.opacity,
    0.3,
    1,
  );
  const autoSleepMs = clampDesktopPetNumber(
    interactionValue?.autoSleepMs,
    DEFAULT_DESKTOP_PET_INTERACTION.autoSleepMs,
    0,
    24 * 60 * 60_000,
  );

  return {
    version: 1,
    agentId: DEFAULT_AGENT_ID,
    conversationId:
      typeof value?.conversationId === "string" && value.conversationId.trim()
        ? value.conversationId.trim()
        : undefined,
    window: {
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      width,
      height,
      alwaysOnTop:
        typeof windowValue?.alwaysOnTop === "boolean"
          ? windowValue.alwaysOnTop
          : DEFAULT_DESKTOP_PET_WINDOW.alwaysOnTop,
      scale,
      opacity,
    },
    interaction: {
      soundEnabled:
        typeof interactionValue?.soundEnabled === "boolean"
          ? interactionValue.soundEnabled
          : DEFAULT_DESKTOP_PET_INTERACTION.soundEnabled,
      autoSleepMs,
    },
    visual: {
      variant: visualValue?.variant === "void-orb" ? "void-orb" : "void-orb",
    },
  };
}

export function mergeDesktopPetConfig(
  current: DesktopPetConfig,
  patch: DesktopPetConfigPatch,
): DesktopPetConfig {
  return normalizeDesktopPetConfig({
    ...current,
    ...patch,
    agentId: DEFAULT_AGENT_ID,
    window: {
      ...current.window,
      ...patch.window,
    },
    interaction: {
      ...current.interaction,
      ...patch.interaction,
    },
    visual: {
      ...current.visual,
      ...patch.visual,
    },
  });
}

export function moodFromAgentRuntimeStatus(
  status: AgentRuntimeStatus | null | undefined,
): DesktopPetMood {
  if (status === "failed") return "error";
  if (status === "learning") return "learning";
  if (status === "queued" || status === "running" || status === "reviewing") return "thinking";
  if (status === "handoff" || status === "tool_calling" || status === "sandbox") return "working";
  return "idle";
}

function readDesktopPetObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      return readDesktopPetObject(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function clampDesktopPetNumber(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.round(Math.min(max, Math.max(min, raw)))
    : fallback;
}

function readOptionalDesktopPetNumber(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : undefined;
}

export interface SyncState {
  id: string;
  mode: "local_only" | "manual" | "cloud";
  endpoint: string | null;
  device_id: string;
  encryption_enabled: number;
  conflict_strategy: "last_write_wins" | "merge_with_review";
  status: "idle" | "syncing" | "error";
  last_synced_at: number | null;
  updated_at: number;
}
export type ModelProviderKind = "openai" | "openai-compatible" | "anthropic" | "google";
export type ModelCatalogSource = "builtin" | "custom";

export type JsonObject = Record<string, unknown>;

export const CHAT_REASONING_LEVELS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ChatReasoningLevel = (typeof CHAT_REASONING_LEVELS)[number];

export function isChatReasoningLevel(value: unknown): value is ChatReasoningLevel {
  return typeof value === "string" && (CHAT_REASONING_LEVELS as readonly string[]).includes(value);
}

export interface ModelCapabilities {
  textGeneration: boolean;
  vision: boolean;
  imageOutput: boolean;
  speechOutput: boolean;
  transcription: boolean;
  videoOutput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  embedding: boolean;
}

export interface ModelOption {
  id: string;
  label?: string;
  source: ModelCatalogSource;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptions: JsonObject;
}

/** Provider metadata without API keys. */
export interface ProviderInfo {
  id: string;
  label: string;
  kind: ModelProviderKind;
  source: ModelCatalogSource;
  models: ModelOption[];
  helpUrl: string;
  baseUrl?: string;
  hasApiKey: boolean;
}

export interface CustomProviderInput {
  id?: string;
  label: string;
  baseUrl: string;
  helpUrl?: string;
}

export interface CustomModelInput {
  providerId: string;
  id: string;
  label?: string;
  enabled?: boolean;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  capabilities?: Partial<ModelCapabilities>;
  providerOptions?: JsonObject;
  providerOptionsJson?: string;
}

export interface ModelCatalogSettings {
  providers: Array<{
    id: string;
    label: string;
    kind: "openai-compatible";
    baseUrl: string;
    helpUrl?: string;
    createdAt: number;
    updatedAt: number;
  }>;
  models: Array<{
    providerId: string;
    id: string;
    label?: string;
    enabled: boolean;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    contextWindow: number;
    capabilities: ModelCapabilities;
    providerOptions: JsonObject;
    createdAt: number;
    updatedAt: number;
  }>;
  modelStates: Array<{
    providerId: string;
    id: string;
    enabled: boolean;
    updatedAt: number;
  }>;
}

export interface ManagedModelInfo {
  ref: string;
  providerId: string;
  providerLabel: string;
  providerKind: ModelProviderKind;
  providerSource: ModelCatalogSource;
  providerBaseUrl?: string;
  providerHelpUrl: string;
  modelId: string;
  modelLabel?: string;
  modelSource: ModelCatalogSource;
  enabled: boolean;
  hasApiKey: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptions: JsonObject;
  providerOptionsJson: string;
}

export interface ProviderTestResult {
  ok: boolean;
  providerId: string;
  checkedModels: number;
  message?: string;
}

export interface ProviderModelSyncResult {
  provider: ProviderInfo;
  discovered: number;
  added: number;
  updated: number;
}

export type MediaGenerationKind = "image" | "speech" | "transcription" | "video";

export interface MediaGenerationFile {
  type: "file";
  mediaType: string;
  filename: string;
  url: string;
  size?: number;
}

export interface MediaGenerationOptions {
  size?: string;
  aspectRatio?: string;
  count?: number;
  seed?: number;
  voice?: string;
  outputFormat?: string;
  speed?: number;
  language?: string;
  instructions?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  generateAudio?: boolean;
}

export type MediaGenerationRequest =
  | {
      kind: "image";
      model: string;
      prompt: string;
      options?: Pick<MediaGenerationOptions, "size" | "aspectRatio" | "count" | "seed">;
    }
  | {
      kind: "speech";
      model: string;
      text: string;
      options?: Pick<
        MediaGenerationOptions,
        "voice" | "outputFormat" | "speed" | "language" | "instructions"
      >;
    }
  | {
      kind: "transcription";
      model: string;
      audio: {
        url: string;
        mediaType?: string;
        filename?: string;
      };
      options?: Pick<MediaGenerationOptions, "language">;
    }
  | {
      kind: "video";
      model: string;
      prompt: string;
      options?: Pick<
        MediaGenerationOptions,
        "aspectRatio" | "resolution" | "duration" | "fps" | "generateAudio" | "count" | "seed"
      >;
    };

export interface MediaGenerationResponse {
  kind: MediaGenerationKind;
  text: string;
  files: MediaGenerationFile[];
  metadata?: JsonObject;
}

export type MediaGenerationErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "no_model"
  | "unsupported_model"
  | "permission_denied"
  | "upstream_error";

export interface MediaGenerationErrorResponse {
  error: string;
  code: MediaGenerationErrorCode;
  kind?: MediaGenerationKind;
  model?: string;
}

export interface MediaGenerationKindSettings {
  modelRef: string | null;
  options: MediaGenerationOptions;
}

export interface MediaGenerationSettings {
  version: 1;
  defaults: Record<MediaGenerationKind, MediaGenerationKindSettings>;
}

export const DEFAULT_MEDIA_GENERATION_SETTINGS: MediaGenerationSettings = {
  version: 1,
  defaults: {
    image: {
      modelRef: null,
      options: {},
    },
    speech: {
      modelRef: null,
      options: {},
    },
    transcription: {
      modelRef: null,
      options: {},
    },
    video: {
      modelRef: null,
      options: {},
    },
  },
};
/**
 * 搴旂敤璁剧疆閿悕鏋氫妇锛堥伩鍏嶆嫾鍐欓敊璇級
 *
 * 鎵€鏈夎缃」缁熶竴浠ュ瓧绗︿覆瀛樺叆 settings 琛ㄧ殑 KV 缁撴瀯銆?
 * 澶嶆潅缁撴瀯锛堝 accent锛変篃浠ュ瓧绗︿覆褰㈠紡瀛樺偍锛岀敱娓叉煋灞傝В鏋愩€?
 */
export const SettingKey = {
  // 鈥斺€?涓婚 / 澶栬 鈥斺€?
  /** 涓婚妯″紡锛?light' | 'dark' | 'system' */
  Theme: "theme",
  ThemePreset: "theme_preset",
  /** 璇嗗埆鏍峰紡棰勮id */
  Style: "theme_style",
  /** UI 瀛椾綋 CSS font-family锛涚┖瀛楃涓茶〃绀烘部鐢ㄤ富棰橀粯璁?*/
  FontFamily: "font_family",
  /** 绛夊瀛椾綋 CSS font-family锛涚┖瀛楃涓茶〃绀烘部鐢ㄤ富棰橀粯璁?*/
  MonoFontFamily: "mono_font_family",
  /** 鍗婇€忔槑渚ц竟鏍忥細鏄惁浣跨敤 backdrop-blur */
  TranslucentSidebar: "translucent_sidebar",
  /** 浜や簰鍏冪礌浣跨敤鎸囬拡鍏夋爣 */
  UsePointerCursor: "use_pointer_cursor",
  /** 鍑忓皯鍔ㄦ€佹晥鏋滐細'system' | 'on' | 'off' */
  ReduceMotion: "reduce_motion",
  /** 瀛楀彿绾у埆锛?xs' | 'sm' | 'base' | 'lg' | 'xl' */
  FontSize: "font_size",
  /** 浠ｇ爜瀛椾綋澶у皬锛坧x锛?*/
  CodeFontSizePx: "code_font_size_px",
  /** 宸紓鏍囪锛?color' | 'symbol' */
  DiffMark: "diff_mark",
  /** 鐣岄潰瀵嗗害锛?compact' | 'comfortable' | 'loose' */
  LayoutDensity: "layout_density",
  /** 鐣岄潰璇█锛?zh-CN' | 'en' */
  Language: "language",
  // 鈥斺€?妯″瀷 鈥斺€?
  /** 褰撳墠閫変腑鐨勬ā鍨嬪紩鐢紝褰㈠ "openai/gpt-4o" */
  SelectedModel: "selected_model",
  /** 閲囨牱娓╁害 0~2锛岄粯璁?0.7 */
  ModelTemperature: "model_temperature",
  /** 鏈€澶ц緭鍑?token 鏁帮紝榛樿 4096 */
  ModelMaxTokens: "model_max_tokens",
  /** nucleus sampling 姒傜巼 0~1锛岄粯璁?1 */
  ModelTopP: "model_top_p",
  /** Chat reasoning effort level. */
  ChatReasoningLevel: "chat_reasoning_level",
  /** Per-conversation chat tool mode and manual selections. */
  ChatTools: "chat_tools",
  /** Chat media generation defaults. */
  MediaGeneration: "media_generation",
  /** Custom provider and model catalog JSON. */
  ModelCatalog: "model_catalog",
  // 鈥斺€?鍏跺畠 鈥斺€?
  /** 褰撳墠浼氳瘽 ID */
  ActiveConversationId: "active_conversation_id",
  /** 褰撳墠鏅鸿兘浣?ID */
  ActiveAgentId: "active_agent_id",
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];

// ============================================================
// 璁剧疆椤圭被鍨嬪畾涔?
// ============================================================

/** 涓婚妯″紡 */
export type ThemeMode = "light" | "dark" | "system";

export type ThemePresetId = "default" | "ocean" | "forest" | "rose";

/** 瀛楀彿绾у埆 */
export type FontSizeLevel = "xs" | "sm" | "base" | "lg" | "xl";

/** 鐣岄潰瀵嗗害 */
export type LayoutDensity = "compact" | "comfortable" | "loose";

/** 鍑忓皯鍔ㄦ€佹晥鏋滃亸濂?*/
export type ReduceMotion = "system" | "on" | "off";

/** 宸紓鏍囪鏂瑰紡 */
export type DiffMark = "color" | "symbol";

/** 鏀寔鐨勭晫闈㈣瑷€ */
export type AppLanguage = "zh-CN" | "en";

export type LanguageMode = "system" | AppLanguage;

export interface ThemePreset {
  id: ThemePresetId;
  labelKey: string;
  swatches: {
    light: string;
    dark: string;
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    labelKey: "theme.preset.default",
    swatches: { light: "#f7f7f8", dark: "#1f1f23" },
  },
  {
    id: "ocean",
    labelKey: "theme.preset.ocean",
    swatches: { light: "#dff3fb", dark: "#0b2d3a" },
  },
  {
    id: "forest",
    labelKey: "theme.preset.forest",
    swatches: { light: "#e7f4e6", dark: "#142a1d" },
  },
  {
    id: "rose",
    labelKey: "theme.preset.rose",
    swatches: { light: "#fff0f4", dark: "#321820" },
  },
];

/** 视觉风格预设（参考 shadcn v4 的 Mira / Vega / Nova / Maia / Lyra）。
 *  - Mira：高圆角、圆润、舒适（默认）
 *  - Vega：方正、现代、较大圆角
 *  - Nova：紧凑、锐利、小圆角
 *  - Maia：柔和、衬线
 *  - Lyra：扁平、低对比、小圆角
 */
export type StylePresetId = "mira" | "vega" | "nova" | "maia" | "lyra";

export interface StylePreset {
  id: StylePresetId;
  /** i18n 键，渲染时通过 useT() 解析 */
  labelKey: string;
  /** 描述 i18n 键 */
  descKey: string;
  /** 风格字体栈（CSS font-family） */
  fontStack: string;
  /** 圆角像素值（影响 swatch 预览与全局 --radius） */
  radius: number;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "mira",
    labelKey: "theme.style.mira",
    descKey: "theme.style.mira.desc",
    fontStack: "'Inter', 'PingFang SC', system-ui, sans-serif",
    radius: 12,
  },
  {
    id: "vega",
    labelKey: "theme.style.vega",
    descKey: "theme.style.vega.desc",
    fontStack: "'Inter', system-ui, sans-serif",
    radius: 10,
  },
  {
    id: "nova",
    labelKey: "theme.style.nova",
    descKey: "theme.style.nova.desc",
    fontStack: "'Inter', system-ui, sans-serif",
    radius: 6,
  },
  {
    id: "maia",
    labelKey: "theme.style.maia",
    descKey: "theme.style.maia.desc",
    fontStack: "'Source Serif Pro', 'Noto Serif SC', Georgia, serif",
    radius: 8,
  },
  {
    id: "lyra",
    labelKey: "theme.style.lyra",
    descKey: "theme.style.lyra.desc",
    fontStack: "'Inter', system-ui, sans-serif",
    radius: 4,
  },
];

/** 瀛楀彿绾у埆鍒板儚绱犲€肩殑鏄犲皠锛堝簲鐢ㄤ簬鏍?font-size锛?*/
export const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  xs: 13,
  sm: 14,
  base: 15,
  lg: 16,
  xl: 18,
};

/** UI 瀛椾綋棰勮 */
export interface FontPreset {
  id: string;
  label: string;
  /** CSS font-family 瀛楃涓?*/
  value: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: "system",
    label: "System UI",
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  {
    id: "sans",
    label: "Inter / 苹方黑体",
    value: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  { id: "rounded", label: "Rounded", value: "'Nunito', 'Quicksand', system-ui, sans-serif" },
  { id: "serif", label: "Serif", value: "'Source Serif Pro', 'Noto Serif SC', Georgia, serif" },
  { id: "mono", label: "Mono", value: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" },
];

export const MONO_FONT_PRESETS: FontPreset[] = [
  {
    id: "system-mono",
    label: "System Mono",
    value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  { id: "jetbrains", label: "JetBrains Mono", value: "'JetBrains Mono', ui-monospace, monospace" },
  { id: "fira", label: "Fira Code", value: "'Fira Code', ui-monospace, monospace" },
  {
    id: "cascadia",
    label: "Cascadia Code",
    value: "'Cascadia Code', 'Cascadia Mono', ui-monospace, monospace",
  },
  { id: "menlo", label: "Menlo / Consolas", value: "Menlo, Consolas, 'Courier New', monospace" },
];

export interface RuntimeSnapshot {
  agents: AgentProfile[];
  runtimeRuns: RuntimeRun[];
  runtimeSteps: RuntimeStep[];
  agentRuntimeStates: AgentRuntimeState[];
  conversationAgentStates: ConversationAgentState[];
  sandboxSessions: SandboxSession[];
  sandboxSnapshots: SandboxSnapshot[];
  sandboxArtifacts: SandboxArtifact[];
  memories: MemoryRecord[];
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  runtimeEvents: RuntimeEvent[];
  interactionProfiles: InteractionProfile[];
  syncState: SyncState;
}

/**
 * 搴旂敤璁剧疆鑱氬悎锛堟覆鏌撳眰浣跨敤锛?
 *
 * 姣忎釜瀛楁閮藉彲鐙珛鎸佷箙鍖栵紝鑱氬悎鍚庝究浜庡湪 UI 涓粺涓€娑堣垂涓庡疄鏃跺簲鐢ㄣ€?
 */
export interface AppSettings {
  theme: ThemeMode;
  themePreset: ThemePresetId;
  style: StylePresetId;
  fontFamily: string;
  monoFontFamily: string;
  translucentSidebar: boolean;
  usePointerCursor: boolean;
  reduceMotion: ReduceMotion;
  fontSize: FontSizeLevel;
  codeFontSizePx: number;
  diffMark: DiffMark;
  density: LayoutDensity;
  language: LanguageMode;
  selectedModel: string | null;
  modelTemperature: number;
  modelMaxTokens: number;
  modelTopP: number;
  chatReasoningLevel: ChatReasoningLevel;
}

/**
 * 榛樿璁剧疆
 *
 * "鎭㈠榛樿璁剧疆" 涓€閿噸缃埌姝ゅ璞°€?
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  themePreset: "default",
  style: "lyra",
  fontFamily: "",
  monoFontFamily: "",
  translucentSidebar: true,
  usePointerCursor: true,
  reduceMotion: "system",
  fontSize: "base",
  codeFontSizePx: 13,
  diffMark: "color",
  density: "comfortable",
  language: "system",
  selectedModel: null,
  modelTemperature: 0.7,
  modelMaxTokens: 4096,
  modelTopP: 1,
  chatReasoningLevel: "provider-default",
};
