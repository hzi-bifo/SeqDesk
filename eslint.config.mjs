import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees can contain stale symlinks and are not app source.
    ".agents/**",
    ".claude/**",
    ".codex/**",
    // Locally extracted release bundles are build artifacts.
    "seqdesk-*/**",
  ]),
]);

export default eslintConfig;
