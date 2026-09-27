import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db = {
    exploreFlow: { findUnique: fn(), delete: fn() },
    exploreArtifact: { findMany: fn() },
    exploreDataset: { findMany: fn(), deleteMany: fn() },
    exploreReport: { findMany: fn() },
    exploreRunHold: { findMany: fn() },
    exploreAnalysis: { findMany: fn() },
    exploreAnalysisRevision: { count: fn(), findMany: fn() },
    exploreAnalysisRun: { findMany: fn() },
    exploreCapsule: { findMany: fn() },
    exploreFlowRun: { findMany: fn(), updateMany: fn() },
    exploreDatasetVersion: { findMany: fn(), deleteMany: fn() },
    exploreCleanupJob: { findMany: fn(), findFirst: fn(), create: fn(), update: fn() },
    $queryRaw: fn(),
    $executeRaw: fn(),
    $transaction: fn(),
  };
  return { db, storage: { baseDir: "", datasetsRoot: "", importsRoot: "", runsRoot: "" } };
});
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("./storage", async (original) => ({ ...(await original<typeof import("./storage")>()), resolveExploreStorage: async () => m.storage }));

import { deleteFlowWithOutputs, planPrune, processCleanupJobs, pruneRuns, runDailyPrune } from "./housekeeping";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-27T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day);

function run(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, flowId: "f1", number: Number(id.replace(/\D/g, "")) || 1, trialNumber: null, status: "completed", completedAt: ago(60), queuedAt: ago(60), outputsPrunedAt: null,
    plan: [], inputs: [], flow: { name: "Airway", targetKey: "project:p1", currentRunId: "r9" }, holds: [],
    stepRuns: [{ id: `s-${id}`, runNumber: `EXP-${id}`, runFolder: `/runs/${id}`, reusedFromRunId: null, inputPins: null, artifacts: [{ id: `a-${id}`, derivedDatasetId: "d1", derivedVersionId: `v-${id}` }] }],
    ...extra,
  };
}

let tmp = "";
beforeEach(async () => {
  vi.clearAllMocks();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "housekeeping-"));
  Object.assign(m.storage, { baseDir: path.join(tmp, "explore"), datasetsRoot: path.join(tmp, "explore", "datasets"), importsRoot: path.join(tmp, "explore", "imports"), runsRoot: path.join(tmp, "runs") });
  m.db.$transaction.mockImplementation(async (work: (tx: typeof m.db) => unknown) => work(m.db));
  m.db.exploreReport.findMany.mockResolvedValue([]);
  m.db.exploreRunHold.findMany.mockResolvedValue([]);
  m.db.exploreDataset.findMany.mockResolvedValue([]);
  m.db.exploreArtifact.findMany.mockResolvedValue([]);
  m.db.exploreAnalysisRevision.findMany.mockResolvedValue([]);
  m.db.exploreAnalysisRevision.count.mockResolvedValue(0);
  m.db.$queryRaw.mockResolvedValue([{ n: BigInt(0) }]);
  m.db.exploreCleanupJob.create.mockResolvedValue({ id: "job1" });
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("deleting an analysis", () => {
  beforeEach(() => {
    m.db.exploreFlow.findUnique.mockResolvedValue({ id: "f1", targetKey: "project:p1", analyses: [{ id: "an1" }] });
    m.db.exploreAnalysis.findMany.mockResolvedValue([{ id: "an1" }]);
    m.db.exploreArtifact.findMany.mockResolvedValue([{ derivedDatasetId: "d1" }, { derivedDatasetId: "d2" }]);
    m.db.exploreAnalysisRun.findMany.mockResolvedValue([{ runFolder: "/runs/EXP-1" }, { runFolder: null }]);
    m.db.exploreCapsule.findMany.mockResolvedValue([{ path: "/explore/capsules/c1.zip" }]);
  });

  it("refuses while a report cites it, naming the reports", async () => {
    m.db.exploreReport.findMany.mockResolvedValue([{ id: "rep1", title: "Airway results", blocks: [{ type: "figure", analysisId: "an1" }], review: null }, { id: "rep2", title: "Other", blocks: [], review: null }]);
    await expect(deleteFlowWithOutputs("f1")).rejects.toMatchObject({ status: 409, code: "cited", message: expect.stringContaining("“Airway results”"), extra: { citations: { reports: [{ id: "rep1", title: "Airway results" }] } } });
    expect(m.db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses while Writer holds one of its values", async () => {
    m.db.exploreRunHold.findMany.mockResolvedValue([{ kind: "writer", key: "an1.fc", flowRun: { number: 2 } }]);
    await expect(deleteFlowWithOutputs("f1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Writer") });
  });

  it("removes inputs, the flow and its own output tables in one transaction and queues their files", async () => {
    m.db.$queryRaw.mockResolvedValueOnce([{ n: BigInt(0) }]).mockResolvedValueOnce([{ n: BigInt(1) }]); // d2 is another flow's input
    m.db.$executeRaw.mockResolvedValue(2);
    const result = await deleteFlowWithOutputs("f1");
    expect(result).toMatchObject({ datasets: ["d1"], keptDatasets: ["d2"], inputs: 2, jobId: "job1" });
    expect(m.db.$transaction).toHaveBeenCalledTimes(1);
    expect(m.db.exploreFlow.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(m.db.exploreDataset.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["d1"] } } });
    const entries = m.db.exploreCleanupJob.create.mock.calls[0][0].data.entries.map((entry: { path: string }) => entry.path);
    expect(entries).toEqual(["/runs/EXP-1", "/explore/capsules/c1.zip", path.join(m.storage.datasetsRoot, "d1")]);
  });
});

describe("pruning old run outputs", () => {
  beforeEach(() => {
    m.db.exploreDatasetVersion.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, datasetId: "d1", number: 1, rowCount: 10, storagePath: `/explore/datasets/d1/${id}`, dataset: { currentVersionId: "v-r9" } })));
  });

  it("keeps current, recent, held, cited and reused runs and lists the rest", async () => {
    m.db.exploreFlowRun.findMany.mockResolvedValue([
      run("r1"),
      run("r2", { completedAt: ago(3) }),
      run("r3", { holds: [{ id: "h" }] }),
      run("r4"),
      run("r5"),
      run("r6", { status: "running" }),
      run("r7", { outputsPrunedAt: ago(1) }),
      run("r9", { completedAt: ago(40), plan: [{ reusedFrom: "s-r5" }] }),
    ]);
    m.db.exploreReport.findMany.mockResolvedValue([{ id: "rep", title: "T", blocks: [{ type: "metric", pin: { run: "EXP-r4" } }], review: null }]);
    const plan = await planPrune({ now, olderThanDays: 30 });
    expect(plan.runs.map((entry) => entry.id)).toEqual(["r1"]);
    expect(plan.kept).toEqual({ current: 1, recent: 1, held: 1, cited: 1, reused: 1, unfinished: 1 });
    expect(plan.alreadyPruned).toBe(1);
    expect(plan.runs[0].versions.map((version) => version.id)).toEqual(["v-r1"]);
  });

  it("a dry run changes nothing; a real prune stamps runs, drops old versions and queues the files", async () => {
    m.db.exploreFlowRun.findMany.mockResolvedValue([run("r1"), run("r9")]);
    const dry = await pruneRuns({ now, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, jobId: null, runs: [{ id: "r1" }] });
    expect(m.db.$transaction).not.toHaveBeenCalled();

    const real = await pruneRuns({ now });
    expect(real).toMatchObject({ dryRun: false, jobId: "job1", prunedAt: now.toISOString() });
    expect(m.db.exploreDatasetVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["v-r1"] } } });
    expect(m.db.exploreFlowRun.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1"] }, outputsPrunedAt: null }, data: { outputsPrunedAt: now } });
    expect(m.db.exploreCleanupJob.create.mock.calls[0][0].data.entries).toEqual([{ path: "/runs/r1", mode: "run-outputs" }, { path: "/explore/datasets/d1/v-r1", mode: "remove" }]);
  });

  it("never deletes a dataset's current version", async () => {
    m.db.exploreFlowRun.findMany.mockResolvedValue([run("r1", { stepRuns: [{ ...run("r1").stepRuns[0], artifacts: [{ id: "a", derivedDatasetId: "d1", derivedVersionId: "v-r9" }] }] }), run("r9")]);
    const plan = await planPrune({ now });
    expect(plan.runs[0].versions).toEqual([]);
  });

  it("the daily pass runs once per day", async () => {
    m.db.exploreFlowRun.findMany.mockResolvedValue([]);
    m.db.exploreCleanupJob.findFirst.mockResolvedValue({ createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) });
    expect(await runDailyPrune(now)).toBeNull();
    m.db.exploreCleanupJob.findFirst.mockResolvedValue({ createdAt: ago(2) });
    expect(await runDailyPrune(now)).toMatchObject({ runs: [] });
    expect(m.db.exploreCleanupJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "prune-pass" }) });
  });
});

describe("the background file cleanup", () => {
  it("removes whole folders, strips run outputs to the manifest and refuses paths outside storage", async () => {
    const folder = path.join(m.storage.runsRoot, "EXP-1");
    for (const dir of ["outputs", "inputs", "tmp", "logs"]) await fs.mkdir(path.join(folder, dir), { recursive: true });
    await fs.writeFile(path.join(folder, "outputs", "manifest.json"), "{}");
    await fs.writeFile(path.join(folder, "outputs", "table.tsv"), "a\tb\n");
    await fs.writeFile(path.join(folder, "inputs", "counts.tsv"), "x");
    await fs.writeFile(path.join(folder, "logs", "pipeline.out"), "ok");
    const dataset = path.join(m.storage.datasetsRoot, "d1");
    await fs.mkdir(path.join(dataset, "v1"), { recursive: true });
    const outside = path.join(tmp, "elsewhere");
    await fs.mkdir(outside);
    m.db.exploreCleanupJob.findMany.mockResolvedValue([
      { id: "j1", attempts: 0, entries: [{ path: folder, mode: "run-outputs" }, { path: dataset, mode: "remove" }] },
      { id: "j2", attempts: 0, entries: [{ path: outside, mode: "remove" }, { path: m.storage.runsRoot, mode: "remove" }] },
    ]);
    expect(await processCleanupJobs()).toEqual({ done: 1, failed: 1 });
    expect((await fs.readdir(path.join(folder, "outputs"))).sort()).toEqual(["manifest.json"]);
    await expect(fs.access(path.join(folder, "inputs"))).rejects.toThrow();
    await expect(fs.access(path.join(folder, "logs", "pipeline.out"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(folder, "PRUNED"))).resolves.toBeUndefined();
    await expect(fs.access(dataset)).rejects.toThrow();
    await expect(fs.access(outside)).resolves.toBeUndefined();
    expect(m.db.exploreCleanupJob.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: expect.objectContaining({ status: "done" }) });
    expect(m.db.exploreCleanupJob.update).toHaveBeenCalledWith({ where: { id: "j2" }, data: expect.objectContaining({ status: "failed", error: expect.stringContaining("outside Explore storage") }) });
  });
});
