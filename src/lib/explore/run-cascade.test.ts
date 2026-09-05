import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    exploreAnalysisRun: { findUnique: vi.fn() },
    exploreDataset: { findMany: vi.fn() },
    exploreAnalysis: { findMany: vi.fn() },
    exploreAnalysisRevision: { findMany: vi.fn() },
  },
  createAndStartRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("./runner", () => ({
  createAndStartRun: mocks.createAndStartRun,
  ExploreRunError: class ExploreRunError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { cascadeFromRun } from "./run-cascade";

const finished = new Date("2026-09-05T10:00:00Z");
const version = (datasetId: string, writtenBy: string) => ({
  id: `v-${datasetId}`,
  provenance: JSON.stringify({ builtAt: finished.toISOString(), builder: "analysis-run@1", sources: [{ type: "analysis-run", id: writtenBy, label: "EXP-1" }] }),
});

describe("cascadeFromRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.exploreAnalysisRun.findUnique.mockResolvedValue({
      id: "run-x",
      status: "completed",
      executionMode: "local",
      completedAt: finished,
      createdAt: new Date("2026-09-05T09:55:00Z"),
      analysis: { id: "x", targetKey: "study:s1" },
    });
    mocks.db.exploreDataset.findMany.mockResolvedValue([
      { id: "out-x", currentVersionId: "v-out-x", versions: [version("out-x", "run-x")] },
      { id: "out-old", currentVersionId: "v-out-old", versions: [version("out-old", "run-older")] },
    ]);
    mocks.db.exploreAnalysis.findMany.mockResolvedValue([
      { id: "x", name: "X", currentRevisionId: "rx", runs: [{ status: "completed", createdAt: new Date("2026-09-05T09:55:00Z") }] },
      { id: "y", name: "Y", currentRevisionId: "ry", runs: [{ status: "completed", createdAt: new Date("2026-09-05T09:00:00Z") }] },
      { id: "busy", name: "Busy", currentRevisionId: "rb", runs: [{ status: "running", createdAt: new Date("2026-09-05T09:58:00Z") }] },
      { id: "fresh", name: "Fresh", currentRevisionId: "rf", runs: [{ status: "completed", createdAt: new Date("2026-09-05T10:05:00Z") }] },
      { id: "unrelated", name: "Unrelated", currentRevisionId: "ru", runs: [] },
    ]);
    mocks.db.exploreAnalysisRevision.findMany.mockResolvedValue([
      { id: "rx", inputs: JSON.stringify([{ alias: "table", datasetId: "in" }]) },
      { id: "ry", inputs: JSON.stringify([{ alias: "table", datasetId: "out-x" }]) },
      { id: "rb", inputs: JSON.stringify([{ alias: "table", datasetId: "out-x" }]) },
      { id: "rf", inputs: JSON.stringify([{ alias: "table", datasetId: "out-x" }]) },
      { id: "ru", inputs: JSON.stringify([{ alias: "table", datasetId: "out-old" }]) },
    ]);
    mocks.createAndStartRun.mockImplementation(async ({ analysisId }: { analysisId: string }) => ({ id: `run-${analysisId}`, runNumber: `EXP-${analysisId}` }));
  });

  it("starts the analyses that read a table the run changed, and only those", async () => {
    const result = await cascadeFromRun("run-x", "u1");
    expect(result.changedDatasets).toEqual(["out-x"]);
    expect(result.started.map((entry) => entry.analysisId)).toEqual(["y"]);
    expect(mocks.createAndStartRun).toHaveBeenCalledWith({ analysisId: "y", executionMode: "local", createdById: "u1" });
    expect(result.skipped).toEqual([
      { analysisId: "busy", name: "Busy", reason: "already running" },
      { analysisId: "fresh", name: "Fresh", reason: "ran after this run finished" },
    ]);
  });

  it("does nothing when the run changed no table or is not finished", async () => {
    mocks.db.exploreDataset.findMany.mockResolvedValue([{ id: "out-x", currentVersionId: "v", versions: [version("out-x", "run-older")] }]);
    expect((await cascadeFromRun("run-x", "u1")).started).toEqual([]);
    mocks.db.exploreAnalysisRun.findUnique.mockResolvedValue({ id: "run-x", status: "running", analysis: { id: "x", targetKey: "study:s1" } });
    expect((await cascadeFromRun("run-x", "u1")).changedDatasets).toEqual([]);
    expect(mocks.createAndStartRun).not.toHaveBeenCalled();
  });
});
