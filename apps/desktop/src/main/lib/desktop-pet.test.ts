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
    // 99 小于下限 128，被夹紧到 128；9999 大于上限 680，被夹紧到 680
    assert.equal(config.window.width, 128);
    assert.equal(config.window.height, 680);
    assert.equal(config.window.alwaysOnTop, false);
    assert.equal(config.window.scale, 1);
    assert.equal(config.window.opacity, 1);
    assert.equal(config.interaction.soundEnabled, false);
    assert.equal(config.interaction.autoSleepMs, 60_000);
  });

  void it("normalizes interaction patches (sound / autoSleep)", () => {
    const config = normalizeDesktopPetConfig({
      interaction: { soundEnabled: true, autoSleepMs: -1 },
    });
    assert.equal(config.interaction.soundEnabled, true);
    // 负值被夹紧到 0（禁用自动睡眠）
    assert.equal(config.interaction.autoSleepMs, 0);
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

  void it("moves the current window bounds by a delta", () => {
    const config = normalizeDesktopPetConfig({
      window: { x: 100, y: 120, width: 320, height: 420, alwaysOnTop: true },
    });
    const display = { x: 0, y: 0, width: 1280, height: 720 };
    // 起点 (960, 220)，拖动 (dx=80, dy=-260)：
    //   targetX = 960 + 80 = 1040
    //   targetY = 220 - 260 = -40
    //   minY = 0 - 420 + 50 = -370，targetY >= minY，所以不 clamp
    //   newY = -40（pet 顶部在屏幕外 40px，仍有 380px 可见）
    const bounds = moveDesktopPetBounds(
      config,
      { x: 960, y: 220, width: 320, height: 420 },
      { dx: 80, dy: -260 },
      [display],
      display,
    );

    assert.deepEqual(bounds, { x: 1040, y: -40, width: 320, height: 420 });
  });

  void it("allows the pet to be dragged past a screen edge while keeping KEEP_VISIBLE_PX on-screen", () => {
    // 屏幕 1280x720，pet 宽 320。pet 起点 (100, 100)，
    // 用户疯狂向右拖 dx=5000，pet 允许越过右边缘（1280-50=1230），
    // 但要保证 pet 左边至少保留 50px 在屏幕内。
    const config = normalizeDesktopPetConfig({
      window: { x: 100, y: 100, width: 320, height: 420, alwaysOnTop: true },
    });
    const display = { x: 0, y: 0, width: 1280, height: 720 };
    const bounds = moveDesktopPetBounds(
      config,
      { x: 100, y: 100, width: 320, height: 420 },
      { dx: 5000, dy: 0 },
      [display],
      display,
    );

    // maxX = 1280 - 50 = 1230（pet 左边到 1230，右边到 1550 越界 270px）
    assert.equal(bounds.x, 1230);
    // 至少有 KEEP_VISIBLE_PX(50) px 在屏幕内：
    // pet 左边 = 1230, 屏幕右 = 1280, 可见宽度 = 50 ✓
  });

  void it("does not let the pet be pushed completely off-screen", () => {
    const config = normalizeDesktopPetConfig({
      window: { x: 100, y: 100, width: 320, height: 420, alwaysOnTop: true },
    });
    const display = { x: 0, y: 0, width: 1280, height: 720 };
    // 不管 dx 多大，pet 永远不会完全跑出屏幕
    const bounds = moveDesktopPetBounds(
      config,
      { x: 100, y: 100, width: 320, height: 420 },
      { dx: 100000, dy: 100000 },
      [display],
      display,
    );

    // maxX = 1230, maxY = 670
    assert.equal(bounds.x, 1230);
    assert.equal(bounds.y, 670);
  });
});
