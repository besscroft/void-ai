import { createHash } from "node:crypto";
import type { CatalogSearchInput, JsonObject } from "../../shared/types";

export interface CatalogAdapterItem {
  externalId: string;
  artifactType: "skill";
  name: string;
  description: string;
  version?: string;
  installUrl: string;
  contentHash?: string;
  detail: JsonObject;
}

export interface SkillsShSearchResult {
  items: CatalogAdapterItem[];
  hasMore: boolean;
  source: "skills-sh";
}

export interface SkillPackageFile {
  path: string;
  contents: string;
}

export interface SkillPackage {
  files: SkillPackageFile[];
  hash: string;
}

export interface ModelScopeSkillsResult {
  items: CatalogAdapterItem[];
  total: number;
  page: number;
  pageSize: number;
}

const MODELSCOPE_ORIGIN = "https://www.modelscope.cn";
const MODELSCOPE_SKILLS_API = `${MODELSCOPE_ORIGIN}/api/v1/dolphin/skills`;
const SKILLS_SH_ORIGIN = "https://skills.sh";
const SKILLS_SH_SEARCH_API = `${SKILLS_SH_ORIGIN}/api/search`;

export const SKILLS_SH_SOURCE_ID = "catalog-skills-sh";
export const MODELSCOPE_SOURCE_ID = "catalog-modelscope-skills";

export async function searchModelScopeSkills(
  input: CatalogSearchInput = {},
): Promise<ModelScopeSkillsResult> {
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 48, 1, 100);
  const response = await fetch(MODELSCOPE_SKILLS_API, {
    method: "PUT",
    headers: {
      Accept: "application/json, text/plain;q=0.9",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoidAI/1.0",
      Origin: MODELSCOPE_ORIGIN,
      Referer: `${MODELSCOPE_ORIGIN}/skills`,
    },
    body: JSON.stringify({
      PageSize: pageSize,
      PageNumber: page,
      Query: input.query?.trim() ?? "",
      Sort: "Default",
      Criterion: [],
      WithTopCollection: false,
    }),
    redirect: "follow",
  });
  const resolved = new URL(response.url || MODELSCOPE_SKILLS_API);
  if (
    resolved.protocol !== "https:" ||
    !["modelscope.cn", "www.modelscope.cn"].includes(resolved.hostname)
  ) {
    throw new Error(`ModelScope Skills redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`ModelScope Skills returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.includes("aliyun_waf_aa") || !text.trimStart().startsWith("{")) {
    throw new Error("ModelScope Skills returned browser verification instead of catalog data.");
  }
  return parseModelScopeSkillsData(JSON.parse(text), page, pageSize);
}

export async function searchSkillsShSkills(
  input: CatalogSearchInput = {},
): Promise<SkillsShSearchResult> {
  const query = input.query?.trim() ?? "";
  if (query.length < 2) return { items: [], hasMore: false, source: "skills-sh" };
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 40, 1, 100);
  const limit = Math.min(200, page * pageSize);
  const url = new URL(SKILLS_SH_SEARCH_API);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (resolved.protocol !== "https:" || resolved.origin !== SKILLS_SH_ORIGIN) {
    throw new Error(`skills.sh search redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`skills.sh search returned HTTP ${response.status}.`);
  const payload = (await response.json()) as unknown;
  const root = asRecord(payload);
  const rawItems = firstArray(root.skills, root.items);
  const items = rawItems
    .map((value) => skillsShItem(asRecord(value)))
    .filter((item): item is CatalogAdapterItem => item !== null);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    hasMore: items.length >= limit && limit < 200,
    source: "skills-sh",
  };
}

export async function downloadSkillsShPackage(externalId: string): Promise<SkillPackage> {
  const parts = externalId.split("/");
  if (parts.length < 3) throw new Error("Invalid skills.sh skill identifier.");
  const [owner, repo, ...skillParts] = parts;
  const skill = skillParts.join("/");
  if (
    !owner ||
    !repo ||
    !skill ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.:-]+$/.test(repo)
  ) {
    throw new Error("Invalid skills.sh skill identifier.");
  }
  const url = new URL(
    `/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${skill
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    SKILLS_SH_ORIGIN,
  );
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (resolved.protocol !== "https:" || resolved.origin !== SKILLS_SH_ORIGIN) {
    throw new Error(`skills.sh download redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`skills.sh download returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 20 * 1024 * 1024) throw new Error("Skill package exceeds 20 MB.");
  const payload = asRecord(await response.json());
  const files = firstArray(payload.files)
    .map((value) => {
      const item = asRecord(value);
      const path = stringValue(item.path);
      const contents = typeof item.contents === "string" ? item.contents : "";
      return path && contents ? { path, contents } : null;
    })
    .filter((value): value is SkillPackageFile => value !== null);
  if (files.length === 0) throw new Error("skills.sh returned an empty package.");
  const hash = stringValue(payload.hash);
  return { files, hash: hash || createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

export function parseModelScopeSkillsData(
  value: unknown,
  page = 1,
  pageSize = 48,
): ModelScopeSkillsResult {
  const root = asRecord(value);
  const code = numberValue(root.Code ?? root.code);
  if (code !== undefined && code !== 200) {
    throw new Error(
      stringValue(root.Message ?? root.message) || `ModelScope Skills returned ${code}.`,
    );
  }
  const data = asRecord(root.Data ?? root.data);
  const rawItems = firstArray(data.SkillList, data.skillList, data.Skills, data.skills);
  const items = rawItems
    .map((value) => asRecord(asRecord(value).Skill ?? value))
    .map(modelScopeSkillItem)
    .filter((item): item is CatalogAdapterItem => item !== null);
  return {
    items,
    total: numberValue(data.TotalCount ?? data.totalCount) ?? items.length,
    page,
    pageSize,
  };
}

function modelScopeSkillItem(item: Record<string, unknown>): CatalogAdapterItem | null {
  const path = stringValue(item.Path ?? item.path).replace(/^\/+|\/+$/g, "");
  const repositoryName = stringValue(item.Name ?? item.name);
  if (!path || !repositoryName || path.includes("..") || repositoryName.includes("/")) return null;
  const externalId = `${path}/${repositoryName}`;
  const modified = numberValue(item.GmtModify ?? item.gmtModify ?? item.RepoModify);
  const version = modified === undefined ? undefined : String(modified);
  const category = asRecord(item.L1 ?? item.l1);
  const displayName = stringValue(item.DisplayName ?? item.displayName) || repositoryName;
  const encodedId = externalId
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return {
    externalId,
    artifactType: "skill",
    name: displayName,
    description: stringValue(item.Description ?? item.description),
    version,
    installUrl: `${MODELSCOPE_ORIGIN}/skills/${encodedId}/archive/zip/master`,
    contentHash: createHash("sha256")
      .update(`${externalId}:${version ?? "unknown"}`)
      .digest("hex"),
    detail: {
      provider: "modelscope",
      skillId: externalId,
      repositoryName,
      owner: stringValue(item.Owner ?? item.owner),
      developer: stringValue(item.SourceDeveloper ?? item.sourceDeveloper),
      category: stringValue(category.ChineseName ?? category.Name ?? category.name),
      license: stringValue(item.License ?? item.license),
      sourceUrl: stringValue(item.SourceURL ?? item.SourceUrl ?? item.sourceUrl),
      avatarUrl: stringValue(item.SourceAvatar ?? item.sourceAvatar),
      visits: numberValue(item.Visits ?? item.visits) ?? 0,
      downloads: numberValue(item.DownloadCount ?? item.downloadCount) ?? 0,
      tags: Array.isArray(item.Tags) ? item.Tags.map(String) : [],
      catalogUrl: `${MODELSCOPE_ORIGIN}/skills/${encodedId}`,
      modifiedAt: modified ?? 0,
      canonicalKey: canonicalGithubKey(
        stringValue(item.SourceURL ?? item.SourceUrl ?? item.sourceUrl),
        repositoryName,
      ),
    },
  };
}

function skillsShItem(item: Record<string, unknown>): CatalogAdapterItem | null {
  const id = stringValue(item.id);
  const name = stringValue(item.name) || stringValue(item.skillId);
  const source = stringValue(item.source);
  if (!id || !name || !source || !id.startsWith(`${source}/`)) return null;
  const slug = id.slice(source.length + 1);
  if (!slug) return null;
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  return {
    externalId: id,
    artifactType: "skill",
    name,
    description: stringValue(item.description),
    version: undefined,
    installUrl: `${SKILLS_SH_ORIGIN}/api/download/${encoded}`,
    detail: {
      provider: "skills.sh",
      source,
      slug,
      skillUrl: `${SKILLS_SH_ORIGIN}/${encoded}`,
      sourceUrl: `https://github.com/${source}`,
      installs: numberValue(item.installs) ?? 0,
      canonicalKey: `github:${source.toLowerCase()}#${slug.toLowerCase()}`,
    },
  };
}

function canonicalGithubKey(sourceUrl: string, skill: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return owner && repo
      ? `github:${owner.toLowerCase()}/${repo.toLowerCase()}#${skill.toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
