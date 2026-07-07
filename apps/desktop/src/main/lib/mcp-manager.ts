import { jsonSchema, tool, type ToolSet } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type {
  ChatToolDescriptor,
  McpDiscoveryResult,
  McpServer,
  McpTool,
} from "../../shared/types";
import {
  getMcpServer,
  getMcpToolByReference,
  insertHarnessEvent,
  listMcpServers,
  listMcpTools,
  resolveExtensionSecretReferences,
  updateMcpServerStatus,
  upsertMcpToolDefinitions,
} from "./db";
import type { ChatToolModelContext } from "./chat-tools";

const clientCache = new Map<string, { updatedAt: number; client: MCPClient }>();

export function mcpToolReference(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function parseMcpToolReference(
  reference: string,
): { serverId: string; toolName: string } | null {
  const match = reference.match(/^mcp:([^:]+):(.+)$/);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

export function mcpToolRuntimeName(serverId: string, toolName: string): string {
  return "mcp_" + toolNamePart(serverId) + "_" + toolNamePart(toolName);
}

export function createMcpToolDescriptors(): ChatToolDescriptor[] {
  try {
    const servers = listMcpServers();
    const serverById = new Map(servers.map((server) => [server.id, server]));
    return listMcpTools().flatMap((mcpTool) => {
      const server = serverById.get(mcpTool.server_id);
      if (!server) return [];
      const available = server.enabled !== 0 && mcpTool.enabled !== 0;
      const descriptor: ChatToolDescriptor = {
        id: mcpToolReference(server.id, mcpTool.name),
        label: mcpTool.title || `${server.name}: ${mcpTool.name}`,
        description: mcpTool.description || `MCP tool from ${server.name}.`,
        kind: "host",
        execution: "host",
        category: "mcp",
        defaultAuto: available && server.auto_use !== 0 && mcpTool.auto_use !== 0,
        requiresApproval: server.requires_approval !== 0 || mcpTool.requires_approval !== 0,
        available,
        unavailableReason: available ? undefined : "MCP server or tool is disabled.",
        sourceId: server.id,
        sourceName: server.name,
      };
      return [descriptor];
    });
  } catch {
    return [];
  }
}

export function createMcpToolSet({
  references,
  model,
  conversationId,
  agentId,
}: {
  references: string[];
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): { tools: ToolSet; activeTools: string[]; approvalToolNames: string[] } {
  const tools: ToolSet = {};
  const activeTools: string[] = [];
  const approvalToolNames: string[] = [];
  for (const reference of references) {
    const parsed = parseMcpToolReference(reference);
    if (!parsed) continue;
    const server = getMcpServer(parsed.serverId);
    const mcpTool = getMcpToolByReference(parsed.serverId, parsed.toolName);
    if (!server || !mcpTool || server.enabled === 0 || mcpTool.enabled === 0) continue;
    const toolName = mcpToolRuntimeName(server.id, mcpTool.name);
    tools[toolName] = createMcpTool({ reference, server, mcpTool, model, conversationId, agentId });
    activeTools.push(toolName);
    if (server.requires_approval !== 0 || mcpTool.requires_approval !== 0) {
      approvalToolNames.push(toolName);
    }
  }
  return { tools, activeTools, approvalToolNames };
}

export async function testMcpServer(serverId: string): Promise<McpDiscoveryResult> {
  return discoverMcpServer(serverId);
}

export async function discoverMcpServer(serverId: string): Promise<McpDiscoveryResult> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  let client: MCPClient | null = null;
  try {
    await closeMcpClient(serverId);
    client = await createClient(server);
    const toolsResult = await client.listTools();
    const definitions = toolsResult.tools.map((definition) => ({
      name: definition.name,
      title: getOptionalString(definition, "title"),
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: getOptionalValue(definition, "outputSchema"),
    }));
    const tools = upsertMcpToolDefinitions(server.id, definitions);
    const [resources, resourceTemplates, prompts] = await Promise.all([
      countSafely(() => client?.listResources()),
      countSafely(() => client?.listResourceTemplates()),
      countSafely(() => client?.experimental_listPrompts()),
    ]);
    const connectedAt = Date.now();
    const nextServer =
      updateMcpServerStatus(server.id, {
        status: server.enabled ? "ready" : "disabled",
        last_error: null,
        last_connected_at: connectedAt,
      }) ?? server;
    insertHarnessEvent({
      kind: "tool",
      title: "MCP discovered: " + server.name,
      status: "succeeded",
      detail: { serverId: server.id, tools: tools.length, resources, resourceTemplates, prompts },
    });
    return {
      server: nextServer,
      tools,
      resources,
      resourceTemplates,
      prompts,
      message: `Discovered ${tools.length} tools.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextServer =
      updateMcpServerStatus(server.id, { status: "error", last_error: message }) ?? server;
    insertHarnessEvent({
      kind: "error",
      title: "MCP discovery failed: " + server.name,
      status: "failed",
      detail: { serverId: server.id, error: message },
    });
    return {
      server: nextServer,
      tools: listMcpTools(server.id),
      resources: 0,
      resourceTemplates: 0,
      prompts: 0,
      message,
    };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export async function closeMcpClient(serverId: string): Promise<void> {
  const cached = clientCache.get(serverId);
  if (!cached) return;
  clientCache.delete(serverId);
  await cached.client.close().catch(() => undefined);
}

export async function closeAllMcpClients(): Promise<void> {
  const clients = [...clientCache.values()];
  clientCache.clear();
  await Promise.all(clients.map((entry) => entry.client.close().catch(() => undefined)));
}

async function executeMcpTool({
  reference,
  input,
  model,
  conversationId,
  agentId,
}: {
  reference: string;
  input: unknown;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): Promise<unknown> {
  const parsed = parseMcpToolReference(reference);
  if (!parsed) throw new Error("Invalid MCP tool reference: " + reference);
  const server = getMcpServer(parsed.serverId);
  const mcpTool = getMcpToolByReference(parsed.serverId, parsed.toolName);
  if (!server || !mcpTool || server.enabled === 0 || mcpTool.enabled === 0) {
    throw new Error("MCP tool is unavailable: " + reference);
  }
  const started = Date.now();
  try {
    const client = await getOrCreateClient(server);
    const output = await client.callTool({
      name: mcpTool.name,
      arguments: normalizeToolInput(input),
    });
    insertHarnessEvent({
      kind: "tool",
      title: "MCP tool: " + mcpTool.name,
      status: "succeeded",
      detail: {
        serverId: server.id,
        serverName: server.name,
        toolName: mcpTool.name,
        conversationId,
        agentId,
        providerId: model.providerId,
        modelId: model.modelId,
        durationMs: Date.now() - started,
      },
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateMcpServerStatus(server.id, { status: "error", last_error: message });
    insertHarnessEvent({
      kind: "error",
      title: "MCP tool failed: " + mcpTool.name,
      status: "failed",
      detail: { serverId: server.id, toolName: mcpTool.name, error: message },
    });
    throw error;
  }
}

async function getOrCreateClient(server: McpServer): Promise<MCPClient> {
  const cached = clientCache.get(server.id);
  if (cached && cached.updatedAt === server.updated_at) return cached.client;
  await closeMcpClient(server.id);
  const client = await createClient(server);
  clientCache.set(server.id, { updatedAt: server.updated_at, client });
  return client;
}

async function createClient(server: McpServer): Promise<MCPClient> {
  const transport =
    server.transport === "stdio"
      ? new Experimental_StdioMCPTransport({
          command: requireCommand(server),
          args: safeJsonArray(server.args_json).map(String),
          env: {
            ...stringEnv(process.env),
            ...resolveExtensionSecretReferences("mcp", server.id, safeJsonRecord(server.env_json)),
          },
          cwd: server.cwd ?? undefined,
        })
      : {
          type: server.transport,
          url: requireUrl(server),
          headers: resolveExtensionSecretReferences(
            "mcp",
            server.id,
            safeJsonRecord(server.headers_json),
          ),
          redirect: "error" as const,
        };
  return createMCPClient({
    clientName: "void-ai",
    version: "1.0.0",
    transport,
    maxRetries: 0,
    onUncaughtError: (error) => {
      console.warn("[mcp] uncaught error:", error);
    },
  });
}

function createMcpTool({
  reference,
  server,
  mcpTool,
  model,
  conversationId,
  agentId,
}: {
  reference: string;
  server: McpServer;
  mcpTool: McpTool;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): ToolSet[string] {
  return tool({
    description: mcpTool.description || `Call ${mcpTool.name} on ${server.name}.`,
    inputSchema: jsonSchema<Record<string, unknown>>(safeJsonSchema(mcpTool.input_schema_json)),
    execute: (input) => executeMcpTool({ reference, input, model, conversationId, agentId }),
  });
}

function requireCommand(server: McpServer): string {
  const command = server.command?.trim();
  if (!command) throw new Error("MCP stdio server is missing a command.");
  return command;
}

function requireUrl(server: McpServer): string {
  const url = server.url?.trim();
  if (!url) throw new Error("MCP remote server is missing a URL.");
  return url;
}

function safeJsonSchema(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw, {});
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { type: "object", additionalProperties: true };
}

function safeJsonRecord(raw: string): Record<string, string> {
  const parsed = safeJson(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

function safeJsonArray(raw: string): unknown[] {
  const parsed = safeJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function countSafely(run: () => Promise<unknown> | undefined): Promise<number> {
  try {
    const value = await run();
    if (!value || typeof value !== "object") return 0;
    const record = value as Record<string, unknown>;
    for (const key of ["tools", "resources", "resourceTemplates", "prompts"]) {
      const list = record[key];
      if (Array.isArray(list)) return list.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function getOptionalString(record: unknown, key: string): string | undefined {
  const value = getOptionalValue(record, key);
  return typeof value === "string" ? value : undefined;
}

function getOptionalValue(record: unknown, key: string): unknown {
  if (!record || typeof record !== "object") return undefined;
  return (record as Record<string, unknown>)[key];
}

function toolNamePart(value: string): string {
  const part = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return part || "tool";
}
