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
  fast: ["src/**/*.test.ts"],
  risk: ["src/**/*.risk.test.ts"],
  live: ["src/**/*.live.test.ts"],
  all: ["src/**/*.test.ts"],
};

const excludeByTier: Record<TestTier, string[]> = {
  fast: ["src/**/*.risk.test.ts", "src/**/*.live.test.ts"],
  risk: ["src/**/*.live.test.ts"],
  live: [],
  all: ["src/**/*.live.test.ts"],
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
      all: true,
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.d.ts", "**/types.ts"],
    },
    testTimeout: 10000,
  },
});
