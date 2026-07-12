import type { FileUIPart, UIMessage } from "ai";
import {
  DEFAULT_MEDIA_GENERATION_SETTINGS,
  type MediaGenerationKind,
  type MediaGenerationKindSettings,
  type MediaGenerationOptions,
  type MediaGenerationRequest,
  type MediaGenerationResponse,
  type MediaGenerationSettings,
  type ProviderInfo,
} from "@shared/types";

export const MEDIA_GENERATION_KINDS: readonly MediaGenerationKind[] = [
  "image",
  "speech",
  "transcription",
  "video",
];

export interface MediaFileInput {
  mediaType?: string;
  filename?: string;
  url?: string;
  data?: string;
}

export interface MediaGenerationSelection {
  kind: MediaGenerationKind;
  modelRef?: string | null;
  options?: MediaGenerationOptions;
}

export interface MediaIntent {
  kind: MediaGenerationKind;
  confidence: "high";
  source: "rule";
}

/**
 * 匹配"中英双语意图"模式。
 * - englishWords: 用于英文 \b...\b 模式（不区分大小写由调用方传入小写字符串）
 * - chineseWords: 用于中文直接字面量
 * - englishBidirectional: true 时英文也匹配 B.*A 语序（默认），false 时仅匹配 A.*B
 */
function matchIntent(
  lower: string,
  normalized: string,
  englishWords: { action: string; target: string },
  chineseWords: { action: string; target: string },
  englishBidirectional = true,
): boolean {
  const enA = new RegExp(`\\b(?:${englishWords.action})\\b.*\\b(?:${englishWords.target})\\b`);
  const enB = new RegExp(`\\b(?:${englishWords.target})\\b.*\\b(?:${englishWords.action})\\b`);
  const zhA = new RegExp(`(?:${chineseWords.action}).*(?:${chineseWords.target})`);
  const zhB = new RegExp(`(?:${chineseWords.target}).*(?:${chineseWords.action})`);
  const enMatched = englishBidirectional ? enA.test(lower) || enB.test(lower) : enA.test(lower);
  return enMatched || zhA.test(normalized) || zhB.test(normalized);
}

export function detectMediaIntent(
  text: string,
  files: readonly MediaFileInput[] = [],
): MediaIntent | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const hasAudio = files.some((file) => isAudio(file.mediaType));

  if (
    /\b(transcribe|transcription|speech to text|audio to text)\b/.test(lower) ||
    /(转录|听写|语音识别|音频识别|识别音频|识别语音)/.test(normalized)
  ) {
    return { kind: "transcription", confidence: "high", source: "rule" };
  }

  if (
    matchIntent(
      lower,
      normalized,
      { action: "generate|create|make|render", target: "video|movie|clip|animation" },
      { action: "生成|创建|制作", target: "视频|短片|动画" },
    )
  ) {
    return { kind: "video", confidence: "high", source: "rule" };
  }

  // 语音类意图：英文只匹配"动作在前"的语序（如 "text to speech"、"generate speech"），
  // 因为语音的动作短语大多不可拆解成 A+B（target 通常是动作短语的一部分）。
  if (
    /\b(text to speech|tts|read aloud|voice over|generate speech|generate audio|synthesize speech)\b/.test(
      lower,
    ) ||
    matchIntent(
      lower,
      normalized,
      {
        action: "generate|create|make|synthesize|read",
        target: "speech|audio|voice|narration",
      },
      { action: "生成|合成|朗读|读出", target: "语音|音频|旁白|声音" },
      false,
    )
  ) {
    return { kind: "speech", confidence: "high", source: "rule" };
  }

  if (
    matchIntent(
      lower,
      normalized,
      {
        action: "generate|create|make|draw|paint|render",
        target: "image|picture|photo|poster|illustration|logo",
      },
      { action: "生成|创建|制作|画|绘制", target: "图片|图像|照片|海报|插画|标志|logo" },
    )
  ) {
    return { kind: "image", confidence: "high", source: "rule" };
  }

  if (hasAudio && /(转文字|转成文字|转为文字)/.test(normalized)) {
    return { kind: "transcription", confidence: "high", source: "rule" };
  }

  return null;
}

export function parseMediaGenerationSettings(
  raw: string | null | undefined,
): MediaGenerationSettings {
  if (!raw) return cloneDefaultMediaSettings();
  try {
    return normalizeMediaGenerationSettings(JSON.parse(raw) as unknown);
  } catch {
    return cloneDefaultMediaSettings();
  }
}

export function normalizeMediaGenerationSettings(value: unknown): MediaGenerationSettings {
  const source =
    value && typeof value === "object" ? (value as Partial<MediaGenerationSettings>) : {};
  const defaults = cloneDefaultMediaSettings().defaults;
  const rawDefaults =
    source.defaults && typeof source.defaults === "object"
      ? (source.defaults as Partial<
          Record<MediaGenerationKind, Partial<MediaGenerationKindSettings>>
        >)
      : {};

  for (const kind of MEDIA_GENERATION_KINDS) {
    const raw = rawDefaults[kind];
    defaults[kind] = {
      modelRef: normalizeOptionalString(raw?.modelRef) ?? null,
      options: normalizeMediaOptions(raw?.options),
    };
  }

  return { version: 1, defaults };
}

export function serializeMediaGenerationSettings(settings: MediaGenerationSettings): string {
  return JSON.stringify(normalizeMediaGenerationSettings(settings));
}

export function getMediaCapableProviders(
  providers: readonly ProviderInfo[],
  kind: MediaGenerationKind,
): ProviderInfo[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => model.enabled && modelSupportsMediaKind(model, kind),
      ),
    }))
    .filter((provider) => provider.models.length > 0);
}

export function getTextGenerationProviders(providers: readonly ProviderInfo[]): ProviderInfo[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => model.enabled && model.capabilities.textGeneration !== false,
      ),
    }))
    .filter((provider) => provider.models.length > 0);
}

export function selectMediaModelRef(
  providers: readonly ProviderInfo[],
  settings: MediaGenerationSettings,
  kind: MediaGenerationKind,
): string | null {
  const configured = settings.defaults[kind]?.modelRef;
  if (configured && mediaModelRefExists(providers, configured, kind)) return configured;
  const provider = getMediaCapableProviders(providers, kind)[0];
  const model = provider?.models[0];
  return provider && model ? `${provider.id}/${model.id}` : null;
}

export function buildMediaGenerationRequest({
  kind,
  text,
  files,
  providers,
  settings,
  modelRef,
  options,
}: {
  kind: MediaGenerationKind;
  text: string;
  files: readonly MediaFileInput[];
  providers: readonly ProviderInfo[];
  settings: MediaGenerationSettings;
  modelRef?: string | null;
  options?: MediaGenerationOptions;
}): MediaGenerationRequest {
  const resolvedModel =
    modelRef && mediaModelRefExists(providers, modelRef, kind)
      ? modelRef
      : selectMediaModelRef(providers, settings, kind);
  if (!resolvedModel) throw new Error(`No ${mediaKindLabel(kind)} model is available.`);
  const mergedOptions = compactMediaOptions(kind, {
    ...settings.defaults[kind]?.options,
    ...options,
  });
  const trimmedText = text.trim();

  switch (kind) {
    case "image":
      if (!trimmedText) throw new Error("Image prompt is required.");
      return { kind, model: resolvedModel, prompt: trimmedText, options: mergedOptions };
    case "speech":
      if (!trimmedText) throw new Error("Speech text is required.");
      return { kind, model: resolvedModel, text: trimmedText, options: mergedOptions };
    case "transcription": {
      const audio = files.find((file) => isAudio(file.mediaType) && (file.url || file.data));
      if (!audio) throw new Error("An audio attachment is required for transcription.");
      return {
        kind,
        model: resolvedModel,
        audio: {
          url: audio.url ?? audio.data ?? "",
          mediaType: audio.mediaType,
          filename: audio.filename,
        },
        options: mergedOptions,
      };
    }
    case "video":
      if (!trimmedText) throw new Error("Video prompt is required.");
      return { kind, model: resolvedModel, prompt: trimmedText, options: mergedOptions };
  }
}

export function buildMediaPendingMessage(
  id: string,
  kind: MediaGenerationKind,
  selection?: MediaGenerationSelection,
): UIMessage {
  return {
    id,
    role: "assistant",
    metadata: { mediaGeneration: buildMediaGenerationMetadata(kind, "pending", selection) },
    parts: [{ type: "text", text: `Generating ${mediaKindLabel(kind)}...` }],
  };
}

export function buildMediaResultMessage(id: string, response: MediaGenerationResponse): UIMessage {
  const fileParts: FileUIPart[] = response.files.map((file) => ({
    type: "file",
    mediaType: file.mediaType,
    filename: file.filename,
    url: file.url,
  }));
  const parts: UIMessage["parts"] = [];
  if (response.text.trim()) parts.push({ type: "text", text: response.text.trim() });
  parts.push(...fileParts);
  return {
    id,
    role: "assistant",
    metadata: {
      mediaGeneration: {
        kind: response.kind,
        status: "done",
        ...response.metadata,
      },
    },
    parts:
      parts.length > 0
        ? parts
        : [{ type: "text", text: `${mediaKindLabel(response.kind)} generated.` }],
  };
}

export function buildMediaErrorMessage(
  id: string,
  kind: MediaGenerationKind,
  error: string,
  selection?: MediaGenerationSelection,
): UIMessage {
  return {
    id,
    role: "assistant",
    metadata: { mediaGeneration: buildMediaGenerationMetadata(kind, "error", selection, error) },
    parts: [{ type: "text", text: `Media generation failed: ${error}` }],
  };
}

function buildMediaGenerationMetadata(
  kind: MediaGenerationKind,
  status: "pending" | "error",
  selection?: MediaGenerationSelection,
  error?: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { kind, status };
  if (error) metadata.error = error;
  if (selection?.modelRef) metadata.modelRef = selection.modelRef;
  if (selection?.options && Object.keys(selection.options).length > 0) {
    metadata.options = selection.options;
  }
  return metadata;
}

export function mediaKindLabel(kind: MediaGenerationKind): string {
  switch (kind) {
    case "image":
      return "image";
    case "speech":
      return "speech";
    case "transcription":
      return "transcription";
    case "video":
      return "video";
  }
}

function cloneDefaultMediaSettings(): MediaGenerationSettings {
  return {
    version: 1,
    defaults: {
      image: { modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.image.modelRef, options: {} },
      speech: { modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.speech.modelRef, options: {} },
      transcription: {
        modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.transcription.modelRef,
        options: {},
      },
      video: { modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.video.modelRef, options: {} },
    },
  };
}

function mediaModelRefExists(
  providers: readonly ProviderInfo[],
  modelRef: string,
  kind: MediaGenerationKind,
): boolean {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) return false;
  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);
  return providers.some(
    (provider) =>
      provider.id === providerId &&
      provider.models.some(
        (model) => model.id === modelId && model.enabled && modelSupportsMediaKind(model, kind),
      ),
  );
}

function modelSupportsMediaKind(
  model: ProviderInfo["models"][number],
  kind: MediaGenerationKind,
): boolean {
  switch (kind) {
    case "image":
      return model.capabilities.imageOutput;
    case "speech":
      return model.capabilities.speechOutput;
    case "transcription":
      return model.capabilities.transcription;
    case "video":
      return model.capabilities.videoOutput;
  }
}

function normalizeMediaOptions(value: unknown): MediaGenerationOptions {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const options: MediaGenerationOptions = {};
  setStringOption(options, "size", source.size);
  setStringOption(options, "aspectRatio", source.aspectRatio);
  setNumberOption(options, "count", source.count, true);
  setNumberOption(options, "seed", source.seed, true);
  setStringOption(options, "voice", source.voice);
  setStringOption(options, "outputFormat", source.outputFormat);
  setNumberOption(options, "speed", source.speed, false);
  setStringOption(options, "language", source.language);
  setStringOption(options, "instructions", source.instructions);
  setStringOption(options, "resolution", source.resolution);
  setNumberOption(options, "duration", source.duration, false);
  setNumberOption(options, "fps", source.fps, false);
  if (typeof source.generateAudio === "boolean") options.generateAudio = source.generateAudio;
  return options;
}

function compactMediaOptions(
  kind: MediaGenerationKind,
  value: MediaGenerationOptions,
): MediaGenerationOptions {
  const normalized = normalizeMediaOptions(value);
  switch (kind) {
    case "image":
      return pickDefined(normalized, ["size", "aspectRatio", "count", "seed"]);
    case "speech":
      return pickDefined(normalized, [
        "voice",
        "outputFormat",
        "speed",
        "language",
        "instructions",
      ]);
    case "transcription":
      return pickDefined(normalized, ["language"]);
    case "video":
      return pickDefined(normalized, [
        "aspectRatio",
        "resolution",
        "duration",
        "fps",
        "generateAudio",
        "count",
        "seed",
      ]);
  }
}

function pickDefined<K extends keyof MediaGenerationOptions>(
  value: MediaGenerationOptions,
  keys: readonly K[],
): Pick<MediaGenerationOptions, K> {
  const picked: Partial<Pick<MediaGenerationOptions, K>> = {};
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== "") picked[key] = value[key];
  }
  return picked as Pick<MediaGenerationOptions, K>;
}

function setStringOption<T extends keyof MediaGenerationOptions>(
  target: MediaGenerationOptions,
  key: T,
  value: unknown,
): void {
  const normalized = normalizeOptionalString(value);
  if (normalized !== undefined) (target as Record<string, unknown>)[key] = normalized;
}

function setNumberOption<T extends keyof MediaGenerationOptions>(
  target: MediaGenerationOptions,
  key: T,
  value: unknown,
  integer: boolean,
): void {
  if (value === undefined || value === null || value === "") return;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return;
  (target as Record<string, unknown>)[key] = integer ? Math.floor(numberValue) : numberValue;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAudio(mediaType: string | undefined): boolean {
  return !!mediaType && mediaType.startsWith("audio/");
}
