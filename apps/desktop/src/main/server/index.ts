import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  experimental_generateVideo as generateVideo,
  generateImage,
  generateSpeech,
  generateText,
  streamText,
  toUIMessageStream,
  transcribe,
  type LanguageModel,
  type UIMessage,
} from "ai";
import {
  CHAT_REASONING_LEVELS,
  CHAT_SESSION_HEADER,
  isChatReasoningLevel,
  type ChatReasoningLevel,
  type ChatToolSelectionRequest,
  type LocalServerInfo,
  type MediaGenerationRequest,
  type MediaGenerationResponse,
  type ModelCapabilities,
  type ModelProviderKind,
} from "../../shared/types";
import type { ChatToolModelContext } from "../lib/chat-tools";
import type { NativeChatTool } from "../lib/providers";

const ALLOWED_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

let server: ReturnType<typeof serve> | null = null;
let assignedPort = 0;
const sessionToken = randomBytes(32).toString("hex");

interface CreateAppOptions {
  sessionToken?: string;
  getAssignedPort?: () => number;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
  resolveMediaModel?: typeof import("../lib/providers").resolveMediaModel;
  writeMediaAsset?: typeof import("../lib/media-assets").writeMediaAsset;
  buildChatToolRuntime?: typeof import("../lib/chat-tools").buildChatToolRuntime;
  auditChatToolApprovalResponses?: typeof import("../lib/chat-tools").auditChatToolApprovalResponses;
  buildAgentSystemPrompt?: (agentId?: string | null, conversationId?: string) => string;
}

interface ResolvedChatModel {
  model: LanguageModel;
  providerId?: string;
  providerKind?: ModelProviderKind;
  modelId?: string;
  capabilities?: ModelCapabilities;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
  nativeTools?: NativeChatTool[];
}

const DEFAULT_CHAT_MODEL_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

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

function parseChatReasoningLevel(raw: unknown): {
  ok: boolean;
  value?: Exclude<ChatReasoningLevel, "provider-default" | "none">;
} {
  if (raw === undefined) return { ok: true };
  if (!isChatReasoningLevel(raw)) return { ok: false };
  if (raw === "provider-default" || raw === "none") return { ok: true };
  return { ok: true, value: raw };
}

function normalizeChatReasoningForModel(
  reasoning: ReturnType<typeof parseChatReasoningLevel>,
  model: ChatToolModelContext,
): ReturnType<typeof parseChatReasoningLevel> {
  if (!reasoning.ok || !reasoning.value) return reasoning;
  if (model.providerKind === "openai-compatible" && reasoning.value === "minimal") {
    return { ok: true };
  }
  return reasoning;
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

  app.post("/api/media/generate", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as Partial<MediaGenerationRequest>;
    const validationError = validateMediaGenerationRequest(body);
    if (validationError) return c.json({ error: validationError }, 400);
    const request = body as MediaGenerationRequest;

    try {
      const resolveMediaModel =
        options.resolveMediaModel ?? (await import("../lib/providers")).resolveMediaModel;
      const writeMediaAsset =
        options.writeMediaAsset ?? (await import("../lib/media-assets")).writeMediaAsset;

      switch (request.kind) {
        case "image": {
          const resolved = resolveMediaModel(request.model, "image");
          const result = await generateImage({
            model: resolved.model,
            prompt: request.prompt,
            n: normalizeCount(request.options?.count, 1, 8),
            size: normalizeSize(request.options?.size),
            aspectRatio: normalizeAspectRatio(request.options?.aspectRatio),
            seed: normalizeInteger(request.options?.seed),
            providerOptions: resolved.providerOptions,
          });
          const files = result.images.map((image, index) =>
            writeMediaAsset({
              data: image.uint8Array,
              mediaType: image.mediaType,
              kind: "image",
              filename: `image-${index + 1}`,
            }),
          );
          return c.json({
            kind: "image",
            text: files.length === 1 ? "Image generated." : `${files.length} images generated.`,
            files,
            metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
          } satisfies MediaGenerationResponse);
        }
        case "speech": {
          const resolved = resolveMediaModel(request.model, "speech");
          const result = await generateSpeech({
            model: resolved.model,
            text: request.text,
            voice: request.options?.voice?.trim() || defaultSpeechVoice(resolved.providerKind),
            outputFormat: normalizeOutputFormat(request.options?.outputFormat),
            speed: normalizeNumberOption(request.options?.speed, 0.25, 4),
            language: normalizeOptionalText(request.options?.language),
            instructions: normalizeOptionalText(request.options?.instructions),
            providerOptions: resolved.providerOptions,
          });
          const file = writeMediaAsset({
            data: result.audio.uint8Array,
            mediaType: result.audio.mediaType,
            kind: "speech",
            filename: "speech",
          });
          return c.json({
            kind: "speech",
            text: "Speech audio generated.",
            files: [file],
            metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
          } satisfies MediaGenerationResponse);
        }
        case "transcription": {
          const resolved = resolveMediaModel(request.model, "transcription");
          const audio = dataUrlToUint8Array(request.audio.url);
          const result = await transcribe({
            model: resolved.model,
            audio,
            providerOptions: withTranscriptionLanguage(
              resolved.providerOptions,
              resolved.providerId,
              request.options?.language,
            ),
          });
          return c.json({
            kind: "transcription",
            text: result.text,
            files: [],
            metadata: {
              ...buildMediaMetadata(result.warnings, result.providerMetadata),
              language: result.language,
              durationInSeconds: result.durationInSeconds,
              segments: result.segments,
            },
          } satisfies MediaGenerationResponse);
        }
        case "video": {
          const resolved = resolveMediaModel(request.model, "video");
          const result = await generateVideo({
            model: resolved.model,
            prompt: request.prompt,
            n: normalizeCount(request.options?.count, 1, 4),
            aspectRatio: normalizeAspectRatio(request.options?.aspectRatio),
            resolution: normalizeSize(request.options?.resolution),
            duration: normalizeNumberOption(request.options?.duration, 1, 60),
            fps: normalizeNumberOption(request.options?.fps, 1, 120),
            seed: normalizeInteger(request.options?.seed),
            generateAudio:
              typeof request.options?.generateAudio === "boolean"
                ? request.options.generateAudio
                : undefined,
            providerOptions: resolved.providerOptions,
          });
          const files = result.videos.map((video, index) =>
            writeMediaAsset({
              data: video.uint8Array,
              mediaType: video.mediaType,
              kind: "video",
              filename: `video-${index + 1}`,
            }),
          );
          return c.json({
            kind: "video",
            text: files.length === 1 ? "Video generated." : `${files.length} videos generated.`,
            files,
            metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
          } satisfies MediaGenerationResponse);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/media/generate failed:", message);
      return c.json({ error: message }, getHttpErrorStatus(err));
    }
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
      reasoning?: unknown;
      toolSelection?: ChatToolSelectionRequest;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages cannot be empty" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }
    const parsedReasoning = parseChatReasoningLevel(body.reasoning);
    if (!parsedReasoning.ok) {
      return c.json(
        { error: "reasoning must be one of: " + CHAT_REASONING_LEVELS.join(", ") },
        400,
      );
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const buildAgentSystemPrompt =
        options.buildAgentSystemPrompt ?? (await import("../lib/db")).buildAgentSystemPrompt;
      const chatToolsModule = options.buildChatToolRuntime
        ? undefined
        : await import("../lib/chat-tools");
      const buildChatToolRuntime =
        options.buildChatToolRuntime ?? chatToolsModule!.buildChatToolRuntime;
      const auditChatToolApprovalResponses =
        options.auditChatToolApprovalResponses ?? chatToolsModule?.auditChatToolApprovalResponses;
      const resolved = resolveModel(body.model);
      const chatToolModelContext = toChatToolModelContext(body.model, resolved);
      const reasoning = normalizeChatReasoningForModel(parsedReasoning, chatToolModelContext);
      auditChatToolApprovalResponses?.({
        messages: body.messages,
        model: chatToolModelContext,
        conversationId: body.conversationId,
        agentId: body.agentId,
      });
      const toolRuntime = buildChatToolRuntime({
        selection: body.toolSelection,
        model: chatToolModelContext,
        conversationId: body.conversationId,
        agentId: body.agentId,
      });
      const instructions = appendChatToolInstructions(
        body.system ?? buildAgentSystemPrompt(body.agentId, body.conversationId),
        toolRuntime.instructions,
      );
      const streamOptions: Parameters<typeof streamText>[0] = {
        model: resolved.model,
        instructions,
        messages: await convertToModelMessages(
          body.messages,
          toolRuntime.tools ? { tools: toolRuntime.tools } : undefined,
        ),
        temperature: resolved.temperature,
        topP: resolved.topP,
        maxOutputTokens: resolved.maxOutputTokens,
        providerOptions: resolved.providerOptions,
      };
      if (reasoning.value) streamOptions.reasoning = reasoning.value;
      if (toolRuntime.tools) streamOptions.tools = toolRuntime.tools;
      if (toolRuntime.activeTools?.length) streamOptions.activeTools = toolRuntime.activeTools;
      if (toolRuntime.toolChoice) streamOptions.toolChoice = toolRuntime.toolChoice;
      if (toolRuntime.toolApproval) streamOptions.toolApproval = toolRuntime.toolApproval;
      if (toolRuntime.stopWhen) streamOptions.stopWhen = toolRuntime.stopWhen;
      if (toolRuntime.onStepEnd) streamOptions.onStepEnd = toolRuntime.onStepEnd;
      const result = streamText(streamOptions);

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
      return c.json({ error: message }, getHttpErrorStatus(err));
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
        providerOptions: resolved.providerOptions,
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

function validateMediaGenerationRequest(body: Partial<MediaGenerationRequest>): string | null {
  if (!body || typeof body !== "object") return "request body is required";
  if (!body.kind) return "kind is required";
  if (
    body.kind !== "image" &&
    body.kind !== "speech" &&
    body.kind !== "transcription" &&
    body.kind !== "video"
  ) {
    return "kind must be one of: image, speech, transcription, video";
  }
  if (!body.model || typeof body.model !== "string")
    return "model is required in provider/model format";
  switch (body.kind) {
    case "image":
    case "video":
      return typeof body.prompt === "string" && body.prompt.trim() ? null : "prompt is required";
    case "speech":
      return typeof body.text === "string" && body.text.trim() ? null : "text is required";
    case "transcription":
      return body.audio && typeof body.audio.url === "string" && body.audio.url.trim()
        ? null
        : "audio.url is required";
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCount(value: unknown, fallback: number, max: number): number {
  const numberValue = Math.floor(Number(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(max, numberValue);
}

function normalizeInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.floor(numberValue);
}

function normalizeNumberOption(value: unknown, min: number, max: number): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeSize(value: unknown): `${number}x${number}` | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d+x\d+$/.test(trimmed) ? (trimmed as `${number}x${number}`) : undefined;
}

function normalizeAspectRatio(value: unknown): `${number}:${number}` | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d+:\d+$/.test(trimmed) ? (trimmed as `${number}:${number}`) : undefined;
}

function normalizeOutputFormat(value: unknown): "mp3" | "wav" | (string & {}) | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultSpeechVoice(providerKind: ModelProviderKind | undefined): string | undefined {
  if (providerKind === "google") return "Kore";
  if (providerKind === "openai" || providerKind === "openai-compatible") return "alloy";
  return undefined;
}

function dataUrlToUint8Array(url: string): Uint8Array {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(url.trim());
  if (!match) throw new Error("audio.url must be a base64 data URL");
  return new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
}

function withTranscriptionLanguage(
  providerOptions: Parameters<typeof transcribe>[0]["providerOptions"],
  providerId: string,
  language: unknown,
): Parameters<typeof transcribe>[0]["providerOptions"] {
  const normalized = normalizeOptionalText(language);
  if (!normalized) return providerOptions;
  return {
    ...providerOptions,
    [providerId]: {
      ...(providerOptions?.[providerId] as Record<string, unknown> | undefined),
      language: normalized,
    },
  };
}

function buildMediaMetadata(warnings: unknown, providerMetadata: unknown): Record<string, unknown> {
  return {
    warnings: Array.isArray(warnings) ? warnings : [],
    providerMetadata: providerMetadata ?? {},
  };
}

function appendChatToolInstructions(base: string, toolInstructions: string | undefined): string {
  if (!toolInstructions) return base;
  return [base.trim(), toolInstructions.trim()].filter(Boolean).join("\n\n");
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
                  "media-generation",
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
  text = text.replace(/^["'`“”‘’「」『』《》]+|["'`“”‘’「」『』《》]+$/g, "");
  // 折叠多行
  text = text.replace(/\s*\n+\s*/g, " ");
  // 截断到 40 字
  if (text.length > 40) text = text.slice(0, 40);
  return text.trim();
}

function toChatToolModelContext(
  modelRef: string,
  resolved: ResolvedChatModel,
): ChatToolModelContext {
  const slashIdx = modelRef.indexOf("/");
  const providerId =
    resolved.providerId ?? (slashIdx > 0 ? modelRef.slice(0, slashIdx) : "unknown");
  const modelId = resolved.modelId ?? (slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef);
  return {
    providerId,
    providerKind: resolved.providerKind ?? "openai-compatible",
    modelId,
    capabilities: resolved.capabilities ?? DEFAULT_CHAT_MODEL_CAPABILITIES,
    nativeTools: resolved.nativeTools ?? [],
  };
}

function getHttpErrorStatus(err: unknown): 400 | 500 {
  if (err && typeof err === "object" && (err as { status?: unknown }).status === 400) {
    return 400;
  }
  return 500;
}
