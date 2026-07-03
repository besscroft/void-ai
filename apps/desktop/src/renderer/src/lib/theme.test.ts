import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
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
    if (name === "data-density") this.dataset.density = value;
  }

  removeAttribute(name: string): void {
    if (name === "data-theme") delete this.dataset.theme;
    if (name === "data-theme-preset") delete this.dataset.themePreset;
    if (name === "data-density") delete this.dataset.density;
  }
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

  void it("syncs HeroUI theme attributes and app appearance settings", () => {
    const resolved = applyTheme({
      theme: "dark",
      themePreset: "ocean",
      accentColor: "theme",
      fontSize: "lg",
      density: "compact",
    });

    assert.equal(resolved, "dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(root.dataset.themePreset, "ocean");
    assert.equal(root.classList.contains("dark"), true);
    assert.equal(root.classList.contains("light"), false);
    assert.equal(root.dataset.density, "compact");
    assert.equal(root.style.fontSize, "16px");
  });

  void it("resolves system theme and clears custom accent when using theme default", () => {
    root = installDom(true);

    applyTheme({
      theme: "light",
      themePreset: "forest",
      accentColor: "#123456",
      fontSize: "base",
      density: "comfortable",
    });
    assert.equal(root.style.getPropertyValue("--accent"), "#123456");

    const resolved = applyTheme({
      theme: "system",
      themePreset: "forest",
      accentColor: "theme",
      fontSize: "base",
      density: "comfortable",
    });

    assert.equal(resolved, "dark");
    assert.equal(root.style.getPropertyValue("--accent"), "");
    assert.equal(root.style.getPropertyValue("--accent-foreground"), "");
  });
});
