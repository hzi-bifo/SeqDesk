import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These entry points intentionally use Node's CommonJS loader. Keep the
    // exception scoped to executable scripts instead of weakening app code.
    files: ["**/*.cjs", "npm/seqdesk/**/*.js", "scripts/upload-release.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
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
    // Generated HTML coverage output is not source code.
    "coverage/**",
  ]),
]);

export default eslintConfig;
