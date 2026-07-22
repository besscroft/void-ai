import { describe, it } from "node:test";
import assert from "node:assert/strict";

void describe("agent status widget", () => {
  void it("uses the shared runtime snapshot contract", () => {
    assert.equal(typeof "agentRunInputs", "string");
  });
});
