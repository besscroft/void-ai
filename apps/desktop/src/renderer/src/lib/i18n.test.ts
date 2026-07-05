import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFormatters, resolveLanguage, translate } from "./i18n";
import { en, zhCN } from "./i18n.messages";

void describe("messages", () => {
  void it("keeps zh-CN and en dictionaries in key parity", () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zhCN).sort());
  });
});

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

void describe("translate", () => {
  void it("translates and interpolates without React context", () => {
    assert.equal(translate("en", "trash.selectedCount", { count: 3 }), "3 selected");
    assert.equal(translate("zh-CN", "trash.selectedCount", { count: 3 }), "已选择 3 项");
  });

  void it("falls back to the key for unknown messages", () => {
    assert.equal(translate("en", "missing.key"), "missing.key");
  });
});

void describe("createFormatters", () => {
  void it("formats numbers and compact numbers for the active locale", () => {
    const zh = createFormatters("zh-CN");
    const enUS = createFormatters("en");

    assert.equal(enUS.number(1234567.89), "1,234,567.89");
    assert.match(zh.compactNumber(1234567), /万/);
    assert.match(enUS.compactNumber(1234567), /M/);
  });

  void it("formats dates and file sizes through Intl", () => {
    const date = new Date(Date.UTC(2026, 0, 2, 3, 4));
    const zh = createFormatters("zh-CN");
    const enUS = createFormatters("en");

    assert.match(
      zh.dateTime(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
      /2026年1月2日/,
    );
    assert.match(
      enUS.dateTime(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
      /January 2, 2026/,
    );
    assert.equal(zh.bytes(1536), "1.5 KB");
    assert.equal(enUS.bytes(1536), "1.5 KB");
  });
});
