import { createHash, randomUUID } from "node:crypto";
import { app } from "electron";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { eq, ne } from "drizzle-orm";
import type {
  ArtifactInstallation,
  CatalogInstallInput,
  CatalogItem,
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSnapshot,
  JsonObject,
} from "../../shared/types";
import {
  createSkillTool,
  deleteSkillTool,
  deleteToolServer,
  getDb,
  setSkillToolEnabled,
  setToolServerEnabled,
  updateSkillTool,
} from "./db";
import { artifactInstallations, catalogItems, catalogSources } from "./schema";
import { searchModelScopeSkills } from "./catalog-adapters";
import { discoverMcpServer } from "./mcp-manager";
import { inspectSkillArchive } from "./catalog-safety";

const MODELSCOPE_SKILLS_SOURCE_ID = "catalog-modelscope-skills";
const MODELSCOPE_SKILLS_SOURCE: typeof catalogSources.$inferInsert = {
  id: MODELSCOPE_SKILLS_SOURCE_ID,
  name: "ModelScope Skills",
  kind: "modelscope-skills",
  url: "https://www.modelscope.cn/skills",
  enabled: 1,
  builtin: 1,
  config_json: "{}",
  last_synced_at: null,
  last_error: null,
  created_at: 0,
  updated_at: 0,
};

export function ensureBuiltinCatalogSources(now = Date.now()): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(catalogSources).where(ne(catalogSources.id, MODELSCOPE_SKILLS_SOURCE_ID)).run();
    tx.insert(catalogSources)
      .values({ ...MODELSCOPE_SKILLS_SOURCE, created_at: now, updated_at: now })
      .onConflictDoUpdate({
        target: catalogSources.id,
        set: {
          name: MODELSCOPE_SKILLS_SOURCE.name,
          kind: MODELSCOPE_SKILLS_SOURCE.kind,
          url: MODELSCOPE_SKILLS_SOURCE.url,
          enabled: 1,
          builtin: 1,
          updated_at: now,
        },
      })
      .run();
  });
}

export function getCatalogSnapshot(): CatalogSnapshot {
  ensureBuiltinCatalogSources();
  return { installations: listArtifactInstallations() };
}

export async function searchCatalogSkills(
  input: CatalogSearchInput = {},
): Promise<CatalogSearchResult> {
  ensureBuiltinCatalogSources();
  const page = normalizeInteger(input.page, 1, 1, 1_000);
  const pageSize = normalizeInteger(input.pageSize, 48, 1, 100);
  try {
    const result = await searchModelScopeSkills({ query: input.query, page, pageSize });
    if (result.items.length === 0 && result.total > 0) {
      throw new Error("ModelScope Skills returned an empty page unexpectedly.");
    }
    const now = Date.now();
    getDb().transaction((tx) => {
      for (const item of result.items) {
        tx.insert(catalogItems)
          .values({
            id: catalogItemId(MODELSCOPE_SKILLS_SOURCE_ID, item.externalId),
            source_id: MODELSCOPE_SKILLS_SOURCE_ID,
            artifact_type: "skill",
            external_id: item.externalId,
            name: item.name.slice(0, 200),
            description: item.description.slice(0, 2_000),
            version: item.version ?? null,
            install_url: item.installUrl ?? null,
            detail_json: JSON.stringify(item.detail),
            content_hash: item.contentHash ?? null,
            cached_at: now,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: catalogItems.id,
            set: {
              name: item.name.slice(0, 200),
              description: item.description.slice(0, 2_000),
              version: item.version ?? null,
              install_url: item.installUrl,
              detail_json: JSON.stringify(item.detail),
              content_hash: item.contentHash,
              cached_at: now,
              updated_at: now,
            },
          })
          .run();
      }
      tx.update(catalogSources)
        .set({ last_synced_at: now, last_error: null, updated_at: now })
        .where(eq(catalogSources.id, MODELSCOPE_SKILLS_SOURCE_ID))
        .run();
    });
    return {
      items: catalogItemsInOrder(result.items.map((item) => item.externalId)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      offline: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getDb()
      .update(catalogSources)
      .set({ last_error: message.slice(0, 2_000), updated_at: Date.now() })
      .where(eq(catalogSources.id, MODELSCOPE_SKILLS_SOURCE_ID))
      .run();
    const cached = searchCachedCatalogItems(input.query, page, pageSize);
    if (cached.items.length > 0) return { ...cached, offline: true, error: message };
    throw new Error(`ModelScope Skills is unavailable and no cached results exist: ${message}`);
  }
}

function searchCachedCatalogItems(
  queryValue: string | undefined,
  page: number,
  pageSize: number,
): Omit<CatalogSearchResult, "offline" | "error"> {
  const query = queryValue?.trim().toLowerCase();
  const rows = getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === MODELSCOPE_SKILLS_SOURCE_ID)
    .filter(
      (row) =>
        !query || `${row.name} ${row.description} ${row.external_id}`.toLowerCase().includes(query),
    );
  const installations = getDb().select().from(artifactInstallations).all();
  const installationByItem = new Map(
    installations.filter((item) => item.item_id).map((item) => [item.item_id!, item]),
  );
  const offset = (page - 1) * pageSize;
  return {
    items: rows
      .slice(offset, offset + pageSize)
      .map((row) => toCatalogItem(row, installationByItem.get(row.id))),
    total: rows.length,
    page,
    pageSize,
  };
}

export function listArtifactInstallations(): ArtifactInstallation[] {
  return getDb().select().from(artifactInstallations).all().map(toInstallation);
}

export async function installCatalogItem(
  input: CatalogInstallInput,
): Promise<ArtifactInstallation> {
  const item = getDb().select().from(catalogItems).where(eq(catalogItems.id, input.itemId)).get();
  if (!item) throw new Error("Catalog item does not exist. Sync its source and try again.");
  if (item.artifact_type !== "skill") {
    throw new Error("The marketplace only installs Skills. Configure MCP servers manually.");
  }
  return await installSkillItem(item, input);
}

export async function setArtifactInstallationEnabled(
  id: string,
  enabled: boolean,
): Promise<ArtifactInstallation> {
  const row = requireInstallation(id);
  if (row.artifact_type === "skill") {
    if (!row.skill_id) throw new Error("Installed skill record is missing.");
    setSkillToolEnabled(row.skill_id, enabled);
  } else {
    if (!row.tool_server_id) throw new Error("Installed MCP server record is missing.");
    if (enabled) await discoverMcpServer(row.tool_server_id);
    setToolServerEnabled(row.tool_server_id, enabled);
  }
  getDb()
    .update(artifactInstallations)
    .set({
      status: enabled ? "enabled" : "disabled",
      safety_json: JSON.stringify({
        ...parseJson(row.safety_json),
        ...(enabled ? { reviewed: true, reviewedAt: Date.now() } : {}),
      }),
      last_error: null,
      updated_at: Date.now(),
    })
    .where(eq(artifactInstallations.id, id))
    .run();
  return toInstallation(requireInstallation(id));
}

export function uninstallArtifact(id: string): boolean {
  const row = requireInstallation(id);
  if (row.skill_id) deleteSkillTool(row.skill_id);
  if (row.tool_server_id) deleteToolServer(row.tool_server_id);
  if (row.install_path && existsSync(row.install_path))
    rmSync(row.install_path, { recursive: true, force: true });
  return (
    getDb().delete(artifactInstallations).where(eq(artifactInstallations.id, id)).run().changes > 0
  );
}

async function installSkillItem(
  item: typeof catalogItems.$inferSelect,
  input: CatalogInstallInput,
): Promise<ArtifactInstallation> {
  if (!item.install_url) throw new Error("Skill item does not provide an install URL.");
  const archive = await downloadSkillArchive(item.install_url);
  const inspected = inspectSkillArchive(archive);
  const installationId = existingInstallationId(item.id) ?? randomUUID();
  const target = join(app.getPath("userData"), "catalog", "skills", installationId);
  atomicWriteSkill(target, inspected.files);
  const existing = getDb()
    .select()
    .from(artifactInstallations)
    .where(eq(artifactInstallations.id, installationId))
    .get();
  const skill = existing?.skill_id
    ? updateSkillTool(existing.skill_id, {
        name: inspected.name,
        description: inspected.description,
        enabled: false,
        config: { installationId, installPath: target, sourceItemId: item.id },
        steps: [
          {
            id: "apply-skill",
            type: "prompt",
            title: "Apply installed skill",
            detail: inspected.markdown,
          },
        ],
      })
    : createSkillTool({
        name: inspected.name,
        description: inspected.description,
        category: "catalog",
        enabled: false,
        auto_use: false,
        requires_approval: true,
        tags: ["catalog", "installed"],
        config: { installationId, installPath: target, sourceItemId: item.id },
        steps: [
          {
            id: "apply-skill",
            type: "prompt",
            title: "Apply installed skill",
            detail: inspected.markdown,
          },
        ],
      });
  const now = Date.now();
  const hash = createHash("sha256").update(archive).digest("hex");
  const row: typeof artifactInstallations.$inferInsert = {
    id: installationId,
    item_id: item.id,
    source_id: item.source_id,
    artifact_type: "skill",
    name: inspected.name,
    version: item.version,
    content_hash: item.content_hash ?? hash,
    install_path: target,
    status: "disabled",
    safety_json: JSON.stringify({
      reviewed: false,
      archiveSha256: hash,
      fileCount: Object.keys(inspected.files).length,
      totalBytes: inspected.totalBytes,
      checks: [
        "frontmatter",
        "path-traversal",
        "file-count",
        "archive-size",
        "no-symlink-materialization",
      ],
    }),
    config_json: JSON.stringify(input.config ?? {}),
    tool_server_id: null,
    skill_id: skill.id,
    last_error: null,
    installed_at: existing?.installed_at ?? now,
    updated_at: now,
  };
  upsertInstallation(row);
  if (input.enable) return await setArtifactInstallationEnabled(installationId, true);
  return toInstallation(requireInstallation(installationId));
}

async function downloadSkillArchive(urlValue: string): Promise<Uint8Array> {
  const url = new URL(urlValue);
  if (url.protocol !== "https:") throw new Error("Skill downloads must use HTTPS.");
  if (!["modelscope.cn", "www.modelscope.cn"].includes(url.hostname)) {
    throw new Error("Skill archive host is not the ModelScope marketplace.");
  }
  if (!/^\/skills\/[^/]+\/[^/]+\/archive\/zip\/master$/.test(url.pathname)) {
    throw new Error("Skill archive URL does not match the ModelScope download protocol.");
  }
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (
    resolved.protocol !== "https:" ||
    !["modelscope.cn", "www.modelscope.cn"].includes(resolved.hostname)
  ) {
    throw new Error("Skill archive redirected to an untrusted origin.");
  }
  if (!response.ok) throw new Error(`Skill download returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 5 * 1024 * 1024) throw new Error("Skill archive exceeds 5 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Skill archive exceeds 5 MB.");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("ModelScope returned non-ZIP content instead of a Skill archive.");
  }
  return bytes;
}

function atomicWriteSkill(target: string, files: Record<string, Uint8Array>): void {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const rollback = `${target}.rollback-${randomUUID()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    for (const [path, data] of Object.entries(files)) {
      const destination = resolve(temporary, path);
      if (relative(temporary, destination).startsWith(".."))
        throw new Error("Skill path escaped staging.");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data, { flag: "wx" });
    }
    if (existsSync(target)) renameSync(target, rollback);
    renameSync(temporary, target);
    if (existsSync(rollback)) rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(rollback)) renameSync(rollback, target);
    throw error;
  }
}

function upsertInstallation(row: typeof artifactInstallations.$inferInsert): void {
  getDb()
    .insert(artifactInstallations)
    .values(row)
    .onConflictDoUpdate({
      target: artifactInstallations.id,
      set: { ...row, id: undefined },
    })
    .run();
}

function existingInstallationId(itemId: string): string | null {
  return (
    getDb()
      .select({ id: artifactInstallations.id })
      .from(artifactInstallations)
      .where(eq(artifactInstallations.item_id, itemId))
      .get()?.id ?? null
  );
}

function requireInstallation(id: string): typeof artifactInstallations.$inferSelect {
  const row = getDb()
    .select()
    .from(artifactInstallations)
    .where(eq(artifactInstallations.id, id))
    .get();
  if (!row) throw new Error("Artifact installation does not exist.");
  return row;
}

function toCatalogItem(
  row: typeof catalogItems.$inferSelect,
  installation?: typeof artifactInstallations.$inferSelect,
): CatalogItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    artifactType: row.artifact_type,
    externalId: row.external_id,
    name: row.name,
    description: row.description,
    version: row.version,
    installUrl: row.install_url,
    detail: parseJson(row.detail_json),
    contentHash: row.content_hash,
    cachedAt: row.cached_at,
    installed: !!installation,
    updateAvailable:
      !!installation &&
      (row.version && installation.version
        ? row.version !== installation.version
        : !!row.content_hash && installation.content_hash !== row.content_hash),
  };
}

function toInstallation(row: typeof artifactInstallations.$inferSelect): ArtifactInstallation {
  return {
    id: row.id,
    itemId: row.item_id,
    sourceId: row.source_id,
    artifactType: row.artifact_type,
    name: row.name,
    version: row.version,
    contentHash: row.content_hash,
    installPath: row.install_path,
    status: row.status,
    safety: parseJson(row.safety_json),
    config: parseJson(row.config_json),
    toolServerId: row.tool_server_id,
    skillId: row.skill_id,
    lastError: row.last_error,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function catalogItemId(sourceId: string, externalId: string): string {
  return `catalog-item-${createHash("sha256").update(`${sourceId}:${externalId}`).digest("hex").slice(0, 32)}`;
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function catalogItemsInOrder(externalIds: string[]): CatalogItem[] {
  if (externalIds.length === 0) return [];
  const rows = getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === MODELSCOPE_SKILLS_SOURCE_ID);
  const installations = getDb().select().from(artifactInstallations).all();
  const installationByItem = new Map(
    installations.filter((item) => item.item_id).map((item) => [item.item_id!, item]),
  );
  const byExternalId = new Map(rows.map((row) => [row.external_id, row]));
  return externalIds.flatMap((externalId) => {
    const row = byExternalId.get(externalId);
    return row ? [toCatalogItem(row, installationByItem.get(row.id))] : [];
  });
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
