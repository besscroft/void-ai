export function inputHasPathEscape(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  return ["path", "cwd"].some((key) => {
    const value = record[key];
    return (
      typeof value === "string" &&
      (value.includes("..") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/"))
    );
  });
}

export function commandLooksDangerous(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command.toLowerCase() : "";
  const args = Array.isArray(record.args) ? record.args.map(String).join(" ").toLowerCase() : "";
  const text = command + " " + args;
  return /\b(rm|del|erase|rmdir|format|mkfs|shutdown|reboot|npm|pnpm|yarn|pip|uv|brew|apt|choco|winget)\b/.test(
    text,
  );
}
