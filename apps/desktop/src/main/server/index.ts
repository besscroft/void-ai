import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { resolveModel, listProviders } from "../lib/providers";
import { buildAgentSystemPrompt, upsertServerNode } from "../lib/db";

/**
 * 仅监听 loopback（127.0.0.1）的本地 HTTP 服务
 *
 * 作用：作为 main 进程与 renderer 之间的桥梁，承载 AI SDK 的流式协议。
 * 选择 HTTP 而非纯 IPC 的原因：
 *  - useChat 原生支持 fetch，无需改造客户端
 *  - AI SDK 的 SSE/数据流协议天然适配 HTTP
 *  - 仅绑定 127.0.0.1，外部无法访问；密钥在 main 进程内闭环
 */

let server: ReturnType<typeof serve> | null = null;
let assignedPort = 0;

/** 创建 Hono 应用并定义路由 */
function createApp(): Hono {
  const app = new Hono();

  // 健康检查
  app.get("/api/health", (c) => c.json({ ok: true, port: assignedPort }));

  // 列出可用 provider 及其模型
  app.get("/api/models", (c) => {
    const providers = listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models.filter((model) => model.enabled),
      helpUrl: p.helpUrl,
    }));
    return c.json({ providers });
  });

  // 聊天流式接口
  app.post("/api/chat", async (c) => {
    const body = (await c.req.json()) as {
      messages: UIMessage[];
      /** 形如 "openai/gpt-4o" 的模型引用 */
      model?: string;
      system?: string;
      agentId?: string;
      conversationId?: string;
      /** 采样温度 0~2 */
      temperature?: number;
      /** nucleus sampling 概率 0~1 */
      topP?: number;
      /** 最大输出 token 数 */
      maxOutputTokens?: number;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages 不能为空" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model 字段必填（provider/model 格式）" }, 400);
    }

    try {
      const model = resolveModel(body.model);
      const result = streamText({
        model,
        system: body.system ?? buildAgentSystemPrompt(body.agentId, body.conversationId),
        messages: convertToModelMessages(body.messages),
        // 仅在有效范围内应用模型参数，避免无效值透传到 provider
        ...(typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 2
          ? { temperature: body.temperature }
          : {}),
        ...(typeof body.topP === "number" && body.topP >= 0 && body.topP <= 1
          ? { topP: body.topP }
          : {}),
        ...(typeof body.maxOutputTokens === "number" && body.maxOutputTokens > 0
          ? { maxOutputTokens: Math.floor(body.maxOutputTokens) }
          : {}),
      });

      // 返回 AI SDK 的 UIMessage 流式响应（SSE 格式）
      return result.toUIMessageStreamResponse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/chat 失败:", message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

/**
 * 启动本地 HTTP 服务，绑定到随机端口（127.0.0.1）。
 * @returns 实际分配的端口号
 */
export function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(assignedPort);
      return;
    }
    try {
      const instance = serve({
        fetch: createApp().fetch,
        hostname: "127.0.0.1",
        // 0 表示由系统分配空闲端口
        port: 0,
        // 启动完成回调
        overrideGlobalObjects: false,
      });
      server = instance;

      instance.on?.("listening", () => {
        const addr = instance.address();
        if (addr && typeof addr === "object" && "port" in addr) {
          assignedPort = addr.port;
          const now = Date.now();
          upsertServerNode({
            id: "server-local-ai",
            name: "Local AI Loopback",
            kind: "local",
            url: `http://127.0.0.1:${assignedPort}`,
            status: "online",
            capabilities_json: JSON.stringify(["chat-stream", "agent-context", "memory-injection"]),
            last_seen_at: now,
            created_at: now,
            updated_at: now,
          });
          console.log(`[server] 本地 AI 服务已启动: http://127.0.0.1:${assignedPort}`);
          resolve(assignedPort);
        }
      });

      instance.on?.("error", (err: NodeJS.ErrnoException) => {
        console.error("[server] 启动失败:", err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/** 停止本地 HTTP 服务（应用退出时调用） */
export function stopServer(): void {
  if (server) {
    server.close?.();
    server = null;
    assignedPort = 0;
  }
}

/** 获取当前服务端口（启动后可用） */
export function getServerPort(): number {
  return assignedPort;
}
