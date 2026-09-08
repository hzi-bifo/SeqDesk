import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    exploreAnalysisRun: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    exploreArtifact: { upsert: vi.fn(), update: vi.fn() },
    exploreDataset: { findMany: vi.fn(), update: vi.fn() },
  },
  createDataset: vi.fn(),
  writeDatasetVersion: vi.fn(),
  readTail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("./datasets", () => ({ createDataset: mocks.createDataset, writeDatasetVersion: mocks.writeDatasetVersion }));
vi.mock("@/lib/pipelines/nextflow", () => ({ readTail: mocks.readTail }));

import { finalizeExploreRun } from "./run-finalize";

describe("finalizeExploreRun", () => {
  let runFolder: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    runFolder = await fs.mkdtemp(path.join(os.tmpdir(), "explore-run-"));
    await fs.mkdir(path.join(runFolder, "outputs"), { recursive: true });
    await fs.writeFile(path.join(runFolder, "inputs.json"), JSON.stringify({ inputs: { table: { datasetId: "d1", versionId: "v1", sensitivity: "pseudonymous" } } }));
    mocks.db.exploreAnalysisRun.findUnique.mockResolvedValue({
      id: "run1",
      runNumber: "EXP-20260904-001",
      runFolder,
      analysisId: "a1",
      analysis: { targetKey: "study:s1", name: "Table summary", createdById: "u1" },
      revision: { number: 2 },
    });
    mocks.db.exploreAnalysisRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.exploreArtifact.upsert.mockImplementation(async ({ create }: { create: { path: string } }) => ({ id: `art-${path.basename(create.path)}` }));
    mocks.db.exploreArtifact.update.mockResolvedValue({});
    mocks.createDataset.mockResolvedValue({ id: "derived1" });
    mocks.db.exploreDataset.findMany.mockResolvedValue([]);
    mocks.db.exploreAnalysisRun.findMany.mockResolvedValue([{ id: "old" }]);
    mocks.db.exploreDataset.update.mockResolvedValue({ id: "derived-existing" });
    mocks.writeDatasetVersion.mockResolvedValue({ versionId: "dv1", number: 1, rowCount: 2, contentHash: "h", unchanged: false });
    mocks.readTail.mockResolvedValue("tail");
  });

  afterEach(async () => {
    await fs.rm(runFolder, { recursive: true, force: true });
  });

  it("records figures, promotes tables to derived datasets and completes the run", async () => {
    await fs.writeFile(path.join(runFolder, "outputs", "overview.plotly.json"), JSON.stringify({ data: [], layout: {} }));
    await fs.writeFile(path.join(runFolder, "outputs", "summary.tsv"), "sample\tmean\nS1\t1.5\nS2\t2\n");
    await fs.writeFile(
      path.join(runFolder, "outputs", "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        artifacts: [
          { name: "overview", kind: "figure", format: "plotly-json", path: "outputs/overview.plotly.json", title: "Overview" },
          { name: "summary", kind: "table", format: "tsv", path: "outputs/summary.tsv", title: "Summary", table: { tableKind: "sample-summary", roles: { sample: "sample" } } },
          { name: "escape", kind: "table", format: "tsv", path: "../../etc/passwd" },
          { name: "missing", kind: "figure", format: "png", path: "outputs/nope.png" },
        ],
        notes: ["kaleido missing, no PNG"],
        metrics: { n_rows: 2 },
      })
    );

    await finalizeExploreRun("run1", 0);

    expect(mocks.db.exploreArtifact.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "derived", tableKind: "sample-summary", targetKey: "study:s1", sensitivity: "pseudonymous", roles: { sample: "sample" } })
    );
    expect(mocks.writeDatasetVersion).toHaveBeenCalledWith(expect.objectContaining({ datasetId: "derived1", buildSource: "analysis-run" }));
    expect(mocks.writeDatasetVersion.mock.calls[0][0].rows).toEqual([{ sample: "S1", mean: "1.5" }, { sample: "S2", mean: "2" }]);
    expect(mocks.db.exploreArtifact.update).toHaveBeenCalledWith({ where: { id: "art-summary.tsv" }, data: { derivedDatasetId: "derived1" } });

    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("completed");
    const results = JSON.parse(update.data.results);
    expect(results).toMatchObject({ exitCode: 0, figures: 1, tables: 1, metrics: { n_rows: 2 } });
    expect(results.warnings).toEqual([expect.stringMatching(/outside the run folder/), expect.stringMatching(/file not found/)]);
    expect(results.notes).toEqual(["kaleido missing, no PNG"]);
  });

  it("fails the run with a warning when the manifest is missing after a successful exit", async () => {
    await finalizeExploreRun("run1", 0);
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("completed");
    expect(JSON.parse(update.data.results).warnings[0]).toMatch(/no outputs\/manifest.json/);
  });

  it("marks non-zero exits as failed without complaining about outputs", async () => {
    await finalizeExploreRun("run1", 2);
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("failed");
    expect(update.data.exitCode).toBe(2);
    expect(JSON.parse(update.data.results).warnings).toEqual([]);
  });

  it("records the outputs of a failed run but does not promote its tables", async () => {
    await fs.writeFile(path.join(runFolder, "outputs", "summary.tsv"), "sample\tmean\nS1\t1\n");
    await fs.writeFile(
      path.join(runFolder, "outputs", "manifest.json"),
      JSON.stringify({ manifestVersion: 1, artifacts: [{ name: "summary", kind: "table", format: "tsv", path: "outputs/summary.tsv", title: "Summary" }] })
    );
    await finalizeExploreRun("run1", 1);
    // The partial table is still recorded, so it can be inspected from the run page.
    expect(mocks.db.exploreArtifact.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.writeDatasetVersion).not.toHaveBeenCalled();
    expect(mocks.db.exploreArtifact.update).not.toHaveBeenCalled();
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("failed");
    expect(JSON.parse(update.data.results)).toMatchObject({ tables: 1, warnings: [expect.stringMatching(/not promoted.*run failed/)] });
  });

  it("writes a new version of the existing output dataset on a re-run", async () => {
    mocks.db.exploreDataset.findMany.mockResolvedValue([
      { id: "derived-existing", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "a1", artifactName: "summary", runId: "old" }) },
    ]);
    await fs.writeFile(path.join(runFolder, "outputs", "summary.tsv"), "sample\tmean\nS1\t1\n");
    await fs.writeFile(
      path.join(runFolder, "outputs", "manifest.json"),
      JSON.stringify({ manifestVersion: 1, artifacts: [{ name: "summary", kind: "table", format: "tsv", path: "outputs/summary.tsv", title: "Summary" }] })
    );
    await finalizeExploreRun("run1", 0);
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.db.exploreDataset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "derived-existing" } }));
    expect(mocks.writeDatasetVersion).toHaveBeenCalledWith(expect.objectContaining({ datasetId: "derived-existing" }));
  });

  it("adopts an output dataset written before artifact names were recorded", async () => {
    mocks.db.exploreDataset.findMany.mockResolvedValue([
      { id: "legacy", name: "Summary (Table summary, EXP-1)", sourceConfig: JSON.stringify({ builder: "analysis-run", runId: "old", artifactId: "x" }) },
    ]);
    await fs.writeFile(path.join(runFolder, "outputs", "summary.tsv"), "sample\tmean\nS1\t1\n");
    await fs.writeFile(
      path.join(runFolder, "outputs", "manifest.json"),
      JSON.stringify({ manifestVersion: 1, artifacts: [{ name: "summary", kind: "table", format: "tsv", path: "outputs/summary.tsv", title: "Summary" }] })
    );
    await finalizeExploreRun("run1", 0);
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.db.exploreDataset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "legacy" } }));
  });
});
