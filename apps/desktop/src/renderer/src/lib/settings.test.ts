import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SettingKey } from "@shared/types";
import { parseSettings } from "./settings";

void describe("parseSettings", () => {
  void it("uses system language, default theme pack, and theme accent by default", () => {
    const settings = parseSettings({} as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.theme, "system");
    assert.equal(settings.themePreset, "default");
    assert.equal(settings.accentColor, "theme");
  });

  void it("keeps compatible legacy language and accent values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "zh-CN",
      [SettingKey.AccentColor]: "indigo",
    } as Record<string, string | null>);

    assert.equal(settings.language, "zh-CN");
    assert.equal(settings.accentColor, "indigo");
  });

  void it("rejects invalid enum values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "de-DE",
      [SettingKey.ThemePreset]: "unknown",
      [SettingKey.Theme]: "sepia",
      [SettingKey.AccentColor]: "not-a-color",
    } as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.themePreset, "default");
    assert.equal(settings.theme, "system");
    assert.equal(settings.accentColor, "theme");
  });
});
