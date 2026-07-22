import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { describe, it } from "node:test";
import { assertCognitiveMemorySchema, isRecoverableSchemaInitError } from "./schema-init";

function createMemorySchema(options?: {
  includeMem0Id?: boolean;
  includeIdempotencyKey?: boolean;
  includeObservations?: boolean;
}): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  const mem0Columns = options?.includeMem0Id
    ? ", mem0_id text, sync_status text NOT NULL DEFAULT 'pending', strength integer NOT NULL DEFAULT 70, last_reinforced_at integer"
    : "";
  const idempotencyColumn =
    options?.includeIdempotencyKey === false ? "" : ", idempotency_key text";
  const observationsTable =
    options?.includeObservations === false
      ? ""
      : "CREATE TABLE memory_observations (id text PRIMARY KEY NOT NULL);";

  database.exec(`
    CREATE TABLE memories (id text PRIMARY KEY NOT NULL${mem0Columns});
    CREATE TABLE memory_jobs (id text PRIMARY KEY NOT NULL${idempotencyColumn});
    ${observationsTable}
  `);
  return database;
}

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

  void it("tracks only the consolidated initial migration", () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    assert.equal(journal.entries.length, 1);
    assert.equal(journal.entries[0]?.idx, 0);
    assert.equal(journal.entries[0]?.tag, "0000_initial");
  });

  void it("recognizes recoverable schema errors wrapped by Drizzle", () => {
    const wrapped = new Error("Failed to run the query 'CREATE TABLE `agent_instances`'", {
      cause: new Error("table `agent_instances` already exists"),
    });

    assert.equal(isRecoverableSchemaInitError(wrapped), true);
    assert.equal(
      isRecoverableSchemaInitError(
        new Error("Failed to initialize", {
          cause: new Error("Could not locate the bindings file for better_sqlite3.node"),
        }),
      ),
      false,
    );
  });

  void it("detects legacy memory schemas before runtime startup", () => {
    const database = createMemorySchema();
    try {
      assert.throws(() => assertCognitiveMemorySchema(database), /no such column: mem0_id/);
    } finally {
      database.close();
    }
  });

  void it("detects a missing memory observations table", () => {
    const database = createMemorySchema({ includeMem0Id: true, includeObservations: false });
    try {
      assert.throws(
        () => assertCognitiveMemorySchema(database),
        /no such table: memory_observations/,
      );
    } finally {
      database.close();
    }
  });

  void it("detects a missing memory job idempotency column", () => {
    const database = createMemorySchema({
      includeMem0Id: true,
      includeIdempotencyKey: false,
    });
    try {
      assert.throws(() => assertCognitiveMemorySchema(database), /no such column: idempotency_key/);
    } finally {
      database.close();
    }
  });

  void it("accepts the current cognitive memory schema", () => {
    const database = createMemorySchema({ includeMem0Id: true });
    try {
      assert.doesNotThrow(() => assertCognitiveMemorySchema(database));
    } finally {
      database.close();
    }
  });

  void it("does not classify runtime and provider failures as schema failures", () => {
    assert.equal(isRecoverableSchemaInitError(new Error("Mem0 API request timed out")), false);
    assert.equal(isRecoverableSchemaInitError(new Error("model provider returned 500")), false);
    assert.equal(
      isRecoverableSchemaInitError(new Error("no such function: custom_extension")),
      false,
    );
  });
});
