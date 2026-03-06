import { describe, expect, it } from "vitest";
import {
  buildDashboardDescription,
  calculateDashboardTotals,
  createDashboardModuleEntry,
  refreshDashboardModule,
  resolveDashboardSection,
  resolveDashboardTitle,
  resolveDashboardModuleTier,
} from "./dashboard";

describe("testing dashboard helpers", () => {
  it("derives readable sections from library and api test paths", () => {
    expect(resolveDashboardSection("src/lib/pipelines/nextflow/trace-parser.test.ts")).toBe(
      "Pipelines / Nextflow"
    );
    expect(resolveDashboardSection("src/app/api/orders/[id]/route.test.ts")).toBe(
      "API / Orders"
    );
    expect(
      resolveDashboardSection("src/app/api/admin/settings/pipelines/install/route.test.ts")
    ).toBe("Admin API / Pipelines");
    expect(resolveDashboardSection("playwright/tests/order-create.spec.ts")).toBe(
      "Playwright E2E"
    );
  });

  it("derives readable titles for route and file tests", () => {
    expect(resolveDashboardTitle("src/lib/config/version-response.test.ts")).toBe(
      "Version Response"
    );
    expect(resolveDashboardTitle("src/app/api/orders/[id]/route.test.ts")).toBe("Orders route");
    expect(
      resolveDashboardTitle("src/app/api/admin/settings/pipelines/install/route.test.ts")
    ).toBe("Pipelines Install route");
    expect(resolveDashboardTitle("playwright/tests/order-create.spec.ts")).toBe("Order Create");
  });

  it("infers test tiers from file suffixes", () => {
    expect(resolveDashboardModuleTier("src/lib/config/index.test.ts")).toBe("fast");
    expect(resolveDashboardModuleTier("src/lib/config/index.risk.test.ts")).toBe("risk");
    expect(resolveDashboardModuleTier("src/lib/config/index.live.test.ts")).toBe("live");
    expect(resolveDashboardModuleTier("playwright/tests/order-create.spec.ts")).toBe("ui");
  });

  it("builds a compact description preview from collected case names", () => {
    expect(
      buildDashboardDescription([
        "parses manifest defaults",
        "rejects malformed yaml",
        "keeps registry order stable",
        "parses manifest defaults",
      ])
    ).toBe(
      "parses manifest defaults; rejects malformed yaml; keeps registry order stable"
    );

    expect(
      buildDashboardDescription([
        "case one",
        "case two",
        "case three",
        "case four",
      ])
    ).toBe("case one; case two; case three; +1 more");
  });

  it("recomputes module counts from live case states", () => {
    const baseEntry = createDashboardModuleEntry("src/lib/files/scanner.test.ts");
    const refreshed = refreshDashboardModule({
      ...baseEntry,
      state: "running",
      cases: [
        {
          id: "a",
          name: "finds fastq files",
          fullName: "scanner > finds fastq files",
          suitePath: "scanner",
          state: "passed",
          durationMs: 14,
          errorMessage: null,
        },
        {
          id: "b",
          name: "skips temp folders",
          fullName: "scanner > skips temp folders",
          suitePath: "scanner",
          state: "failed",
          durationMs: 22,
          errorMessage: "expected keep.fastq.gz",
        },
        {
          id: "c",
          name: "sorts filenames",
          fullName: "scanner > sorts filenames",
          suitePath: "scanner",
          state: "running",
          durationMs: null,
          errorMessage: null,
        },
      ],
    });

    expect(refreshed.counts).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
      running: 1,
    });
    expect(refreshed.description).toBe(
      "scanner > finds fastq files; scanner > skips temp folders; scanner > sorts filenames"
    );
    expect(refreshed.lastError).toBe("expected keep.fastq.gz");
  });

  it("summarizes totals across module states", () => {
    const passed = refreshDashboardModule({
      ...createDashboardModuleEntry("src/lib/files/scanner.test.ts"),
      state: "passed",
      cases: [
        {
          id: "1",
          name: "case",
          fullName: "case",
          suitePath: null,
          state: "passed",
          durationMs: 5,
          errorMessage: null,
        },
      ],
    });
    const failed = refreshDashboardModule({
      ...createDashboardModuleEntry("src/lib/config/index.test.ts"),
      state: "failed",
      cases: [
        {
          id: "2",
          name: "case",
          fullName: "case",
          suitePath: null,
          state: "failed",
          durationMs: 5,
          errorMessage: "boom",
        },
      ],
    });
    const queued = createDashboardModuleEntry("src/lib/license/index.test.ts");

    expect(calculateDashboardTotals([passed, failed, queued])).toEqual({
      modules: 3,
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
      running: 0,
      passedModules: 1,
      failedModules: 1,
      skippedModules: 0,
      runningModules: 0,
      queuedModules: 1,
      pendingModules: 0,
    });
  });
});
