import path from "path";
import { describe, expect, it } from "vitest";

import {
  buildDashboardDescription,
  calculateDashboardModuleCounts,
  calculateDashboardTotals,
  createDashboardModuleEntry,
  createDashboardStatus,
  normalizeRelativeModulePath,
  refreshDashboardModule,
  resolveDashboardSection,
  resolveDashboardTitle,
  sortDashboardModules,
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

  it("handles uppercase tokens, non-dashboard sections, and title/path tie-break sorting", () => {
    expect(resolveDashboardTitle("src/lib/ABC123.test.ts")).toBe("ABC123");
    expect(resolveDashboardTitle("src/lib/...test.ts")).toBe("General");
    expect(resolveDashboardTitle("src/lib/mixs_qc.test.ts")).toBe("MIxS QC");
    expect(resolveDashboardSection("scripts/custom.test.ts")).toBe("Other");
    expect(resolveDashboardSection("src/lib/pipelines/index.test.ts")).toBe("Pipelines");
    expect(resolveDashboardTitle("src/app/api/admin/settings/route.test.ts")).toBe(
      "Route route"
    );

    const byTitle = sortDashboardModules([
      {
        ...createDashboardModuleEntry("src/lib/config/zeta.test.ts"),
        section: "Config",
        title: "Zeta",
      },
      {
        ...createDashboardModuleEntry("src/lib/config/alpha.test.ts"),
        section: "Config",
        title: "Alpha",
      },
    ]);
    expect(byTitle.map((moduleEntry) => moduleEntry.title)).toEqual(["Alpha", "Zeta"]);

    const byRelativePath = sortDashboardModules([
      {
        ...createDashboardModuleEntry("src/lib/config/index.test.ts"),
        section: "Config",
        title: "Index",
        relativePath: "src/lib/config/index.test.ts",
      },
      {
        ...createDashboardModuleEntry("src/lib/config/index.spec.ts"),
        section: "Config",
        title: "Index",
        relativePath: "src/lib/config/index.spec.ts",
      },
    ]);
    expect(byRelativePath.map((moduleEntry) => moduleEntry.relativePath)).toEqual([
      "src/lib/config/index.spec.ts",
      "src/lib/config/index.test.ts",
    ]);
  });

  it("counts all dashboard case states", () => {
    expect(
      calculateDashboardModuleCounts([
        {
          id: "1",
          name: "passed",
          fullName: "passed",
          suitePath: null,
          state: "passed",
          durationMs: 1,
          errorMessage: null,
        },
        {
          id: "2",
          name: "failed",
          fullName: "failed",
          suitePath: null,
          state: "failed",
          durationMs: 1,
          errorMessage: "boom",
        },
        {
          id: "3",
          name: "skipped",
          fullName: "skipped",
          suitePath: null,
          state: "skipped",
          durationMs: null,
          errorMessage: null,
        },
        {
          id: "4",
          name: "pending",
          fullName: "pending",
          suitePath: null,
          state: "pending",
          durationMs: null,
          errorMessage: null,
        },
        {
          id: "5",
          name: "running",
          fullName: "running",
          suitePath: null,
          state: "running",
          durationMs: null,
          errorMessage: null,
        },
      ])
    ).toEqual({
      total: 5,
      passed: 1,
      failed: 1,
      skipped: 1,
      pending: 1,
      running: 1,
    });
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

  it("counts collecting modules as pending in dashboard totals", () => {
    const collectingModule = refreshDashboardModule(
      {
        ...createDashboardModuleEntry("src/lib/testing/dashboard.test.ts"),
        state: "collecting",
      },
      {},
      "2026-03-24T11:10:00.000Z"
    );

    const status = createDashboardStatus({
      state: "collecting",
      tier: "fast",
      mode: "run",
      modules: [collectingModule],
      updatedAt: "2026-03-24T11:10:00.000Z",
    });

    expect(status.totals.pendingModules).toBe(1);
  });

  it("tracks skipped and running module totals and uses default status fields", () => {
    const skippedModule = refreshDashboardModule(
      {
        ...createDashboardModuleEntry("src/lib/license/index.test.ts"),
        state: "skipped",
        cases: [],
      },
      {},
      "2026-03-24T11:12:00.000Z"
    );
    const runningModule = refreshDashboardModule(
      {
        ...createDashboardModuleEntry("src/lib/files/scanner.test.ts"),
        state: "running",
        cases: [],
      },
      {},
      "2026-03-24T11:13:00.000Z"
    );

    expect(calculateDashboardTotals([skippedModule, runningModule])).toEqual({
      modules: 2,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      running: 0,
      passedModules: 0,
      failedModules: 0,
      skippedModules: 1,
      runningModules: 1,
      queuedModules: 0,
      pendingModules: 0,
    });

    const status = createDashboardStatus({
      state: "idle",
      tier: "all",
      mode: "run",
    });

    expect(status.run.filters).toEqual([]);
    expect(status.run.startedAt).toBeNull();
    expect(status.run.finishedAt).toBeNull();
    expect(status.run.reason).toBeNull();
    expect(status.run.errorCount).toBe(0);
    expect(status.note).toBeNull();
    expect(status.modules).toEqual([]);
  });
});
