import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_REASONING_LEVELS, SettingKey } from "@shared/types";
import { parseSettings } from "./settings";

void describe("parseSettings", () => {
  void it("uses system language, default theme pack, and mira style by default", () => {
    const settings = parseSettings({} as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.theme, "system");
    assert.equal(settings.themePreset, "default");
    assert.equal(settings.style, "mira");
    assert.equal(settings.chatReasoningLevel, "provider-default");
  });

  void it("keeps explicit language and style values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "zh-CN",
      [SettingKey.Style]: "nova",
    } as Record<string, string | null>);

    assert.equal(settings.language, "zh-CN");
    assert.equal(settings.style, "nova");
  });

  void it("rejects invalid enum values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "de-DE",
      [SettingKey.ThemePreset]: "unknown",
      [SettingKey.Theme]: "sepia",
      [SettingKey.Style]: "not-a-style",
      [SettingKey.ChatReasoningLevel]: "maximum",
    } as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.themePreset, "default");
    assert.equal(settings.theme, "system");
    assert.equal(settings.style, "mira");
    assert.equal(settings.chatReasoningLevel, "provider-default");
  });

  void it("keeps every supported chat reasoning level", () => {
    for (const level of CHAT_REASONING_LEVELS) {
      const settings = parseSettings({
        [SettingKey.ChatReasoningLevel]: level,
      } as Record<string, string | null>);

      assert.equal(settings.chatReasoningLevel, level);
    }
  });
});
