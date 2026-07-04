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

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status: AgentStatus;
  model_ref: string | null;
  voice: string | null;
  created_at: number;
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
  kind: "tool" | "test" | "approval" | "automation" | "error";
  title: string;
  status: RunStatus;
  detail_json: string;
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
export const CHAT_SESSION_HEADER = "x-void-ai-session";

export interface LocalServerInfo {
  port: number;
  token: string;
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

export interface ModelOption {
  id: string;
  label?: string;
  source: ModelCatalogSource;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
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
}

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
  /** 字号级别：'xs' | 'sm' | 'base' | 'lg' | 'xl' */
  FontSize: "font_size",
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

/** 缓存统计信息 */
export interface CacheStats {
  /** 当前缓存占用字节数 */
  bytes: number;
  /** 缓存上限（MB），来自设置 */
  limitMb: number;
}

export interface WorkspaceSnapshot {
  agents: AgentProfile[];
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
  fontSize: FontSizeLevel;
  density: LayoutDensity;
  language: LanguageMode;
  selectedModel: string | null;
  modelTemperature: number;
  modelMaxTokens: number;
  modelTopP: number;
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
  fontSize: "base",
  density: "comfortable",
  language: "system",
  selectedModel: null,
  modelTemperature: 0.7,
  modelMaxTokens: 4096,
  modelTopP: 1,
  cacheSizeMb: 200,
};
