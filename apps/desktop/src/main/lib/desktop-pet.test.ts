import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  DEFAULT_DESKTOP_PET_WINDOW,
  DESKTOP_PET_WINDOW_SIZE,
  mergeDesktopPetConfig,
  normalizeDesktopPetConfig,
  type RuntimeRun,
} from "../../shared/types";
import { clampDesktopPetBounds, moveDesktopPetBounds } from "./desktop-pet-bounds";
import {
  applyDesktopPetIdleTimeout,
  DESKTOP_PET_SLEEP_AFTER_MS,
  resolveDesktopPetActivity,
} from "./desktop-pet-activity";
import {
  buildStorePetsUrl,
  readPackageArchive,
  resolveStoreDownloadUrl,
  validateManifest,
  validateSpritesheet,
} from "./desktop-pet-assets";

void describe("desktop pet config", () => {
  void it("normalizes the legacy prototype config shape", () => {
    const config = normalizeDesktopPetConfig({
      renderer: "transparent-window",
      mood: "memory-aware",
    });

    assert.equal(config.version, 2);
    assert.equal(config.selectedPet, "builtin:paimon");
    assert.deepEqual(config.acknowledgedRunIds, []);
    assert.deepEqual(config.window, DEFAULT_DESKTOP_PET_WINDOW);
  });

  void it("migrates only legacy position and always-on-top window values", () => {
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

    assert.equal(config.selectedPet, "builtin:paimon");
    assert.equal(config.window.x, 10);
    assert.equal(config.window.y, 21);
    assert.equal("width" in config.window, false);
    assert.equal("height" in config.window, false);
    assert.equal(config.window.alwaysOnTop, false);
  });

  void it("normalizes selectors and bounded acknowledgement history", () => {
    const config = normalizeDesktopPetConfig({
      selectedPet: "installed:chefito",
      acknowledgedRunIds: ["run-1", 1, "", "run-2"],
    });
    assert.equal(config.selectedPet, "installed:chefito");
    assert.deepEqual(config.acknowledgedRunIds, ["run-1", "run-2"]);
    assert.equal(
      normalizeDesktopPetConfig({ selectedPet: "installed:paimon" }).selectedPet,
      "builtin:paimon",
    );
    assert.equal(
      normalizeDesktopPetConfig({ selectedPet: "builtin:codex" }).selectedPet,
      "builtin:paimon",
    );
  });

  void it("merges nested window patches", () => {
    const current = normalizeDesktopPetConfig({
      window: { x: 100, y: 120, width: 320, height: 420, alwaysOnTop: true },
    });
    const next = mergeDesktopPetConfig(current, {
      selectedPet: "installed:tiny-duck",
      window: { y: 260 },
    });

    assert.equal(next.window.x, 100);
    assert.equal(next.window.y, 260);
    assert.equal(next.window.alwaysOnTop, true);
    assert.equal(next.selectedPet, "installed:tiny-duck");
  });

  void it("validates Codex V1 and V2 manifests and spritesheet geometry", () => {
    const manifest = validateManifest({
      id: "tiny-duck",
      displayName: "Tiny Duck",
      description: "A tidy test duck.",
      spritesheetPath: "spritesheet.webp",
      spriteVersionNumber: 2,
    });
    assert.equal(manifest.id, "tiny-duck");
    assert.equal(validateSpritesheet(webpHeader(1536, 2288), 2), 2);
    assert.equal(validateSpritesheet(webpHeader(1536, 1872)), 1);
  });

  void it("ships the single built-in Paimon spritesheet as a valid V1 asset", () => {
    const asset = readFileSync(
      join(process.cwd(), "resources", "pets", "paimon", "spritesheet.webp"),
    );
    assert.equal(validateSpritesheet(asset, 1), 1);
  });

  void it("extracts only required ZIP files from a single wrapper directory", () => {
    const archive = zipSync({
      "tiny-duck/pet.json": strToU8("{}"),
      "tiny-duck/spritesheet.webp": webpHeader(1536, 1872),
      "tiny-duck/ignored.bin": new Uint8Array(512 * 1024),
    });
    const files = readPackageArchive(archive);
    assert.equal(new TextDecoder().decode(files.manifest), "{}");
    assert.deepEqual(files.spritesheet, webpHeader(1536, 1872));
  });

  void it("rejects ZIP traversal and oversized required entries before extraction", () => {
    const traversal = zipSync({
      "../pet.json": strToU8("{}"),
      "spritesheet.webp": webpHeader(1536, 1872),
    });
    assert.throws(() => readPackageArchive(traversal), /unsafe path|root or inside one folder/);

    const oversized = zipSync({
      "pet.json": new Uint8Array(64 * 1024 + 1),
      "spritesheet.webp": webpHeader(1536, 1872),
    });
    assert.throws(() => readPackageArchive(oversized), /pet\.json is too large/);
  });

  void it("accepts only the same-origin store download endpoint", () => {
    assert.equal(
      resolveStoreDownloadUrl("tiny-duck", "/api/pets/tiny-duck/download?v=2").toString(),
      "https://codex-pets.net/api/pets/tiny-duck/download?v=2",
    );
    assert.throws(
      () => resolveStoreDownloadUrl("tiny-duck", "https://example.com/api/pets/tiny-duck/download"),
      /unsafe download URL/,
    );
    assert.throws(
      () => resolveStoreDownloadUrl("tiny-duck", "/api/pets/tiny-duck/download-backup"),
      /unsafe download URL/,
    );
  });

  void it("always forces safe content mode for store queries", () => {
    const url = buildStorePetsUrl({
      query: "duck",
      page: 2,
      pageSize: 20,
      sort: "popular",
      kind: "animal",
      format: "v2",
    });
    assert.equal(url.origin, "https://codex-pets.net");
    assert.equal(url.searchParams.get("content"), "safe");
    assert.equal(url.searchParams.get("q"), "duck");
    assert.equal(url.searchParams.get("format"), "v2");
  });
});

void describe("desktop pet activity", () => {
  void it("prioritizes main-agent input, blocked, ready, then running and ignores child roots", () => {
    const runs = [
      runtimeRun("child", "running", "agent-child"),
      runtimeRun("running", "running"),
      runtimeRun("ready", "succeeded"),
      runtimeRun("blocked", "failed"),
      runtimeRun("input", "waiting_approval"),
    ];
    const resolved = resolveDesktopPetActivity(runs, []);
    assert.equal(resolved.activity.runId, "input");
    assert.equal(resolved.activity.kind, "needs_input");
    assert.equal(resolved.pendingCount, 4);
  });

  void it("removes acknowledged terminal runs from the candidate set", () => {
    const resolved = resolveDesktopPetActivity(
      [runtimeRun("ready", "succeeded"), runtimeRun("running", "running")],
      ["ready"],
    );
    assert.equal(resolved.activity.kind, "running");
  });

  void it("enters sleep only after 60 seconds of continuous idle time", () => {
    const idle = resolveDesktopPetActivity([], []).activity;
    assert.equal(
      applyDesktopPetIdleTimeout(idle, 1_000, 1_000 + DESKTOP_PET_SLEEP_AFTER_MS - 1).kind,
      "idle",
    );
    assert.equal(
      applyDesktopPetIdleTimeout(idle, 1_000, 1_000 + DESKTOP_PET_SLEEP_AFTER_MS).kind,
      "sleeping",
    );
    const running = resolveDesktopPetActivity([runtimeRun("running", "running")], []).activity;
    assert.equal(
      applyDesktopPetIdleTimeout(running, 0, DESKTOP_PET_SLEEP_AFTER_MS * 2).kind,
      "running",
    );
  });
});

function runtimeRun(
  id: string,
  status: RuntimeRun["status"],
  rootAgentId = "agent-void",
): RuntimeRun {
  return {
    id,
    conversation_id: `conversation-${id}`,
    root_agent_id: rootAgentId,
    final_agent_id: rootAgentId,
    status,
    model_ref: null,
    started_at: Date.now(),
    finished_at: status === "running" ? null : Date.now(),
    trace_id: null,
    input_summary: id,
    output_summary: null,
    error: status === "failed" ? "failed" : null,
    usage_json: null,
  };
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes[16] = 10;
  const write24 = (offset: number, value: number): void => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  write24(24, width - 1);
  write24(27, height - 1);
  return bytes;
}

void describe("desktop pet bounds", () => {
  void it("defaults to the lower-right corner of the fallback display", () => {
    const config = normalizeDesktopPetConfig({});
    const bounds = clampDesktopPetBounds(config, [], { x: 0, y: 0, width: 1440, height: 900 });

    assert.deepEqual(bounds, {
      x: 1440 - DESKTOP_PET_WINDOW_SIZE.width - 24,
      y: 900 - DESKTOP_PET_WINDOW_SIZE.height - 24,
      width: DESKTOP_PET_WINDOW_SIZE.width,
      height: DESKTOP_PET_WINDOW_SIZE.height,
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

    assert.deepEqual(bounds, {
      x: 1280 - DESKTOP_PET_WINDOW_SIZE.width,
      y: 0,
      width: DESKTOP_PET_WINDOW_SIZE.width,
      height: DESKTOP_PET_WINDOW_SIZE.height,
    });
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
