import { app, ipcMain, type BrowserWindow } from "electron";
import { getServerInfo, getServerPort } from "../server";
import {
  listConversations,
  listDeletedConversations,
  getConversation,
  createConversation,
  deleteConversation,
  restoreConversation,
  permanentlyDeleteConversation,
  permanentlyDeleteConversations,
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
  getAgent,
  createAgent,
  updateAgent,
  archiveAgent,
  restoreAgent as restoreAgentProfile,
  duplicateAgent,
  deleteAgent,
  saveAgent,
  runtimeSnapshot,
  listMemories,
  saveMemory,
  deleteMemory,
  listRuntimeEvents,
  listInteractionProfiles,
  getSyncState,
  getRuntimeSnapshot,
  getToolsSnapshot,
  createToolServer,
  updateToolServer,
  deleteToolServer,
  listDeletedToolServers,
  restoreToolServer,
  permanentlyDeleteToolServer,
  permanentlyDeleteToolServers,
  purgeExpiredDeletedToolServers,
  setToolServerEnabled,
  updateToolRecord,
  createSkillTool,
  updateSkillTool,
  deleteSkillTool,
  listDeletedSkillTools,
  restoreSkillTool,
  permanentlyDeleteSkillTool,
  permanentlyDeleteSkillTools,
  purgeExpiredDeletedSkillTools,
  setSkillToolEnabled,
  setToolSecret,
  deleteToolSecret,
} from "../lib/db";
import {
  clearProviderApiKey,
  clearModelApiKey,
  deleteCustomModel,
  deleteCustomProvider,
  listManagedModels,
  listProviders,
  saveProviderApiKey,
  saveModelApiKey,
  syncAvailableModels,
  testProvider,
  updateModelEnabled,
  upsertCustomModel,
  upsertCustomProvider,
} from "../lib/providers";
import type {
  AgentInput,
  AgentProfile,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  SkillDraftRequest,
  ToolSecretInput,
  ToolSkillInput,
  MemoryRecord,
  MessageRow,
  ToolServerInput,
} from "../../shared/types";
import { queueAgentLearning } from "../lib/agent-learning";
import { closeMcpClient, discoverMcpServer, testMcpServer } from "../lib/mcp-manager";
import { runToolSkill } from "../lib/skill-runtime";
import { generateSkillDraft } from "../lib/skill-drafts";
import { cancelWorkflowRun } from "../lib/workflow-cancellation";
import { getActiveWorkflowRunForConversation } from "../lib/workflow-runs";

/**
 * IPC handlers 娉ㄥ唽
 *
 * 鍛藉悕绾﹀畾锛歝hannel 褰㈠ "domain:action"
 *  - conversations:list / conversations:create / conversations:delete / conversations:get
 *  - messages:list / messages:save
 *  - settings:get / settings:set
 *  - apikeys:list / apikeys:set / apikeys:delete
 *  - server:port         鑾峰彇鏈湴 AI 鏈嶅姟绔彛
 *  - providers:list      鑾峰彇 provider 鍒楄〃锛堝惈妯″瀷銆乭elpUrl锛?
 */

export function registerIpcHandlers(_mainWindow: BrowserWindow): void {
  // ---------- 浼氳瘽鍘嗗彶 ----------
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

  ipcMain.handle("conversations:permanentDeleteBatch", (_e, ids: string[]) => {
    return permanentlyDeleteConversations(ids);
  });

  ipcMain.handle("conversations:purgeExpired", () => purgeExpiredDeletedConversations());

  // ---------- 娑堟伅 ----------
  ipcMain.handle("messages:list", (_e, conversationId: string) => listMessages(conversationId));

  ipcMain.handle("messages:save", (_e, msg: MessageRow) => {
    saveMessage(msg);
    return true;
  });

  ipcMain.handle("messages:saveBatch", (_e, msgs: MessageRow[]) => {
    saveMessagesBatch(msgs);
    return true;
  });

  // ---------- 璁剧疆 ----------
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
  // 娉ㄦ剰锛氫笉鏆撮湶 apikeys:get 鏄庢枃鎺ュ彛锛屾覆鏌撳眰鏃犻渶璇诲彇鏄庢枃 key

  // ---------- AI 宸ヤ綔鍙?----------
  ipcMain.handle("runtime:snapshot", () => getRuntimeSnapshot());
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:get", (_e, id: string) => getAgent(id));
  ipcMain.handle("agents:create", (_e, input: AgentInput) => createAgent(input));
  ipcMain.handle("agents:update", (_e, id: string, input: Partial<AgentInput>) =>
    updateAgent(id, input),
  );
  ipcMain.handle("agents:archive", (_e, id: string) => archiveAgent(id));
  ipcMain.handle("agents:restore", (_e, id: string) => restoreAgentProfile(id));
  ipcMain.handle("agents:duplicate", (_e, id: string) => duplicateAgent(id));
  ipcMain.handle("agents:delete", (_e, id: string) => {
    deleteAgent(id);
    return true;
  });
  ipcMain.handle("agents:runtimeSnapshot", () => runtimeSnapshot());
  ipcMain.handle("agents:queueLearning", (_e, conversationId: string) => {
    queueAgentLearning(conversationId);
    return true;
  });
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
  // 工作流编排：仅暴露 chat 页面悬浮状态框需要的能力 —— 取消运行 + 按会话查最近一次 run
  ipcMain.handle("workflowRuns:cancel", (_e, runId: string) => cancelWorkflowRun(runId));
  // chat 页面右上方悬浮状态框：按会话取最近一次 run（活动优先 / 终态次之）
  ipcMain.handle("workflowRuns:activeForConversation", (_e, conversationId: string) =>
    getActiveWorkflowRunForConversation(conversationId),
  );
  ipcMain.handle("runtime:events:list", () => listRuntimeEvents());
  ipcMain.handle("interactions:list", () => listInteractionProfiles());
  ipcMain.handle("sync:get", () => getSyncState());

  // ---------- tools: MCP + Workflow Skills ----------
  ipcMain.handle("tools:snapshot", () => getToolsSnapshot());
  ipcMain.handle(
    "tools:updateTool",
    (
      _e,
      id: string,
      patch: {
        enabled?: boolean | number;
        auto_use?: boolean | number;
        requires_approval?: boolean | number;
      },
    ) => updateToolRecord(id, patch),
  );
  ipcMain.handle("tools:mcp:create", (_e, input: ToolServerInput) => createToolServer(input));
  ipcMain.handle("tools:mcp:update", async (_e, id: string, input: Partial<ToolServerInput>) => {
    const server = updateToolServer(id, input);
    await closeMcpClient(id);
    return server;
  });
  ipcMain.handle("tools:mcp:delete", async (_e, id: string) => {
    await closeMcpClient(id);
    deleteToolServer(id);
    return true;
  });
  ipcMain.handle("tools:mcp:listDeleted", () => listDeletedToolServers("mcp"));
  ipcMain.handle("tools:mcp:restore", (_e, id: string) => restoreToolServer(id));
  ipcMain.handle("tools:mcp:permanentDelete", async (_e, id: string) => {
    await closeMcpClient(id);
    permanentlyDeleteToolServer(id);
    return true;
  });
  ipcMain.handle("tools:mcp:permanentDeleteBatch", async (_e, ids: string[]) => {
    await Promise.all(ids.map((id) => closeMcpClient(id)));
    return permanentlyDeleteToolServers(ids);
  });
  ipcMain.handle("tools:mcp:purgeExpired", () => purgeExpiredDeletedToolServers());
  ipcMain.handle("tools:mcp:setEnabled", async (_e, id: string, enabled: boolean) => {
    const server = setToolServerEnabled(id, enabled);
    if (!enabled) await closeMcpClient(id);
    return server;
  });
  ipcMain.handle("tools:mcp:test", (_e, id: string) => testMcpServer(id));
  ipcMain.handle("tools:mcp:discover", (_e, id: string) => discoverMcpServer(id));
  ipcMain.handle(
    "tools:mcp:updateTool",
    (
      _e,
      id: string,
      patch: {
        enabled?: boolean | number;
        auto_use?: boolean | number;
        requires_approval?: boolean | number;
      },
    ) => updateToolRecord(id, patch),
  );
  ipcMain.handle("tools:mcp:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "server" }),
  );
  ipcMain.handle("tools:mcp:deleteSecret", (_e, id: string) => {
    deleteToolSecret(id);
    return true;
  });

  ipcMain.handle("tools:skills:create", (_e, input: ToolSkillInput) => createSkillTool(input));
  ipcMain.handle("tools:skills:generateDraft", (_e, input: SkillDraftRequest) =>
    generateSkillDraft(input),
  );
  ipcMain.handle("tools:skills:update", (_e, id: string, input: Partial<ToolSkillInput>) =>
    updateSkillTool(id, input),
  );
  ipcMain.handle("tools:skills:delete", (_e, id: string) => {
    deleteSkillTool(id);
    return true;
  });
  ipcMain.handle("tools:skills:listDeleted", () => listDeletedSkillTools());
  ipcMain.handle("tools:skills:restore", (_e, id: string) => restoreSkillTool(id));
  ipcMain.handle("tools:skills:permanentDelete", (_e, id: string) => {
    permanentlyDeleteSkillTool(id);
    return true;
  });
  ipcMain.handle("tools:skills:permanentDeleteBatch", (_e, ids: string[]) =>
    permanentlyDeleteSkillTools(ids),
  );
  ipcMain.handle("tools:skills:purgeExpired", () => purgeExpiredDeletedSkillTools());
  ipcMain.handle("tools:skills:setEnabled", (_e, id: string, enabled: boolean) =>
    setSkillToolEnabled(id, enabled),
  );
  ipcMain.handle("tools:skills:run", (_e, skillId: string, input?: unknown) =>
    runToolSkill({ skillId, input }),
  );
  ipcMain.handle("tools:skills:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "tool" }),
  );
  ipcMain.handle("tools:skills:deleteSecret", (_e, id: string) => {
    deleteToolSecret(id);
    return true;
  });
  // ---------- Provider metadata ----------
  ipcMain.handle("providers:list", () => listProviders());

  ipcMain.handle("providers:listManagedModels", () => listManagedModels());

  ipcMain.handle("providers:upsertCustomProvider", (_e, input: CustomProviderInput) =>
    upsertCustomProvider(input),
  );

  ipcMain.handle("providers:deleteCustomProvider", (_e, providerId: string) => {
    deleteCustomProvider(providerId);
    return true;
  });

  ipcMain.handle("providers:setProviderApiKey", (_e, providerId: string, apiKey: string) => {
    saveProviderApiKey(providerId, apiKey);
    return true;
  });

  ipcMain.handle("providers:deleteProviderApiKey", (_e, providerId: string) => {
    clearProviderApiKey(providerId);
    return true;
  });

  ipcMain.handle("providers:testProvider", (_e, providerId: string) => testProvider(providerId));

  ipcMain.handle("providers:syncAvailableModels", (_e, providerId: string) =>
    syncAvailableModels(providerId),
  );

  ipcMain.handle("providers:upsertCustomModel", (_e, input: CustomModelInput) =>
    upsertCustomModel(input),
  );

  ipcMain.handle(
    "providers:updateModelEnabled",
    (_e, providerId: string, modelId: string, enabled: boolean) => {
      updateModelEnabled(providerId, modelId, enabled);
      return true;
    },
  );

  ipcMain.handle(
    "providers:setModelApiKey",
    (_e, providerId: string, modelId: string, apiKey: string) => {
      saveModelApiKey(providerId, modelId, apiKey);
      return true;
    },
  );

  ipcMain.handle("providers:deleteModelApiKey", (_e, providerId: string, modelId: string) => {
    clearModelApiKey(providerId, modelId);
    return true;
  });

  ipcMain.handle("providers:deleteCustomModel", (_e, providerId: string, modelId: string) => {
    deleteCustomModel(providerId, modelId);
    return true;
  });

  // ---------- Local server port ----------
  ipcMain.handle("server:port", () => getServerPort());
  ipcMain.handle("server:info", () => getServerInfo());

  // ---------- System information ----------
  ipcMain.handle("system:locale", () => app.getLocale());
}

/** 瀵煎嚭绫诲瀷渚?preload 浣跨敤 */
export type { Conversation, MessageRow };
