import path from "path";
import { describe, expect, it } from "vitest";

import {
  buildDashboardDescription,
  createDashboardModuleEntry,
  createDashboardStatus,
  normalizeRelativeModulePath,
  refreshDashboardModule,
} from "./dashboard";

describe("additional dashboard helpers", () => {
  it("normalizes file URLs, strips query/hash fragments, and preserves external absolute paths", () => {
    const insideCwd = `file://${path.join(
      process.cwd(),
      "src",
      "lib",
      "config",
      "index.test.ts"
    )}?v=1#hash`;

    expect(normalizeRelativeModulePath(insideCwd)).toBe("src/lib/config/index.test.ts");
    expect(normalizeRelativeModulePath("/tmp/seqdesk-external.test.ts")).toBe(
      "/tmp/seqdesk-external.test.ts"
    );
    expect(normalizeRelativeModulePath("src/lib/demo/client.test.ts?raw#fragment")).toBe(
      "src/lib/demo/client.test.ts"
    );
  });

  it("uses the waiting description for empty case lists and honors refresh overrides", () => {
    const entry = createDashboardModuleEntry("src/lib/files/scanner.test.ts");
    const refreshed = refreshDashboardModule(
      {
        ...entry,
        state: "failed",
        lastError: null,
      },
      {
        lastError: "override error",
      },
      "2026-03-24T11:00:00.000Z"
    );

    expect(buildDashboardDescription([])).toBe("Waiting for test cases to be collected.");
    expect(refreshed.description).toBe("Waiting for test cases to be collected.");
    expect(refreshed.lastError).toBe("override error");
    expect(refreshed.updatedAt).toBe("2026-03-24T11:00:00.000Z");
  });

  it("sorts modules and builds a full dashboard status payload", () => {
    const configModule = refreshDashboardModule(
      {
        ...createDashboardModuleEntry("src/lib/config/index.test.ts"),
        state: "passed",
        cases: [
          {
            id: "1",
            name: "config passes",
            fullName: "config passes",
            suitePath: "config",
            state: "passed",
            durationMs: 5,
            errorMessage: null,
          },
        ],
      },
      {},
      "2026-03-24T11:05:00.000Z"
    );

    const ordersRoute = refreshDashboardModule(
      {
        ...createDashboardModuleEntry("src/app/api/orders/[id]/route.test.ts"),
        state: "pending",
        cases: [
          {
            id: "2",
            name: "orders pending",
            fullName: "orders pending",
            suitePath: "orders",
            state: "pending",
            durationMs: null,
            errorMessage: null,
          },
        ],
      },
      {},
      "2026-03-24T11:06:00.000Z"
    );

    const status = createDashboardStatus({
      state: "running",
      tier: "fast",
      mode: "watch",
      modules: [configModule, ordersRoute],
      filters: ["src/lib", "src/app/api"],
      startedAt: "2026-03-24T11:00:00.000Z",
      reason: "manual run",
      note: "watching",
      updatedAt: "2026-03-24T11:06:00.000Z",
    });

    expect(status.modules.map((moduleEntry) => moduleEntry.relativePath)).toEqual([
      "src/app/api/orders/[id]/route.test.ts",
      "src/lib/config/index.test.ts",
    ]);
    expect(status.run).toEqual({
      state: "running",
      tier: "fast",
      mode: "watch",
      filters: ["src/lib", "src/app/api"],
      startedAt: "2026-03-24T11:00:00.000Z",
      finishedAt: null,
      updatedAt: "2026-03-24T11:06:00.000Z",
      reason: "manual run",
      errorCount: 0,
    });
    expect(status.totals).toEqual({
      modules: 2,
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
      running: 0,
      passedModules: 1,
      failedModules: 0,
      skippedModules: 0,
      runningModules: 0,
      queuedModules: 0,
      pendingModules: 1,
    });
    expect(status.note).toBe("watching");
  });
});
