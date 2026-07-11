import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { AgentProfile, ModelCapabilities } from "../../shared/types";
import { isRoutableAgent } from "./agent-routing";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_WORKFLOW_SEEDS,
} from "./runtime-defaults";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";
import { buildToolRegistryPreview } from "./tool-registry";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("runtime architecture", () => {
  void it("generates a single initial schema migration with runtime event storage", () => {
    const migration = readFileSync(path.join(process.cwd(), "drizzle", "0000_initial.sql"), "utf8");

    assert.match(migration, /CREATE TABLE `runtime_runs`/);
    assert.match(migration, /CREATE TABLE `runtime_steps`/);
    assert.match(migration, /CREATE TABLE `runtime_events`/);
    assert.match(migration, /`content_json` text NOT NULL/);
    assert.match(migration, /`metadata_json` text DEFAULT '\{\}' NOT NULL/);
    assert.equal(migration.toLowerCase().includes("harn" + "ess"), false);
    for (const legacyName of [
      ["agent", "runs"],
      ["agent", "run", "steps"],
      ["mcp", "servers"],
      ["mcp", "tools"],
      ["server", "nodes"],
      ["sync", "state"],
    ].map((parts) => parts.join("_"))) {
      assert.equal(migration.includes(legacyName), false);
    }
  });

  void it("adds agent instances, collaboration messages, checkpoints, and attributed events", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0004_boring_selene.sql"),
      "utf8",
    );

    assert.match(migration, /CREATE TABLE `agent_instances`/);
    assert.match(migration, /CREATE TABLE `agent_collaboration_messages`/);
    assert.match(migration, /CREATE TABLE `agent_context_checkpoints`/);
    assert.match(migration, /ALTER TABLE `runtime_events` ADD `event_type`/);
    assert.match(migration, /ALTER TABLE `runtime_events` ADD `agent_path`/);
    assert.equal(migration.includes("CREATE TABLE `memory_jobs`"), false);
    assert.equal(migration.includes("ALTER TABLE `memories`"), false);
  });

  void it("applies the agent runtime migration to a database already migrated through 0003", () => {
    const migrationsDir = path.join(process.cwd(), "drizzle");
    const temporaryDir = mkdtempSync(path.join(tmpdir(), "void-ai-migrations-"));
    const priorMigrationsDir = path.join(temporaryDir, "through-0003");
    const priorMetadataDir = path.join(priorMigrationsDir, "meta");
    const rawDb = new DatabaseSync(":memory:");

    try {
      mkdirSync(priorMetadataDir, { recursive: true });
      for (const migrationName of [
        "0000_initial.sql",
        "0001_bumpy_deathbird.sql",
        "0002_workflow_orchestration.sql",
        "0003_inner_memory.sql",
      ]) {
        copyFileSync(
          path.join(migrationsDir, migrationName),
          path.join(priorMigrationsDir, migrationName),
        );
      }

      const journal = JSON.parse(
        readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
      ) as { entries: Array<{ idx: number }> };
      writeFileSync(
        path.join(priorMetadataDir, "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 3) }),
      );

      applyDrizzleMigrations(rawDb, priorMigrationsDir);
      assert.equal(tableColumns(rawDb, "runtime_events").has("event_type"), false);

      applyDrizzleMigrations(rawDb, migrationsDir);

      assert.deepEqual(
        [...tableColumns(rawDb, "runtime_events")].filter((column) =>
          ["event_type", "agent_path", "parent_agent_path", "sequence"].includes(column),
        ),
        ["event_type", "agent_path", "parent_agent_path", "sequence"],
      );
      for (const table of [
        "agent_instances",
        "agent_collaboration_messages",
        "agent_context_checkpoints",
      ]) {
        assert.equal(tableExists(rawDb, table), true, `${table} should exist after migration`);
      }
    } finally {
      rawDb.close();
      rmSync(temporaryDir, { recursive: true, force: true });
    }
  });

  void it("defines default seed data for agents, workflows, and tools", () => {
    assert.ok(DEFAULT_CHILD_AGENT_SEEDS.some((agent) => agent.name === "Researcher"));
    assert.ok(DEFAULT_CHILD_AGENT_SEEDS.some((agent) => agent.name === "Operator"));
    assert.ok(DEFAULT_WORKFLOW_SEEDS.some((workflow) => workflow.id === "workflow-runtime-review"));
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "runtime_snapshot"));
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "sandbox_run_command"));
  });

  void it("routes only active, unlocked, enabled child agents", () => {
    const base = {
      id: "agent-test",
      name: "Test",
      role: "Test",
      description: "",
      avatar: "T",
      model_ref: null,
      voice: null,
      created_at: 0,
      updated_at: 0,
      personality: "",
      soul_prompt: "",
      instructions: "",
      persona: "",
      runtime_config_json: "{}",
      tool_policy_json: "{}",
      handoff_config_json: "{}",
    } satisfies Omit<AgentProfile, "kind" | "status" | "locked" | "enabled" | "parent_agent_id">;

    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 0,
        enabled: 1,
      }),
      true,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "archived",
        locked: 0,
        enabled: 1,
      }),
      false,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 1,
        enabled: 1,
      }),
      false,
    );
  });

  void it("builds the tool registry for runtime execution", () => {
    const runtime = buildToolRegistryPreview({
      selection: { mode: "auto", selectedToolIds: [] },
      model: {
        providerId: "test",
        providerKind: "openai-compatible",
        modelId: "model",
        capabilities,
        nativeTools: [],
      },
    });

    assert.equal(runtime.toolChoice, "auto");
    assert.ok(runtime.activeTools?.includes("runtime_snapshot"));
  });

  void it("classifies approval and sandbox policy risks", () => {
    assert.equal(inputHasPathEscape({ path: "../outside.txt" }), true);
    assert.equal(commandLooksDangerous({ command: "npm", args: ["install"] }), true);
    assert.equal(commandLooksDangerous({ command: "node", args: ["--version"] }), false);
  });

  void it("guards sandbox runtime access before a session exists", () => {
    assert.throws(() => getSandboxSessionOrThrow(undefined), /Sandbox session/);
  });
});

function applyDrizzleMigrations(db: DatabaseSync, migrationsFolder: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  const lastMigration = db
    .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
    .get() as { created_at: number } | undefined;

  db.exec("BEGIN");
  try {
    for (const migration of readMigrationFiles({ migrationsFolder })) {
      if (lastMigration && Number(lastMigration.created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) db.exec(statement);
      db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
        migration.hash,
        migration.folderMillis,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}
