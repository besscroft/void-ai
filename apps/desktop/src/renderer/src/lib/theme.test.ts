import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { applyTheme } from "./theme";

class FakeStyle {
  private readonly values = new Map<string, string>();
  fontSize = "";

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? "";
    this.values.delete(name);
    return previous;
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }
}

class FakeClassList {
  private readonly values = new Set<string>();

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeDocumentElement {
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList();

  setAttribute(name: string, value: string): void {
    if (name === "data-theme") this.dataset.theme = value;
    if (name === "data-theme-preset") this.dataset.themePreset = value;
    if (name === "data-style") this.dataset.style = value;
    if (name === "data-density") this.dataset.density = value;
  }

  removeAttribute(name: string): void {
    if (name === "data-theme") delete this.dataset.theme;
    if (name === "data-theme-preset") delete this.dataset.themePreset;
    if (name === "data-style") delete this.dataset.style;
    if (name === "data-density") delete this.dataset.density;
  }
}

function themeSettings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function installDom(matches: boolean): FakeDocumentElement {
  const documentElement = new FakeDocumentElement();
  const globals = globalThis as unknown as {
    document: { documentElement: FakeDocumentElement };
    window: { matchMedia: () => { matches: boolean } };
  };
  globals.document = { documentElement };
  globals.window = { matchMedia: () => ({ matches }) };
  return documentElement;
}

void describe("applyTheme", () => {
  let root: FakeDocumentElement;

  beforeEach(() => {
    root = installDom(false);
  });

  void it("syncs app theme attributes and appearance settings", () => {
    const resolved = applyTheme(
      themeSettings({
        theme: "dark",
        themePreset: "ocean",
        style: "mira",
        fontSize: "lg",
        density: "compact",
      }),
    );

    assert.equal(resolved, "dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(root.dataset.themePreset, "ocean");
    assert.equal(root.dataset.style, "mira");
    assert.equal(root.classList.contains("dark"), true);
    assert.equal(root.classList.contains("light"), false);
    assert.equal(root.dataset.density, "compact");
    assert.equal(root.style.getPropertyValue("--style-radius"), "12px");
    assert.equal(root.style.fontSize, "16px");
  });

  void it("updates style radius when switching visual styles", () => {
    applyTheme(
      themeSettings({
        theme: "light",
        themePreset: "forest",
        style: "vega",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.style.getPropertyValue("--style-radius"), "10px");
    assert.equal(root.dataset.style, "vega");

    applyTheme(
      themeSettings({
        theme: "light",
        themePreset: "forest",
        style: "mira",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.style.getPropertyValue("--style-radius"), "12px");
    assert.equal(root.dataset.style, "mira");
  });

  // 回归测试：Tailwind v4 编译的 rounded-md/lg/xl/2xl 引用的是具名变量 --radius-md/lg/xl/2xl，
  // 而 shadcn 的 tailwind.css 只在 @layer theme 内把它们硬编码为固定值。
  // main.css 必须在 unlayered :root 里把这些变量桥接到 var(--radius)，
  // 否则切换风格时 --style-radius 改了但所有 rounded-* 元素不变。
  void it("main.css 在 :root 中把 --radius-{sm,md,lg,xl,2xl} 桥接到 var(--radius)", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../assets/main.css"), "utf8");
    const rootBlock = css.match(/:root\s*\{[\s\S]*?\n\}/);
    assert.ok(rootBlock, "未找到 :root 块");
    const block = rootBlock[0];
    // sm/md/xl/2xl 形如 calc(var(--radius) ± Npx)，lg 形如 var(--radius)。
    for (const name of [
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--radius-xl",
      "--radius-2xl",
    ]) {
      const re = new RegExp(`${name}\\s*:\\s*[^;]*var\\(--radius\\)`);
      assert.match(block, re, `${name} 必须基于 var(--radius) 派生`);
    }
  });
});
