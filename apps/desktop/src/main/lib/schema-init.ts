const UNRECOVERABLE_RUNTIME_PATTERN =
  /NODE_MODULE_VERSION|better_sqlite3\.node|Could not locate the bindings file/i;

const RECOVERABLE_SCHEMA_PATTERN =
  /no such table|no such column|already exists|duplicate column name|foreign key mismatch|FOREIGN KEY constraint failed|UNIQUE constraint failed|NOT NULL constraint failed/i;

export interface SchemaProbeDatabase {
  prepare(sql: string): {
    get(): unknown;
  };
}

/**
 * Verify the schema required by the cognitive memory pipeline before any
 * runtime code starts querying the database.
 */
export function assertCognitiveMemorySchema(database: SchemaProbeDatabase): void {
  database
    .prepare(
      "SELECT `mem0_id`, `sync_status`, `strength`, `last_reinforced_at` FROM `memories` LIMIT 0",
    )
    .get();
  database.prepare("SELECT `idempotency_key` FROM `memory_jobs` LIMIT 0").get();
  database.prepare("SELECT `id` FROM `memory_observations` LIMIT 0").get();
}

export function isRecoverableSchemaInitError(error: unknown): boolean {
  const messages = errorChainMessages(error);
  if (messages.some((message) => UNRECOVERABLE_RUNTIME_PATTERN.test(message))) return false;
  return messages.some((message) => RECOVERABLE_SCHEMA_PATTERN.test(message));
}

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") {
      messages.push(typeof current === "string" ? current : `Non-error value (${typeof current})`);
      break;
    }

    const record = current as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
  }

  return messages;
}
