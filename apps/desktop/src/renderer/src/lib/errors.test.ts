import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getChatErrorMessage, getErrorMessage } from "./errors";

void describe("chat error helpers", () => {
  void it("maps browser fetch failures to a local service message", () => {
    assert.equal(
      getChatErrorMessage(new TypeError("Failed to fetch"), "en"),
      "Could not reach the local chat service. Wait a few seconds and retry, or restart the app.",
    );
  });

  void it("extracts JSON response bodies and status codes", () => {
    const error = new Error("") as Error & { responseBody: string; statusCode: number };
    error.responseBody = JSON.stringify({ error: "model is required in provider/model format" });
    error.statusCode = 400;

    assert.equal(getErrorMessage(error), "[400] model is required in provider/model format");
    assert.equal(
      getChatErrorMessage(error, "en"),
      "No available model is selected. Choose or configure a model first.",
    );
  });

  void it("keeps ordinary error details when no chat-specific mapping applies", () => {
    assert.equal(
      getChatErrorMessage(new Error("Provider API key is missing"), "en"),
      "Provider API key is missing",
    );
  });
});
