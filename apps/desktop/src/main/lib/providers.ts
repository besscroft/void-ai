import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { getApiKey } from "./db";

/**
 * Provider 注册表
 *
 * 设计目标：
 * - 配置式扩展：新增 provider 只需在此文件添加一个 ProviderConfig
 * - API key 从加密 DB 读取，main 进程内闭环，渲染层不接触明文 key
 * - 模型列表预置常用项；用户可在设置中添加自定义模型 ID（持久化到 settings 表）
 */

export interface ModelOption {
  id: string;
  /** 显示名（缺省时回退到 id） */
  label?: string;
}

export interface ProviderConfig {
  id: string;
  label: string;
  /** factory 函数：传入 apiKey 返回 provider 实例 */
  create: (apiKey: string) => (modelId: string) => LanguageModel;
  /** 预置模型列表 */
  models: ModelOption[];
  /** 设置页指引文案 */
  helpUrl: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    create: (apiKey) => (modelId) => createOpenAI({ apiKey })(modelId),
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { id: "o1", label: "o1" },
      { id: "o3-mini", label: "o3-mini" },
    ],
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    create: (apiKey) => (modelId) => createAnthropic({ apiKey })(modelId),
    models: [
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-latest", label: "Claude 3 Opus" },
    ],
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google",
    create: (apiKey) => (modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
    helpUrl: "https://aistudio.google.com/apikey",
  },
];

export function listProviders(): ProviderConfig[] {
  return PROVIDERS;
}

export function getProviderConfig(providerId: string): ProviderConfig | null {
  return PROVIDERS.find((p) => p.id === providerId) ?? null;
}

/**
 * 根据模型字符串 "provider/model" 解析并返回 LanguageModel 实例。
 * @param modelRef 形如 "openai/gpt-4o" 的引用
 * @throws 若 provider 未知、API key 未配置或 model id 无效
 */
export function resolveModel(modelRef: string): LanguageModel {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(`无效的模型引用 "${modelRef}"，应为 "provider/model" 格式`);
  }
  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  const config = getProviderConfig(providerId);
  if (!config) throw new Error(`未知的 provider: ${providerId}`);

  const apiKey = getApiKey(providerId);
  if (!apiKey) {
    throw new Error(`${config.label} 的 API key 未配置，请在设置中添加`);
  }

  return config.create(apiKey)(modelId);
}
