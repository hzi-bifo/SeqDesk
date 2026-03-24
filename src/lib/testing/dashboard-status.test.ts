import { promises as fs } from "fs";
import { afterEach, describe, expect, it } from "vitest";

import type { DashboardStatus } from "./dashboard";
import {
  clearDashboardStatus,
  getDashboardDirectory,
  getDashboardStatusFilePath,
  readDashboardStatus,
  writeDashboardStatus,
} from "./dashboard-status";

const testFilePath = getDashboardStatusFilePath("status.unit-test.json");

const statusFixture: DashboardStatus = {
  version: 1,
  run: {
    state: "passed",
    tier: "fast",
    mode: "run",
    filters: ["src/lib"],
    startedAt: "2026-03-24T10:00:00.000Z",
    finishedAt: "2026-03-24T10:01:00.000Z",
    updatedAt: "2026-03-24T10:01:00.000Z",
    reason: null,
    errorCount: 0,
  },
  totals: {
    modules: 1,
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    pending: 0,
    running: 0,
    passedModules: 1,
    failedModules: 0,
    skippedModules: 0,
    runningModules: 0,
    queuedModules: 0,
    pendingModules: 0,
  },
  modules: [],
  note: null,
};

afterEach(async () => {
  await fs.rm(testFilePath, { force: true });
});

describe("dashboard status storage", () => {
  it("builds paths inside the dashboard directory", () => {
    expect(getDashboardDirectory()).toContain(".test-dashboard");
    expect(getDashboardStatusFilePath("custom.json")).toBe(
      `${getDashboardDirectory()}/custom.json`
    );
  });

  it("returns null for missing or invalid status files", async () => {
    expect(await readDashboardStatus(testFilePath)).toBeNull();

    await fs.mkdir(getDashboardDirectory(), { recursive: true });
    await fs.writeFile(testFilePath, "{not-json", "utf-8");

    expect(await readDashboardStatus(testFilePath)).toBeNull();
  });

  it("writes, reads, and clears dashboard status files", async () => {
    await writeDashboardStatus(statusFixture, testFilePath);

    const raw = await fs.readFile(testFilePath, "utf-8");
    expect(raw).toContain('"state": "passed"');

    expect(await readDashboardStatus(testFilePath)).toEqual(statusFixture);

    await clearDashboardStatus(testFilePath);
    expect(await readDashboardStatus(testFilePath)).toBeNull();
  });
});
