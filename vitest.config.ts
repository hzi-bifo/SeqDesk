import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/files/**",
        "src/lib/excel/**",
        "src/lib/ena/**",
        "src/lib/license/**",
        "src/lib/pipelines/**",
        "src/lib/config/**",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/types.ts"],
    },
    testTimeout: 10000,
  },
});
