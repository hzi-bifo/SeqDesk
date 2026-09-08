import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { exploreAnalysisRun: { updateMany: vi.fn(), findMany: vi.fn() } },
  readTail: vi.fn(),
  inferPipelineExitCode: vi.fn(),
  readIdentityCheckedQueueSnapshot: vi.fn(),
  finalizeExploreRun: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mocks.db }));
vi.mock("../src/lib/pipelines/nextflow", () => ({ readTail: mocks.readTail }));
vi.mock("../src/lib/pipelines/run-completion", () => ({ inferPipelineExitCode: mocks.inferPipelineExitCode }));
vi.mock("../src/lib/pipelines/queue-probe", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pipelines/queue-probe")>("../src/lib/pipelines/queue-probe");
  return { ...actual, readIdentityCheckedQueueSnapshot: mocks.readIdentityCheckedQueueSnapshot };
});
vi.mock("../src/lib/explore/run-finalize", () => ({ finalizeExploreRun: mocks.finalizeExploreRun }));

import { MARKER_GRACE_MS, syncExploreRun } from "./explore-monitor";

const base = { id: "run1", status: "running", runFolder: "/runs/EXP-1", queueJobId: "local-4242", createdAt: new Date(Date.now() - 5000), startedAt: new Date(Date.now() - 5000) };

describe("syncExploreRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readTail.mockResolvedValue(null);
    mocks.db.exploreAnalysisRun.updateMany.mockResolvedValue({ count: 1 });
  });

  it("finalizes from the exit marker before consulting the process", async () => {
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    await syncExploreRun(base);
    expect(mocks.finalizeExploreRun).toHaveBeenCalledWith("run1", 0);
    expect(mocks.readIdentityCheckedQueueSnapshot).not.toHaveBeenCalled();
  });

  it("finalizes when the marker appears after the process is gone", async () => {
    mocks.inferPipelineExitCode.mockResolvedValueOnce(null).mockResolvedValueOnce(0);
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({ state: null, reason: "Local process exited before its canonical exit marker was observed", source: "local", identityVerified: false });
    await syncExploreRun(base);
    expect(mocks.finalizeExploreRun).toHaveBeenCalledWith("run1", 0);
    expect(mocks.db.exploreAnalysisRun.updateMany).not.toHaveBeenCalled();
  });

  it("waits out the grace period before failing a vanished local process", async () => {
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({ state: null, reason: "gone", source: "local", identityVerified: false });
    await syncExploreRun(base);
    expect(mocks.db.exploreAnalysisRun.updateMany).not.toHaveBeenCalled();

    await syncExploreRun({ ...base, startedAt: new Date(Date.now() - 120_000) });
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("failed");
    expect(update.data.errorTail).toMatch(/gone/);
  });

  it("marks queued SLURM runs as running once the scheduler reports them", async () => {
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({ state: "RUNNING", reason: null, source: "squeue", identityVerified: true });
    await syncExploreRun({ ...base, status: "queued", queueJobId: "12345" });
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("running");
    expect(update.data.startedAt).toBeInstanceOf(Date);
  });

  it("waits for the marker after the scheduler reports completion, then fails the run", async () => {
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({ state: "COMPLETED", reason: null, source: "sacct", identityVerified: true });
    const run = { ...base, id: "run-slurm", queueJobId: "777" };
    const start = Date.now();
    await syncExploreRun(run, { now: () => start });
    await syncExploreRun(run, { now: () => start + MARKER_GRACE_MS - 1000 });
    expect(mocks.db.exploreAnalysisRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.finalizeExploreRun).not.toHaveBeenCalled();

    await syncExploreRun(run, { now: () => start + MARKER_GRACE_MS + 1000 });
    const update = mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("failed");
    expect(update.data.errorTail).toMatch(/COMPLETED.*no exit marker appeared within 5 minutes/);
  });

  it("finalizes normally when the marker shows up during that wait", async () => {
    mocks.inferPipelineExitCode.mockResolvedValueOnce(null).mockResolvedValueOnce(0);
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({ state: "COMPLETED", reason: null, source: "sacct", identityVerified: true });
    const run = { ...base, id: "run-late-marker", queueJobId: "778" };
    await syncExploreRun(run);
    await syncExploreRun(run);
    expect(mocks.finalizeExploreRun).toHaveBeenCalledWith("run-late-marker", 0);
    expect(mocks.db.exploreAnalysisRun.updateMany).not.toHaveBeenCalled();
  });

  it("fails runs that were never prepared after five minutes", async () => {
    await syncExploreRun({ ...base, runFolder: null, createdAt: new Date(Date.now() - 10 * 60 * 1000) });
    expect(mocks.db.exploreAnalysisRun.updateMany.mock.calls[0][0].data.status).toBe("failed");
  });
});
