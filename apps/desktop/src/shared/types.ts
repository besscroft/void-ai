/**
 * 主进程与渲染进程共享的类型定义
 *
 * 这些类型描述了通过 IPC 在两个进程间传递的数据结构。
 * main 和 preload 都从这里 import，渲染进程通过 preload 的 d.ts 间接获取。
 */

/** 会话记录 */
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

/** 消息记录（对应 DB 中的 messages 表） */
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  /** UIMessage JSON 序列化后的字符串 */
  content: string;
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

export interface AgentRun {
  id: string;
  conversation_id: string | null;
  root_agent_id: string;
  final_agent_id: string | null;
  status: RunStatus;
  model_ref: string | null;
  started_at: number;
  finished_at: number | null;
  trace_id: string | null;
  input_summary: string | null;
  output_summary: string | null;
  error: string | null;
  usage_json: string | null;
}

export type AgentRunStepKind =
  | "input_guardrail"
  | "model"
  | "tool"
  | "sandbox"
  | "handoff"
  | "consult"
  | "approval"
  | "output_guardrail"
  | "state"
  | "error";

export interface AgentRunStep {
  id: string;
  run_id: string;
  agent_id: string | null;
  kind: AgentRunStepKind;
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
  salience: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export type WorkflowStatus = "enabled" | "paused" | "draft";

export interface WorkflowStep {
  id: string;
  type: "prompt" | "tool" | "approval" | "memory" | "handoff";
  title: string;
  detail: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  steps_json: string;
  trigger: string;
  created_at: number;
  updated_at: number;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: RunStatus;
  input_json: string | null;
  output_json: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface HarnessEvent {
  id: string;
  kind:
    | "tool"
    | "test"
    | "approval"
    | "automation"
    | "error"
    | "agent"
    | "handoff"
    | "learning"
    | "guardrail"
    | "sandbox";
  title: string;
  status: RunStatus;
  detail_json: string;
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

export interface ServerNode {
  id: string;
  name: string;
  kind: "local" | "cloud" | "mcp" | "sync";
  url: string;
  status: "online" | "offline" | "disabled";
  capabilities_json: string;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

export type ExtensionStatus = "ready" | "disabled" | "error" | "unknown";
export type McpTransportKind = "stdio" | "http" | "sse";
export type ExtensionOwnerType = "mcp" | "skill";

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransportKind;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  status: ExtensionStatus;
  command: string | null;
  args_json: string;
  url: string | null;
  headers_json: string;
  env_json: string;
  cwd: string | null;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface McpServerInput {
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
}

export interface McpTool {
  id: string;
  server_id: string;
  name: string;
  title: string | null;
  description: string;
  input_schema_json: string;
  output_schema_json: string;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  discovered_at: number;
  updated_at: number;
}

export interface McpDiscoveryResult {
  server: McpServer;
  tools: McpTool[];
  resources: number;
  resourceTemplates: number;
  prompts: number;
  message: string;
}

export type ExtensionSkillStepType = "prompt" | "tool" | "approval" | "memory" | "handoff";

export interface ExtensionSkillStep {
  id: string;
  type: ExtensionSkillStepType;
  title: string;
  detail: string;
}

export interface ExtensionSkill {
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
}

export interface ExtensionSkillInput {
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
  steps?: ExtensionSkillStep[] | string;
  workflow_id?: string | null;
}

export interface ExtensionSecret {
  id: string;
  owner_type: ExtensionOwnerType;
  owner_id: string;
  key: string;
  label: string;
  ciphertext: string;
  updated_at: number;
}

export interface ExtensionSecretInput {
  ownerType: ExtensionOwnerType;
  ownerId: string;
  key: string;
  label?: string;
  value: string;
}

export interface ExtensionSecretPublic {
  id: string;
  owner_type: ExtensionOwnerType;
  owner_id: string;
  key: string;
  label: string;
  updated_at: number;
}

export interface ExtensionsSnapshot {
  mcpServers: McpServer[];
  mcpTools: McpTool[];
  skills: ExtensionSkill[];
  secrets: ExtensionSecretPublic[];
  workflowRuns: WorkflowRun[];
  harnessEvents: HarnessEvent[];
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
  "workspace_snapshot",
  "model_capabilities",
  "conversation_search",
  "memory_save",
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
    | "workspace"
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

export function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

export function isMcpToolReference(value: unknown): value is string {
  return typeof value === "string" && /^mcp:[A-Za-z0-9_.-]+:.+$/.test(value);
}

export function isSkillToolReference(value: unknown): value is string {
  return typeof value === "string" && /^skill:[A-Za-z0-9_.-]+$/.test(value);
}

export function isChatToolReference(value: unknown): value is ChatToolReference {
  return isChatToolId(value) || isMcpToolReference(value) || isSkillToolReference(value);
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

export interface InteractionProfile {
  id: string;
  kind: "chat" | "voice" | "video" | "mouse" | "desktop_pet";
  label: string;
  enabled: number;
  status: "ready" | "prototype" | "blocked";
  config_json: string;
  updated_at: number;
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
 * 应用设置键名枚举（避免拼写错误）
 *
 * 所有设置项统一以字符串存入 settings 表的 KV 结构。
 * 复杂结构（如 accent）也以字符串形式存储，由渲染层解析。
 */
export const SettingKey = {
  // —— 主题 / 外观 ——
  /** 主题模式：'light' | 'dark' | 'system' */
  Theme: "theme",
  ThemePreset: "theme_preset",
  /** 强调色预设 id（见 AccentPreset），或自定义 oklch 字符串 */
  AccentColor: "accent_color",
  /** 自定义背景色（hex / oklch 字符串；空字符串表示沿用主题默认） */
  BackgroundColor: "background_color",
  /** 自定义前景/文字色；空字符串表示沿用主题默认 */
  ForegroundColor: "foreground_color",
  /** UI 字体 CSS font-family；空字符串表示沿用主题默认 */
  FontFamily: "font_family",
  /** 等宽字体 CSS font-family；空字符串表示沿用主题默认 */
  MonoFontFamily: "mono_font_family",
  /** 半透明侧边栏：是否使用 backdrop-blur */
  TranslucentSidebar: "translucent_sidebar",
  /** 对比度 0~100，用于微调强调色与文字色的明暗对比 */
  Contrast: "contrast",
  /** 交互元素使用指针光标 */
  UsePointerCursor: "use_pointer_cursor",
  /** 减少动态效果：'system' | 'on' | 'off' */
  ReduceMotion: "reduce_motion",
  /** 字号级别：'xs' | 'sm' | 'base' | 'lg' | 'xl' */
  FontSize: "font_size",
  /** 代码字体大小（px） */
  CodeFontSizePx: "code_font_size_px",
  /** 差异标记：'color' | 'symbol' */
  DiffMark: "diff_mark",
  /** 界面密度：'compact' | 'comfortable' | 'loose' */
  LayoutDensity: "layout_density",
  /** 界面语言：'zh-CN' | 'en' */
  Language: "language",
  // —— 模型 ——
  /** 当前选中的模型引用，形如 "openai/gpt-4o" */
  SelectedModel: "selected_model",
  /** 采样温度 0~2，默认 0.7 */
  ModelTemperature: "model_temperature",
  /** 最大输出 token 数，默认 4096 */
  ModelMaxTokens: "model_max_tokens",
  /** nucleus sampling 概率 0~1，默认 1 */
  ModelTopP: "model_top_p",
  /** Chat reasoning effort level. */
  ChatReasoningLevel: "chat_reasoning_level",
  /** Per-conversation chat tool mode and manual selections. */
  ChatTools: "chat_tools",
  /** Chat media generation defaults. */
  MediaGeneration: "media_generation",
  /** 缓存上限（MB），默认 200 */
  CacheSizeMb: "cache_size_mb",
  /** Custom provider and model catalog JSON. */
  ModelCatalog: "model_catalog",
  // —— 其它 ——
  /** 当前会话 ID */
  ActiveConversationId: "active_conversation_id",
  /** 当前智能体 ID */
  ActiveAgentId: "active_agent_id",
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];

// ============================================================
// 设置项类型定义
// ============================================================

/** 主题模式 */
export type ThemeMode = "light" | "dark" | "system";

export type ThemePresetId = "default" | "ocean" | "forest" | "rose";

/** 字号级别 */
export type FontSizeLevel = "xs" | "sm" | "base" | "lg" | "xl";

/** 界面密度 */
export type LayoutDensity = "compact" | "comfortable" | "loose";

/** 减少动态效果偏好 */
export type ReduceMotion = "system" | "on" | "off";

/** 差异标记方式 */
export type DiffMark = "color" | "symbol";

/** 支持的界面语言 */
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

/**
 * 强调色预设
 *
 * value 为 oklch 字符串，运行时覆盖 --color-accent。
 * foreground 为配套的前景色（保证对比度），覆盖 --color-accent-foreground。
 */
export interface AccentPreset {
  id: string;
  /** 显示名 */
  label: string;
  /** oklch 主色 */
  value: string;
  /** oklch 前景色（通常为白/雪色） */
  foreground: string;
  /** 用于预览圆点的十六进制回退色（仅展示） */
  swatch: string;
}

/** 预置强调色预设 */
export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: "indigo",
    label: "靛蓝",
    value: "oklch(0.55 0.22 264)",
    foreground: "oklch(0.98 0.01 264)",
    swatch: "#4f46e5",
  },
  {
    id: "emerald",
    label: "翡翠",
    value: "oklch(0.62 0.17 155)",
    foreground: "oklch(0.98 0.01 155)",
    swatch: "#059669",
  },
  {
    id: "rose",
    label: "玫瑰",
    value: "oklch(0.62 0.22 16)",
    foreground: "oklch(0.98 0.01 16)",
    swatch: "#e11d48",
  },
  {
    id: "amber",
    label: "琥珀",
    value: "oklch(0.72 0.18 70)",
    foreground: "oklch(0.2 0.02 70)",
    swatch: "#d97706",
  },
  {
    id: "sky",
    label: "天蓝",
    value: "oklch(0.62 0.16 230)",
    foreground: "oklch(0.98 0.01 230)",
    swatch: "#0284c7",
  },
  {
    id: "violet",
    label: "紫罗兰",
    value: "oklch(0.58 0.22 300)",
    foreground: "oklch(0.98 0.01 300)",
    swatch: "#7c3aed",
  },
];

/** 字号级别到像素值的映射（应用于根 font-size） */
export const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  xs: 13,
  sm: 14,
  base: 15,
  lg: 16,
  xl: 18,
};

/** UI 字体预设 */
export interface FontPreset {
  id: string;
  label: string;
  /** CSS font-family 字符串 */
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
    label: "Inter / 思源黑体",
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

/** 缓存统计信息 */
export interface CacheStats {
  /** 当前缓存占用字节数 */
  bytes: number;
  /** 缓存上限（MB），来自设置 */
  limitMb: number;
}

export interface WorkspaceSnapshot {
  agents: AgentProfile[];
  agentRuns: AgentRun[];
  agentRunSteps: AgentRunStep[];
  agentRuntimeStates: AgentRuntimeState[];
  conversationAgentStates: ConversationAgentState[];
  sandboxSessions: SandboxSession[];
  sandboxSnapshots: SandboxSnapshot[];
  sandboxArtifacts: SandboxArtifact[];
  memories: MemoryRecord[];
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  harnessEvents: HarnessEvent[];
  serverNodes: ServerNode[];
  interactionProfiles: InteractionProfile[];
  syncState: SyncState;
}

export const DEFAULT_AGENT_ID = "agent-void";
/**
 * 应用设置聚合（渲染层使用）
 *
 * 每个字段都可独立持久化，聚合后便于在 UI 中统一消费与实时应用。
 */
export interface AppSettings {
  theme: ThemeMode;
  themePreset: ThemePresetId;
  accentColor: string;
  backgroundColor: string;
  foregroundColor: string;
  fontFamily: string;
  monoFontFamily: string;
  translucentSidebar: boolean;
  contrast: number;
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
  cacheSizeMb: number;
}

/**
 * 默认设置
 *
 * "恢复默认设置" 一键重置到此对象。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  themePreset: "default",
  accentColor: "theme",
  backgroundColor: "",
  foregroundColor: "",
  fontFamily: "",
  monoFontFamily: "",
  translucentSidebar: true,
  contrast: 50,
  usePointerCursor: false,
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
  cacheSizeMb: 200,
};
