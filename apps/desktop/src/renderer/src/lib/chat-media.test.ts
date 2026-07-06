import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type ModelCapabilities, type ProviderInfo } from "@shared/types";
import {
  buildMediaGenerationRequest,
  buildMediaPendingMessage,
  buildMediaResultMessage,
  detectMediaIntent,
  getMediaCapableProviders,
  getTextGenerationProviders,
  parseMediaGenerationSettings,
  selectMediaModelRef,
} from "./chat-media";

const textCapabilities: ModelCapabilities = {
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

const mediaCapabilities: ModelCapabilities = {
  textGeneration: false,
  vision: false,
  imageOutput: true,
  speechOutput: true,
  transcription: true,
  videoOutput: true,
  toolCalling: false,
  reasoning: false,
  embedding: false,
};

void describe("chat media helpers", () => {
  void it("detects only high-confidence explicit media intents", () => {
    assert.equal(detectMediaIntent("generate an image of a glass city")?.kind, "image");
    assert.equal(detectMediaIntent("请生成视频：海边日落")?.kind, "video");
    assert.equal(detectMediaIntent("text to speech: hello")?.kind, "speech");
    assert.equal(
      detectMediaIntent("转录这个音频", [{ mediaType: "audio/mpeg" }])?.kind,
      "transcription",
    );
    assert.equal(detectMediaIntent("what do you think about images?"), null);
  });

  void it("filters text and media models by capability", () => {
    const providers = [provider()];
    assert.deepEqual(
      getTextGenerationProviders(providers)[0]?.models.map((model) => model.id),
      ["chat"],
    );
    assert.deepEqual(
      getMediaCapableProviders(providers, "image")[0]?.models.map((model) => model.id),
      ["media"],
    );
  });

  void it("builds media requests with selected capable defaults", () => {
    const providers = [provider()];
    const settings = parseMediaGenerationSettings(null);
    assert.equal(selectMediaModelRef(providers, settings, "image"), "mock/media");

    const image = buildMediaGenerationRequest({
      kind: "image",
      text: "  draw a quiet dashboard  ",
      files: [],
      providers,
      settings,
      options: { count: 2, size: "1024x1024" },
    });
    assert.deepEqual(image, {
      kind: "image",
      model: "mock/media",
      prompt: "draw a quiet dashboard",
      options: { size: "1024x1024", count: 2 },
    });

    const transcription = buildMediaGenerationRequest({
      kind: "transcription",
      text: "transcribe",
      files: [{ mediaType: "audio/wav", filename: "clip.wav", url: "data:audio/wav;base64,AA==" }],
      providers,
      settings,
    });
    assert.deepEqual(transcription, {
      kind: "transcription",
      model: "mock/media",
      audio: { url: "data:audio/wav;base64,AA==", mediaType: "audio/wav", filename: "clip.wav" },
      options: {},
    });
  });

  void it("builds assistant pending and result messages with file parts", () => {
    assert.deepEqual(buildMediaPendingMessage("a1", "image").metadata, {
      mediaGeneration: { kind: "image", status: "pending" },
    });

    const result = buildMediaResultMessage("a1", {
      kind: "speech",
      text: "Speech audio generated.",
      files: [
        {
          type: "file",
          mediaType: "audio/mpeg",
          filename: "speech.mp3",
          url: "void-media://asset/speech.mp3",
        },
      ],
    });

    assert.equal(result.role, "assistant");
    assert.deepEqual(result.parts, [
      { type: "text", text: "Speech audio generated." },
      {
        type: "file",
        mediaType: "audio/mpeg",
        filename: "speech.mp3",
        url: "void-media://asset/speech.mp3",
      },
    ]);
  });
});

function provider(): ProviderInfo {
  return {
    id: "mock",
    label: "Mock",
    kind: "openai-compatible",
    source: "custom",
    models: [
      {
        id: "chat",
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: textCapabilities,
        providerOptions: {},
      },
      {
        id: "media",
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: mediaCapabilities,
        providerOptions: {},
      },
    ],
    helpUrl: "https://example.com",
    hasApiKey: true,
  };
}
