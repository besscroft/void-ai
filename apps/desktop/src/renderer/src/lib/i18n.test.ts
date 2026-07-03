import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLanguage } from "./i18n";

void describe("resolveLanguage", () => {
  void it("resolves system locale to supported languages", () => {
    assert.equal(resolveLanguage("system", "zh-CN"), "zh-CN");
    assert.equal(resolveLanguage("system", "zh-Hans"), "zh-CN");
    assert.equal(resolveLanguage("system", "en-US"), "en");
  });

  void it("falls back unsupported system locales to English", () => {
    assert.equal(resolveLanguage("system", "fr-FR"), "en");
    assert.equal(resolveLanguage("system", null), "en");
  });

  void it("keeps explicit user choices", () => {
    assert.equal(resolveLanguage("zh-CN", "en-US"), "zh-CN");
    assert.equal(resolveLanguage("en", "zh-CN"), "en");
  });
});
