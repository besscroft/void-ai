import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { animationForActivity, petFrameAt } from "./pet-animation";

void describe("Codex pet animation", () => {
  void it("maps semantic task activity to Codex animation rows", () => {
    assert.equal(animationForActivity("idle"), "idle");
    assert.equal(animationForActivity("sleeping"), "idle");
    assert.equal(animationForActivity("running"), "running");
    assert.equal(animationForActivity("needs_input"), "waiting");
    assert.equal(animationForActivity("ready"), "review");
    assert.equal(animationForActivity("blocked"), "failed");
  });

  void it("uses per-frame timing and a stable first frame for reduced motion", () => {
    assert.equal(petFrameAt("idle", 0, false), 0);
    assert.equal(petFrameAt("idle", 1_700, false), 1);
    assert.equal(petFrameAt("running", 130, false), 57);
    assert.equal(petFrameAt("running", 2_460, false), 0);
    assert.equal(petFrameAt("running", 4_160, false), 1);
    assert.equal(petFrameAt("running", 9_000, true), 56);
  });

  void it("supports custom Codex animation tracks", () => {
    const animations = { running: { frames: [7, 8], fps: 10, loop: true } };
    assert.equal(petFrameAt("running", 0, false, animations), 7);
    assert.equal(petFrameAt("running", 120, false, animations), 8);
    assert.equal(petFrameAt("running", 120, false, { running: { frames: [7, 8], fps: 0 } }), 7);
  });
});
