import { defineConfig } from "vitest/config";
import path from "path";

type TestTier = "fast" | "live" | "all";

function resolveTestTier(rawTier: string | undefined): TestTier {
  const tier = (rawTier || "fast").toLowerCase();
  if (tier === "live" || tier === "all") {
    return tier;
  }
  return "fast";
}

const testTier = resolveTestTier(process.env.SEQDESK_TEST_TIER);
// live + all exercise real-DB integration tests and must run serially; the
// default fast tier mocks the DB and runs in parallel.
const serialExecution = testTier === "live" || testTier === "all";

const includeByTier: Record<TestTier, string[]> = {
  fast: ["src/**/*.test.ts", "src/**/*.test.tsx", "pipelines/**/*.test.ts"],
  live: ["src/**/*.live.test.ts", "src/**/*.live.test.tsx"],
  // all = the entire suite including the real-DB *.live tests.
  all: ["src/**/*.test.ts", "src/**/*.test.tsx", "pipelines/**/*.test.ts"],
};

const excludeByTier: Record<TestTier, string[]> = {
  // fast excludes the real-DB live tests (the *.test.ts glob would otherwise
  // match *.live.test.ts).
  fast: ["src/**/*.live.test.ts", "src/**/*.live.test.tsx"],
  live: [],
  all: [],
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
    passWithNoTests: testTier === "live",
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
        "src/app/**/order-wizard-page.tsx",
      ],
      thresholds: {
        lines: 79,
        statements: 78,
        branches: 67,
        functions: 74,
      },
    },
    testTimeout: 10000,
  },
});
