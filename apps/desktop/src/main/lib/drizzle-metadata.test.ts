import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

void describe("drizzle metadata", () => {
  void it("keeps migration metadata as parseable BOM-free JSON", () => {
    const metadataDir = path.join(process.cwd(), "drizzle", "meta");
    const files = readdirSync(metadataDir).filter((file) => file.endsWith(".json"));

    assert.ok(files.length > 0, "expected drizzle metadata JSON files");
    for (const file of files) {
      const bytes = readFileSync(path.join(metadataDir, file));
      const content = bytes.toString("utf8");

      assert.notEqual(bytes[0], 0xef, `${file} starts with a UTF-8 BOM`);
      assert.notEqual(content.charCodeAt(0), 0xfeff, `${file} starts with a UTF-8 BOM`);
      assert.doesNotThrow(() => JSON.parse(content), `${file} must be valid JSON`);
    }
  });

  void it("removes only the three legacy memory-file mirrors", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0005_remove_memory_file_mirrors.sql"),
      "utf8",
    );

    assert.match(migration, /file-soul/);
    assert.match(migration, /file-user/);
    assert.match(migration, /file-memory/);
    assert.match(migration, /WHERE `id` IN/);
  });
});
