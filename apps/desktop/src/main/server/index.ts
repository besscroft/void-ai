import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { CHAT_SESSION_HEADER, type LocalServerInfo } from "../../shared/types";

const ALLOWED_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

let server: ReturnType<typeof serve> | null = null;
let assignedPort = 0;
const sessionToken = randomBytes(32).toString("hex");

interface CreateAppOptions {
  sessionToken?: string;
  getAssignedPort?: () => number;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
  buildAgentSystemPrompt?: (agentId?: string | null, conversationId?: string) => string;
}

interface ResolvedChatModel {
  model: LanguageModel;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
}

function allowRendererOrigin(origin: string): string | null {
  if (origin === "null") return origin;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin)) ? origin : null;
}

function isAuthorized(
  c: { req: { header: (name: string) => string | undefined } },
  token: string,
): boolean {
  return c.req.header(CHAT_SESSION_HEADER) === token;
}

/** Create the local loopback HTTP app used by the renderer chat transport. */
export function createApp(options: CreateAppOptions = {}): Hono {
  const token = options.sessionToken ?? sessionToken;
  const getAssignedPort = options.getAssignedPort ?? (() => assignedPort);
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => allowRendererOrigin(origin),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", CHAT_SESSION_HEADER],
      maxAge: 600,
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, port: getAssignedPort() }));

  app.get("/api/models", async (c) => {
    const { listProviders } = await import("../lib/providers");
    const providers = listProviders()
      .map((p) => ({
        id: p.id,
        label: p.label,
        models: p.models.filter((model) => model.enabled),
        helpUrl: p.helpUrl,
      }))
      .filter((provider) => provider.models.length > 0);
    return c.json({ providers });
  });

  app.post("/api/chat", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as {
      messages: UIMessage[];
      /** Formatted as "provider/model". */
      model?: string;
      system?: string;
      agentId?: string;
      conversationId?: string;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages cannot be empty" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const buildAgentSystemPrompt =
        options.buildAgentSystemPrompt ?? (await import("../lib/db")).buildAgentSystemPrompt;
      const resolved = resolveModel(body.model);
      const result = streamText({
        model: resolved.model,
        instructions: body.system ?? buildAgentSystemPrompt(body.agentId, body.conversationId),
        messages: await convertToModelMessages(body.messages),
        temperature: resolved.temperature,
        topP: resolved.topP,
        maxOutputTokens: resolved.maxOutputTokens,
      });

      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          originalMessages: body.messages,
          sendReasoning: true,
          sendSources: true,
          onError: (error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[server] /api/chat stream failed:", message);
            return message || "Chat stream failed";
          },
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/chat failed:", message);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * POST /api/title
   *
   * 用 LLM 给一段对话起一个简短的标题
   *  - 入参：{ model, messages: UIMessage[] }
   *  - 出参：{ title: string }
   *
   * 使用非流式 generateText，温度 0.4 偏向稳定。
   * 标题清洗：去除前后空白、引号、换行，长度上限 40 字。
   */
  app.post("/api/title", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as {
      messages?: UIMessage[];
      model?: string;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages cannot be empty" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const resolved = resolveModel(body.model);

      // 取前 2 轮（user + assistant）作为标题生成上下文，避免长对话打爆 prompt
      const excerpt = body.messages.slice(0, 4);
      const promptText = excerpt
        .map((m) => {
          const text = (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ")
            .trim();
          return `${m.role === "user" ? "用户" : "助手"}：${text}`;
        })
        .filter((line) => line.length > 2)
        .join("\n");

      const result = await generateText({
        model: resolved.model,
        system:
          "你是一名对话标题生成助手。根据用户与助手的一两轮对话，生成一个不超过 20 个汉字（或 8 个英文单词）的简洁标题。" +
          "要求：1) 直接给出标题文本，不要加引号、不要加前缀；2) 反映对话核心主题；3) 使用对话使用的语言；" +
          "4) 只输出标题本身，不要解释。",
        prompt: promptText,
        temperature: 0.4,
        maxOutputTokens: 64,
      });

      const title = sanitizeTitle(result.text);
      if (!title) {
        return c.json({ error: "Empty title from model" }, 500);
      }
      return c.json({ title });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/title failed:", message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

/** Start the local HTTP server bound to loopback on a random free port. */
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
        port: 0,
        overrideGlobalObjects: false,
      });
      server = instance;

      instance.on?.("listening", () => {
        const addr = instance.address();
        if (addr && typeof addr === "object" && "port" in addr) {
          assignedPort = addr.port;
          const now = Date.now();
          void import("../lib/db")
            .then(({ upsertServerNode }) => {
              upsertServerNode({
                id: "server-local-ai",
                name: "Local AI Loopback",
                kind: "local",
                url: "http://127.0.0.1:" + assignedPort,
                status: "online",
                capabilities_json: JSON.stringify([
                  "chat-stream",
                  "agent-context",
                  "memory-injection",
                ]),
                last_seen_at: now,
                created_at: now,
                updated_at: now,
              });
            })
            .catch((err) => {
              console.error("[server] failed to persist local server node:", err);
            });
          console.log(`[server] Local AI server started: http://127.0.0.1:${assignedPort}`);
          resolve(assignedPort);
        }
      });

      instance.on?.("error", (err: NodeJS.ErrnoException) => {
        console.error("[server] failed to start:", err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function stopServer(): void {
  if (server) {
    server.close?.();
    server = null;
    assignedPort = 0;
  }
}

export function getServerPort(): number {
  return assignedPort;
}

export function getServerInfo(): LocalServerInfo {
  return { port: assignedPort, token: sessionToken };
}

/**
 * 清洗模型返回的标题：
 *  - 去除前后空白
 *  - 去掉成对引号 / 书名号 / 反引号
 *  - 折叠换行
 *  - 截断到 40 字
 */
function sanitizeTitle(raw: string): string {
  let text = raw.trim();
  // 去掉成对包裹的引号
  text = text.replace(/^["'`"「」『』《》]+|["'`"「」『』《》]+$/g, "");
  // 折叠多行
  text = text.replace(/\s*\n+\s*/g, " ");
  // 截断到 40 字
  if (text.length > 40) text = text.slice(0, 40);
  return text.trim();
}
