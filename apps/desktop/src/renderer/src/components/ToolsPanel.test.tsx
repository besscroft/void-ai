import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolRecord } from "@shared/types";
import { filterToolRecords } from "../lib/tools-filter";

void describe("ToolsPanel data helpers", () => {
  void it("filters tools by kind, approval state, enabled state, and search query", () => {
    const records = [
      toolRecord("builtin-time", "builtin", "current_time", "system", 1, 0),
      toolRecord("mcp-search", "mcp", "search", "web", 1, 1),
      toolRecord("skill-research", "skill", "research", "workflow", 0, 1),
      toolRecord("sandbox-command", "sandbox", "sandbox_run_command", "sandbox", 1, 1),
    ];

    assert.deepEqual(
      filterToolRecords(records, { kind: "mcp" }).map((tool) => tool.id),
      ["mcp-search"],
    );
    assert.deepEqual(
      filterToolRecords(records, { status: "enabled" }).map((tool) => tool.id),
      ["builtin-time", "mcp-search", "sandbox-command"],
    );
    assert.deepEqual(
      filterToolRecords(records, { status: "approval" }).map((tool) => tool.id),
      ["mcp-search", "sandbox-command", "skill-research"],
    );
    assert.deepEqual(
      filterToolRecords(records, { query: "command" }).map((tool) => tool.id),
      ["sandbox-command"],
    );
  });
});

function toolRecord(
  id: string,
  kind: ToolRecord["kind"],
  name: string,
  category: string,
  enabled: number,
  requiresApproval: number,
): ToolRecord {
  const now = Date.now();
  return {
    id,
    server_id: kind === "mcp" ? "server-1" : null,
    name,
    title: name,
    description: `${name} ${category}`,
    kind,
    category,
    reference: name,
    input_schema_json: "{}",
    output_schema_json: "{}",
    config_json: "{}",
    steps_json: "[]",
    workflow_id: null,
    trigger_keywords_json: "[]",
    tags_json: "[]",
    enabled,
    auto_use: 1,
    requires_approval: requiresApproval,
    discovered_at: now,
    last_run_at: null,
    updated_at: now,
  };
}
