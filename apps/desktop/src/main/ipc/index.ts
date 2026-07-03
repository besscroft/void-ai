import { app, ipcMain, type BrowserWindow } from "electron";
import { getServerPort } from "../server";
import {
  listConversations,
  listDeletedConversations,
  getConversation,
  createConversation,
  deleteConversation,
  restoreConversation,
  permanentlyDeleteConversation,
  purgeExpiredDeletedConversations,
  touchConversation,
  listMessages,
  saveMessage,
  saveMessagesBatch,
  getSetting,
  setSetting,
  listApiKeyProviders,
  setApiKey,
  deleteApiKey,
  listAgents,
  saveAgent,
  listMemories,
  saveMemory,
  deleteMemory,
  listWorkflows,
  listWorkflowRuns,
  listHarnessEvents,
  listServerNodes,
  listInteractionProfiles,
  getSyncState,
  getWorkspaceSnapshot,
} from "../lib/db";
import { listProviders } from "../lib/providers";
import { getCacheStats, clearCache } from "../lib/cache";
import type { AgentProfile, Conversation, MemoryRecord, MessageRow } from "../../shared/types";

/**
 * IPC handlers 注册
 *
 * 命名约定：channel 形如 "domain:action"
 *  - conversations:list / conversations:create / conversations:delete / conversations:get
 *  - messages:list / messages:save
 *  - settings:get / settings:set
 *  - apikeys:list / apikeys:set / apikeys:delete
 *  - server:port         获取本地 AI 服务端口
 *  - providers:list      获取 provider 列表（含模型、helpUrl）
 */

export function registerIpcHandlers(_mainWindow: BrowserWindow): void {
  // ---------- 会话历史 ----------
  ipcMain.handle("conversations:list", () => listConversations());

  ipcMain.handle("conversations:get", (_e, id: string) => getConversation(id));

  ipcMain.handle("conversations:create", (_e, id: string, title?: string) =>
    createConversation(id, title),
  );

  ipcMain.handle("conversations:delete", (_e, id: string) => {
    deleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:touch", (_e, id: string, title?: string) => {
    touchConversation(id, title);
    return true;
  });

  ipcMain.handle("conversations:listDeleted", () => listDeletedConversations());

  ipcMain.handle("conversations:restore", (_e, id: string) => {
    restoreConversation(id);
    return true;
  });

  ipcMain.handle("conversations:permanentDelete", (_e, id: string) => {
    permanentlyDeleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:purgeExpired", () => purgeExpiredDeletedConversations());

  // ---------- 消息 ----------
  ipcMain.handle("messages:list", (_e, conversationId: string) => listMessages(conversationId));

  ipcMain.handle("messages:save", (_e, msg: MessageRow) => {
    saveMessage(msg);
    return true;
  });

  ipcMain.handle("messages:saveBatch", (_e, msgs: MessageRow[]) => {
    saveMessagesBatch(msgs);
    return true;
  });

  // ---------- 设置 ----------
  ipcMain.handle("settings:get", (_e, key: string) => getSetting(key));

  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    setSetting(key, value);
    return true;
  });

  ipcMain.handle("settings:getAll", (_e, keys: string[]) => {
    const result: Record<string, string | null> = {};
    for (const k of keys) result[k] = getSetting(k);
    return result;
  });

  // ---------- API Key ----------
  ipcMain.handle("apikeys:list", () => listApiKeyProviders());

  ipcMain.handle("apikeys:set", (_e, provider: string, apiKey: string) => {
    setApiKey(provider, apiKey);
    return true;
  });

  ipcMain.handle("apikeys:delete", (_e, provider: string) => {
    deleteApiKey(provider);
    return true;
  });
  // 注意：不暴露 apikeys:get 明文接口，渲染层无需读取明文 key

  // ---------- AI 工作台 ----------
  ipcMain.handle("workspace:snapshot", () => getWorkspaceSnapshot());
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:save", (_e, agent: AgentProfile) => {
    saveAgent(agent);
    return true;
  });
  ipcMain.handle("memories:list", () => listMemories());
  ipcMain.handle("memories:save", (_e, memory: MemoryRecord) => {
    saveMemory(memory);
    return true;
  });
  ipcMain.handle("memories:delete", (_e, id: string) => {
    deleteMemory(id);
    return true;
  });
  ipcMain.handle("workflows:list", () => listWorkflows());
  ipcMain.handle("workflowRuns:list", () => listWorkflowRuns());
  ipcMain.handle("harness:list", () => listHarnessEvents());
  ipcMain.handle("serverNodes:list", () => listServerNodes());
  ipcMain.handle("interactions:list", () => listInteractionProfiles());
  ipcMain.handle("sync:get", () => getSyncState());
  // ---------- Provider 元信息 ----------
  ipcMain.handle("providers:list", () => {
    return listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
      helpUrl: p.helpUrl,
    }));
  });

  // ---------- 本地服务端口 ----------
  ipcMain.handle("server:port", () => getServerPort());

  // ---------- System information ----------
  ipcMain.handle("system:locale", () => app.getLocale());

  // ---------- 缓存管理 ----------
  // 统计缓存占用与上限
  ipcMain.handle("cache:stats", () => getCacheStats());

  // 清理缓存，返回清理后剩余字节数
  ipcMain.handle("cache:clear", async () => clearCache());
}

/** 导出类型供 preload 使用 */
export type { Conversation, MessageRow };
