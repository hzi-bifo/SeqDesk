import { defineConfig } from "vitest/config";
import path from "path";

type TestTier = "fast" | "risk" | "live" | "all";

function resolveTestTier(rawTier: string | undefined): TestTier {
  const tier = (rawTier || "fast").toLowerCase();
  if (tier === "risk" || tier === "live" || tier === "all") {
    return tier;
  }
  return "fast";
}

const testTier = resolveTestTier(process.env.SEQDESK_TEST_TIER);
const serialExecution = testTier === "risk" || testTier === "live";

const includeByTier: Record<TestTier, string[]> = {
  fast: ["src/**/*.test.ts", "src/**/*.test.tsx", "pipelines/**/*.test.ts"],
  risk: ["src/**/*.risk.test.ts", "src/**/*.risk.test.tsx"],
  live: ["src/**/*.live.test.ts", "src/**/*.live.test.tsx"],
  all: ["src/**/*.test.ts", "src/**/*.test.tsx", "pipelines/**/*.test.ts"],
};

const excludeByTier: Record<TestTier, string[]> = {
  fast: [
    "src/**/*.risk.test.ts",
    "src/**/*.risk.test.tsx",
    "src/**/*.live.test.ts",
    "src/**/*.live.test.tsx",
  ],
  risk: ["src/**/*.live.test.ts", "src/**/*.live.test.tsx"],
  live: [],
  all: ["src/**/*.live.test.ts", "src/**/*.live.test.tsx"],
};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: includeByTier[testTier],
    exclude: excludeByTier[testTier],
    passWithNoTests: testTier === "risk" || testTier === "live",
    fileParallelism: !serialExecution,
    maxConcurrency: serialExecution ? 1 : 5,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "**/types.ts",
        "**/page.tsx",
        "**/layout.tsx",
      ],
      thresholds: {
        lines: 75,
        statements: 74,
        branches: 61,
        functions: 64,
      },
    },
    testTimeout: 10000,
  },
});
