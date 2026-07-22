import { unzipSync } from "fflate";

export interface InspectedSkillArchive {
  files: Record<string, Uint8Array>;
  totalBytes: number;
  markdown: string;
  name: string;
  description: string;
}

export interface TextSkillFile {
  path: string;
  contents: string;
}

export function inspectSkillArchive(bytes: Uint8Array): InspectedSkillArchive {
  const archive = unzipSync(bytes);
  const entries = Object.entries(archive).filter(([, data]) => data.length > 0);
  if (entries.length > 500) throw new Error("Skill archive contains too many files.");
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  const skillEntry = entries.find(([path]) => /(^|\/)SKILL\.md$/i.test(path));
  if (!skillEntry) throw new Error("Skill archive does not contain SKILL.md.");
  const rootPrefix = skillEntry[0].slice(0, -"SKILL.md".length);
  for (const [archivePath, data] of entries) {
    if (rootPrefix && !archivePath.startsWith(rootPrefix)) continue;
    const relativePath = archivePath.slice(rootPrefix.length).replace(/\\/g, "/");
    validateArchivePath(relativePath);
    totalBytes += data.byteLength;
    if (totalBytes > 20 * 1024 * 1024) throw new Error("Expanded skill exceeds 20 MB.");
    files[relativePath] = data;
  }
  const markdown = new TextDecoder().decode(files["SKILL.md"]);
  const frontmatter = parseSkillFrontmatter(markdown);
  return { files, totalBytes, markdown, ...frontmatter };
}

export function inspectSkillFiles(entries: TextSkillFile[]): InspectedSkillArchive {
  if (entries.length > 500) throw new Error("Skill package contains too many files.");
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const entry of entries) {
    validateArchivePath(entry.path);
    const data = new TextEncoder().encode(entry.contents);
    totalBytes += data.byteLength;
    if (totalBytes > 20 * 1024 * 1024) throw new Error("Expanded skill exceeds 20 MB.");
    files[entry.path] = data;
  }
  const skillPath = Object.keys(files).find((path) => /(^|\/)SKILL\.md$/i.test(path));
  if (!skillPath) throw new Error("Skill package does not contain SKILL.md.");
  const rootPrefix = skillPath.slice(0, -"SKILL.md".length);
  const rootedFiles = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => !rootPrefix || path.startsWith(rootPrefix))
      .map(([path, data]) => [path.slice(rootPrefix.length), data]),
  );
  const markdown = new TextDecoder().decode(rootedFiles["SKILL.md"]);
  const frontmatter = parseSkillFrontmatter(markdown);
  return { files: rootedFiles, totalBytes, markdown, ...frontmatter };
}

export function validateArchivePath(path: string): void {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !path ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.includes("..") ||
    segments.includes("")
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

export function parseSkillFrontmatter(markdown: string): {
  name: string;
  description: string;
} {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new Error("SKILL.md must begin with YAML frontmatter.");
  const fields = Object.fromEntries(
    match[1]!
      .split(/\r?\n/)
      .map((line) => /^([A-Za-z][A-Za-z0-9_-]*):\s*["']?(.*?)["']?\s*$/.exec(line))
      .filter((item): item is RegExpExecArray => item !== null)
      .map((item) => [item[1]!, item[2]!]),
  );
  const name = fields.name?.trim();
  if (!name) throw new Error("Skill frontmatter name is required.");
  return {
    name: name.slice(0, 160),
    description: (fields.description?.trim() || "Installed skill").slice(0, 1_000),
  };
}
