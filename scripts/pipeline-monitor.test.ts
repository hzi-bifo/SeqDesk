import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The monitor (safety-net daemon) finalizes runs the /sync API and weblog might
// miss. The critical guarantee (regression P4): when it transitions a run to
// completed it must ingest outputs FIRST, and if ingestion fails it must keep the
// run non-terminal so the next pass retries — never leave a "completed" run with
// no artifacts and no retry path.

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: { update: vi.fn() },
    pipelineRunStep: { upsert: vi.fn() },
  },
  findTraceFile: vi.fn(),
  parseTraceFile: vi.fn(),
  readTail: vi.fn(),
  getStepsForPipeline: vi.fn(),
  findStepByProcess: vi.fn(),
  inferPipelineExitCode: vi.fn(),
  processCompletedPipelineRun: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mocks.db }));
vi.mock("../src/lib/pipelines/nextflow", () => ({
  findTraceFile: mocks.findTraceFile,
  parseTraceFile: mocks.parseTraceFile,
  readTail: mocks.readTail,
}));
vi.mock("../src/lib/pipelines/definitions", () => ({
  getStepsForPipeline: mocks.getStepsForPipeline,
  findStepByProcess: mocks.findStepByProcess,
}));
vi.mock("../src/lib/pipelines/run-completion", () => ({
  inferPipelineExitCode: mocks.inferPipelineExitCode,
  processCompletedPipelineRun: mocks.processCompletedPipelineRun,
}));
// monitor-status (reconcileRunStatus, resolveLocalLiveness, ...) is left REAL —
// it is pure status logic and is what makes a local exit-marker resolve to
// "completed".

import { syncRun } from "./pipeline-monitor";

const completedLocalRun = {
  id: "run-1",
  pipelineId: "mag",
  status: "running" as const,
  runFolder: "/runs/run-1",
  queueJobId: "local-123",
  outputPath: "/runs/run-1/logs/pipeline.out",
  errorPath: "/runs/run-1/logs/pipeline.err",
};

describe("pipeline-monitor syncRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No trace file => status is driven purely by the scheduler reconcile.
    mocks.findTraceFile.mockResolvedValue(null);
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.readTail.mockResolvedValue(null);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    // Exit marker present + exit 0 => a local run resolves to completed regardless
    // of PID liveness (exit-marker-wins).
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    // The failure path logs via console.error; silence it for clean test output.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests outputs BEFORE marking the run completed", async () => {
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);

    await syncRun(completedLocalRun);

    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith("run-1", "mag");
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: "completed" }),
      })
    );
    // Ordering guarantee: ingestion runs before the terminal DB write.
    const ingestOrder = mocks.processCompletedPipelineRun.mock.invocationCallOrder[0];
    const updateOrder = mocks.db.pipelineRun.update.mock.invocationCallOrder[0];
    expect(ingestOrder).toBeLessThan(updateOrder);
  });

  it("holds the run non-terminal (does NOT mark completed) when ingestion fails", async () => {
    mocks.processCompletedPipelineRun.mockRejectedValue(new Error("DB hiccup"));

    await syncRun(completedLocalRun);

    // The run must be kept in a retryable, non-terminal state...
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "running",
          currentStep: "Finalizing outputs...",
        }),
      })
    );
    // ...and must NOT have been written as completed.
    const wroteCompleted = mocks.db.pipelineRun.update.mock.calls.some(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "completed"
    );
    expect(wroteCompleted).toBe(false);
  });

  it("does NOT complete a no-step-def SLURM run from a trivially-100% trace (metaxpath false-completion)", async () => {
    // metaxpath ships no step defs => getStepsForPipeline -> [] (totalSteps 0). The monitor keys
    // stepMap by raw trace PROCESS name, so after the fast input-prep wave (INPUT_CHECK + MV_FASTQ)
    // "every step completed" is trivially true mid-run -> the run was finalized 'completed' before
    // classification while the inline sbatch job was still RUNNING (and got cancelled by the e2e).
    // With the totalSteps>0 guard the step branch is skipped; the fake job id has no squeue/sacct
    // record so checkSlurmStatus -> null, leaving the run unfinalized (the real run would read RUNNING
    // and stay running). Either way it must NOT be written 'completed'.
    const slurmRun = {
      ...completedLocalRun,
      id: "run-2",
      pipelineId: "metaxpath",
      queueJobId: "6397", // numeric => inline-SLURM sbatch job id
    };
    mocks.getStepsForPipeline.mockReturnValue([]); // no step defs => totalSteps 0
    mocks.findStepByProcess.mockReturnValue(null);
    mocks.findTraceFile.mockResolvedValue("/runs/run-2/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        { process: "INPUT_CHECK", status: "COMPLETED", complete: new Date("2026-03-03T10:00:01Z") },
        { process: "MV_FASTQ", status: "COMPLETED", complete: new Date("2026-03-03T10:00:02Z") },
      ],
      overallProgress: 100,
    });

    await syncRun(slurmRun);

    const wroteCompleted = mocks.db.pipelineRun.update.mock.calls.some(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "completed"
    );
    expect(wroteCompleted).toBe(false);
  });
});
