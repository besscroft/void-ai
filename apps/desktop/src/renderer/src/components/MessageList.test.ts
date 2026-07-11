import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { getMessageActivityStatus } from "./MessageList";

function assistant(parts: UIMessage["parts"]): UIMessage[] {
  return [{ id: "assistant", role: "assistant", parts }];
}

void describe("chat message activity", () => {
  void it("distinguishes submitted and reasoning states", () => {
    assert.equal(getMessageActivityStatus([], true, "submitted"), "submitted");
    assert.equal(
      getMessageActivityStatus(
        assistant([{ type: "reasoning", text: "private model reasoning" }]),
        true,
        "streaming",
      ),
      "thinking",
    );
  });

  void it("distinguishes tool execution, approval, and text output", () => {
    const toolBase = { type: "dynamic-tool", toolName: "search", toolCallId: "tool-1" };
    assert.equal(
      getMessageActivityStatus(
        assistant([{ ...toolBase, state: "input-available", input: {} } as never]),
        true,
        "streaming",
      ),
      "tool-calling",
    );
    assert.equal(
      getMessageActivityStatus(
        assistant([
          {
            ...toolBase,
            state: "approval-requested",
            input: {},
            approval: { id: "approval-1" },
          } as never,
        ]),
        true,
        "streaming",
      ),
      "waiting-approval",
    );
    assert.equal(
      getMessageActivityStatus(
        assistant([{ type: "text", text: "Streaming answer" }]),
        true,
        "streaming",
      ),
      "responding",
    );
  });

  void it("hides activity after generation completes", () => {
    assert.equal(
      getMessageActivityStatus(assistant([{ type: "text", text: "Done" }]), false, "ready"),
      null,
    );
  });
});
