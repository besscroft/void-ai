import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getChatErrorMessage, getErrorMessage } from "./errors";

void describe("chat error helpers", () => {
  void it("maps browser fetch failures to a local service message", () => {
    assert.equal(
      getChatErrorMessage(new TypeError("Failed to fetch"), "en"),
      "Unable to connect to the local chat service. Wait a few seconds and try again, or restart the app.",
    );
    assert.equal(
      getChatErrorMessage(new TypeError("Failed to fetch"), "zh-CN"),
      "无法连接到本地聊天服务。请稍等几秒后重试，或重启应用。",
    );
  });

  void it("extracts JSON response bodies and maps chat validation errors", () => {
    const error = new Error("") as Error & { responseBody: string; statusCode: number };
    error.responseBody = JSON.stringify({ error: "model is required in provider/model format" });
    error.statusCode = 400;

    assert.equal(getErrorMessage(error, "zh-CN"), "还没有选择可用模型。请先选择或配置一个模型。");
    assert.equal(
      getChatErrorMessage(error, "en"),
      "No available model is selected. Choose or configure a model first.",
    );
  });

  void it("maps provider validation errors in both languages", () => {
    assert.equal(
      getErrorMessage(new Error("Base URL must start with http:// or https://"), "en"),
      "Base URL must start with http:// or https://",
    );
    assert.equal(
      getErrorMessage(new Error("Base URL must start with http:// or https://"), "zh-CN"),
      "Base URL 必须以 http:// 或 https:// 开头",
    );
    assert.equal(
      getErrorMessage(new Error("Unknown provider: openrouter"), "en"),
      "Unknown provider: openrouter",
    );
    assert.equal(
      getErrorMessage(new Error("Unknown provider: openrouter"), "zh-CN"),
      "未知服务商：openrouter",
    );
  });

  void it("adds localized context for server failures while keeping raw details", () => {
    const error = new Error("database locked") as Error & { statusCode: number };
    error.statusCode = 500;

    assert.equal(
      getChatErrorMessage(error, "en"),
      "The local chat service failed to process the request. database locked",
    );
    assert.equal(getChatErrorMessage(error, "zh-CN"), "本地聊天服务处理失败。 database locked");
  });

  void it("keeps ordinary error details when no chat-specific mapping applies", () => {
    assert.equal(
      getChatErrorMessage(new Error("Provider API key is missing"), "en"),
      "Provider API key is missing",
    );
    assert.equal(
      getErrorMessage(new Error("Something very specific happened"), "zh-CN"),
      "Something very specific happened",
    );
  });
});
