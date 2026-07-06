const fs = require("fs");
const path = "apps/desktop/src/renderer/src/lib/chat-media.ts";
let s = fs.readFileSync(path, "utf8");
s = s.replace(
  `    metadata: {
      mediaGeneration: {
        kind,
        status: "pending",
        modelRef: selection?.modelRef ?? undefined,
        options: selection?.options ?? undefined,
      },
    },`,
  `    metadata: { mediaGeneration: buildMediaGenerationMetadata(kind, "pending", selection) },`,
);
s = s.replace(
  `    metadata: {
      mediaGeneration: {
        kind,
        status: "error",
        error,
        modelRef: selection?.modelRef ?? undefined,
        options: selection?.options ?? undefined,
      },
    },`,
  `    metadata: { mediaGeneration: buildMediaGenerationMetadata(kind, "error", selection, error) },`,
);
s = s.replace(
  `export function mediaKindLabel(kind: MediaGenerationKind): string {`,
  `function buildMediaGenerationMetadata(
  kind: MediaGenerationKind,
  status: "pending" | "error",
  selection?: MediaGenerationSelection,
  error?: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { kind, status };
  if (error) metadata.error = error;
  if (selection?.modelRef) metadata.modelRef = selection.modelRef;
  if (selection?.options && Object.keys(selection.options).length > 0) {
    metadata.options = selection.options;
  }
  return metadata;
}

export function mediaKindLabel(kind: MediaGenerationKind): string {`,
);
fs.writeFileSync(path, s, "utf8");
