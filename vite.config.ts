import { defineConfig } from "vite-plus";

const skillIgnorePatterns = [".agents/skills/**", ".codex/skills/**", "skills/**"];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: skillIgnorePatterns,
  },
  lint: {
    ignorePatterns: skillIgnorePatterns,
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
