import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_DESKTOP_PET_WINDOW,
  mergeDesktopPetConfig,
  moodFromAgentRuntimeStatus,
  normalizeDesktopPetConfig,
} from "../../shared/types";
import { clampDesktopPetBounds, moveDesktopPetBounds } from "./desktop-pet-bounds";

void describe("desktop pet config", () => {
  void it("normalizes the legacy prototype config shape", () => {
    const config = normalizeDesktopPetConfig({
      renderer: "transparent-window",
      mood: "memory-aware",
    });

    assert.equal(config.version, 1);
    assert.equal(config.agentId, DEFAULT_AGENT_ID);
    assert.equal(config.visual.variant, "void-orb");
    assert.deepEqual(config.window, DEFAULT_DESKTOP_PET_WINDOW);
  });

  void it("repairs invalid window values and keeps the dedicated conversation id", () => {
    const config = normalizeDesktopPetConfig({
      agentId: "child-agent",
      conversationId: "conv-pet",
      window: {
        x: 10.4,
        y: 20.6,
        width: 99,
        height: 9999,
        alwaysOnTop: false,
      },
    });

    assert.equal(config.agentId, DEFAULT_AGENT_ID);
    assert.equal(config.conversationId, "conv-pet");
    assert.equal(config.window.x, 10);
    assert.equal(config.window.y, 21);
    assert.equal(config.window.width, 240);
    assert.equal(config.window.height, 680);
    assert.equal(config.window.alwaysOnTop, false);
  });

  void it("merges nested window patches", () => {
    const current = normalizeDesktopPetConfig({
      conversationId: "conv-pet",
      window: { x: 100, y: 120, width: 320, height: 420, alwaysOnTop: true },
    });
    const next = mergeDesktopPetConfig(current, { window: { y: 260 } });

    assert.equal(next.window.x, 100);
    assert.equal(next.window.y, 260);
    assert.equal(next.window.width, 320);
    assert.equal(next.conversationId, "conv-pet");
  });

  void it("maps runtime status to desktop pet mood", () => {
    assert.equal(moodFromAgentRuntimeStatus("idle"), "idle");
    assert.equal(moodFromAgentRuntimeStatus("queued"), "thinking");
    assert.equal(moodFromAgentRuntimeStatus("tool_calling"), "working");
    assert.equal(moodFromAgentRuntimeStatus("learning"), "learning");
    assert.equal(moodFromAgentRuntimeStatus("failed"), "error");
  });
});

void describe("desktop pet bounds", () => {
  void it("defaults to the lower-right corner of the fallback display", () => {
    const config = normalizeDesktopPetConfig({});
    const bounds = clampDesktopPetBounds(config, [], { x: 0, y: 0, width: 1440, height: 900 });

    assert.deepEqual(bounds, {
      x: 1440 - DEFAULT_DESKTOP_PET_WINDOW.width - 24,
      y: 900 - DEFAULT_DESKTOP_PET_WINDOW.height - 24,
      width: DEFAULT_DESKTOP_PET_WINDOW.width,
      height: DEFAULT_DESKTOP_PET_WINDOW.height,
    });
  });

  void it("clamps an off-screen saved position into the active display", () => {
    const config = normalizeDesktopPetConfig({
      window: { x: 2000, y: -400, width: 320, height: 420, alwaysOnTop: true },
    });
    const bounds = clampDesktopPetBounds(config, [{ x: 0, y: 0, width: 1280, height: 720 }], {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });

    assert.deepEqual(bounds, { x: 960, y: 0, width: 320, height: 420 });
  });

  void it("moves the current window bounds by a delta and clamps to the active display", () => {
    const config = normalizeDesktopPetConfig({
      window: { x: 100, y: 120, width: 320, height: 420, alwaysOnTop: true },
    });
    const display = { x: 0, y: 0, width: 1280, height: 720 };
    const bounds = moveDesktopPetBounds(
      config,
      { x: 960, y: 220, width: 320, height: 420 },
      { dx: 80, dy: -260 },
      [display],
      display,
    );

    assert.deepEqual(bounds, { x: 960, y: 0, width: 320, height: 420 });
  });
});
