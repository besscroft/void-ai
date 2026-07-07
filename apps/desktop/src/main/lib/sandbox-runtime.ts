import type { SandboxContext } from "./sandbox-agents";

export function getSandboxSessionOrThrow(sandbox: SandboxContext | undefined): SandboxContext {
  if (!sandbox) throw new Error("Sandbox session is not available.");
  return sandbox;
}
