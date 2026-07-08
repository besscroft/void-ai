import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolRecord } from "@shared/types";
import { filterToolRecords } from "../lib/tools-filter";
import { buildMcpInput, buildSkillInput } from "../lib/tools-form";

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

  void it("builds MCP server input for stdio and remote transports", () => {
    const stdioForm = {
      name: " Local files ",
      description: "File tools",
      transport: "stdio",
      enabled: true,
      auto_use: false,
      requires_approval: true,
      command: " npx ",
      args: '["-y","@modelcontextprotocol/server-filesystem"]',
      url: "",
      headers: "{}",
      env: '{"ROOT":"C:/tmp"}',
      cwd: " C:/tmp ",
    } as const;
    const stdio = buildMcpInput(stdioForm);

    assert.equal(stdio.name, "Local files");
    assert.equal(stdio.command, "npx");
    assert.equal(stdio.url, null);
    assert.equal(stdio.args, '["-y","@modelcontextprotocol/server-filesystem"]');
    assert.equal(stdio.env, '{"ROOT":"C:/tmp"}');

    const remote = buildMcpInput({
      ...stdioForm,
      transport: "http",
      command: "",
      url: " https://example.test/mcp ",
      headers: '{"Authorization":"Bearer ${API_KEY}"}',
    });

    assert.equal(remote.transport, "http");
    assert.equal(remote.command, null);
    assert.equal(remote.url, "https://example.test/mcp");
    assert.equal(remote.headers, '{"Authorization":"Bearer ${API_KEY}"}');
  });

  void it("builds Skill input with normalized steps", () => {
    const input = buildSkillInput({
      name: " Research brief ",
      description: "Summarize sources",
      category: "analysis",
      enabled: true,
      auto_use: true,
      requires_approval: false,
      triggerKeywords: '["research","brief"]',
      tags: '["docs"]',
      configSchema: '{"type":"object"}',
      config: '{"depth":"fast"}',
      steps: JSON.stringify([{ id: "", type: "unknown", title: "", detail: "Start" }]),
    });

    assert.equal(input.name, "Research brief");
    assert.equal(input.category, "analysis");
    assert.deepEqual(input.steps, [
      {
        id: "step-1",
        type: "prompt",
        title: "prompt",
        detail: "Start",
      },
    ]);
  });

  void it("rejects invalid MCP and Skill JSON fields", () => {
    assert.throws(
      () =>
        buildMcpInput({
          name: "Remote",
          description: "",
          transport: "http",
          enabled: true,
          auto_use: true,
          requires_approval: true,
          command: "",
          args: "[]",
          url: "https://example.test/mcp",
          headers: "{bad json",
          env: "{}",
          cwd: "",
        }),
      /headers must be a JSON object/,
    );

    assert.throws(
      () =>
        buildSkillInput({
          name: "Broken",
          description: "",
          category: "",
          enabled: true,
          auto_use: true,
          requires_approval: true,
          triggerKeywords: "[]",
          tags: "[]",
          configSchema: "{}",
          config: "{}",
          steps: "{}",
        }),
      /steps must be a JSON array/,
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
