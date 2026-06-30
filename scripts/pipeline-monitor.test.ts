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

  it("does NOT complete a step-def run when only the early steps have appeared (metaxpath 2-of-13)", async () => {
    // metaxpath ships 13 step defs (definition.json: input, move_fastq, metax_profile, ... 13 total).
    // Early in the run only the input-prep steps' processes have run (INPUT_CHECK -> input,
    // MV_FASTQ -> move_fastq), both completed, so stepMap holds 2 completed entries. The old
    // `stepMap.size > 0 && every entry completed` check read that as done and finalized the run
    // 'completed' after 2 of 13 steps -- before classification, while the inline SLURM job was still
    // RUNNING (cancelled by the e2e). For a SLURM run, completion now also requires
    // completedSteps >= totalSteps, so it must stay non-completed at 2 of 13.
    const slurmRun = {
      ...completedLocalRun,
      id: "run-2",
      pipelineId: "metaxpath",
      queueJobId: "6397", // numeric => inline-SLURM sbatch job id
    };
    // 13 defined steps => totalSteps 13.
    mocks.getStepsForPipeline.mockReturnValue(
      Array.from({ length: 13 }, (_, i) => ({ id: `step-${i}`, name: `Step ${i}` }))
    );
    // Only the two input-prep processes map to a step; the rest haven't run yet.
    mocks.findStepByProcess.mockImplementation((_pipelineId: string, processName: string) =>
      processName === "INPUT_CHECK"
        ? { id: "input", name: "Input Validation" }
        : processName === "MV_FASTQ"
          ? { id: "move_fastq", name: "Prepare No-Human FASTQ" }
          : null
    );
    mocks.findTraceFile.mockResolvedValue("/runs/run-2/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        { process: "INPUT_CHECK", status: "COMPLETED", complete: new Date("2026-03-03T10:00:01Z") },
        { process: "MV_FASTQ", status: "COMPLETED", tag: "S10", complete: new Date("2026-03-03T10:00:02Z") },
      ],
      overallProgress: 100,
    });
    // The fake job id has no squeue/sacct record -> checkSlurmStatus -> null, so the run stays
    // unfinalized this pass (the real run reads RUNNING and stays running). Either way it must NOT be
    // written 'completed' from only 2 of 13 steps.

    await syncRun(slurmRun);

    const wroteCompleted = mocks.db.pipelineRun.update.mock.calls.some(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "completed"
    );
    expect(wroteCompleted).toBe(false);
  });

  it("DOES complete a LOCAL run on the every-appeared step path (read-cleaning ingestion guard)", async () => {
    // read-cleaning is a LOCAL run that does NOT run all its defined steps (4 defs; detaxizer's trace
    // doesn't match multiqc/pipeline_info), so completedSteps < totalSteps. It must STILL complete via
    // the every-appeared step path: THAT finalize path ingests its cleaned-read candidates, whereas
    // routing a local run through the scheduler/marker path drops the ingestion (the regression this
    // guards). The completedSteps>=totalSteps tightening is SLURM-only and must not apply to local runs.
    const localRun = { ...completedLocalRun, id: "run-3", pipelineId: "read-cleaning", queueJobId: "local-555" };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "classification", name: "Classification" },
      { id: "filter", name: "Filter" },
      { id: "multiqc", name: "MultiQC" },
      { id: "pipeline_info", name: "Pipeline info" },
    ]); // totalSteps 4
    mocks.findStepByProcess.mockImplementation((_pipelineId: string, processName: string) =>
      /KRAKEN2|CLASSIFICATION/.test(processName)
        ? { id: "classification", name: "Classification" }
        : /FILTER/.test(processName)
          ? { id: "filter", name: "Filter" }
          : null
    );
    mocks.inferPipelineExitCode.mockResolvedValue(null); // no marker; pid 555 gone => scheduler null
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined); // ingestion succeeds (clearAllMocks keeps prior impl)
    mocks.findTraceFile.mockResolvedValue("/runs/run-3/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        { process: "KRAKEN2_CLASSIFICATION", status: "COMPLETED", complete: new Date("2026-03-03T10:00:01Z") },
        { process: "DETAXIZER_FILTER", status: "COMPLETED", complete: new Date("2026-03-03T10:00:02Z") },
      ],
      overallProgress: 100,
    });

    await syncRun(localRun);

    // 2 of 4 steps, but a LOCAL run -> every-appeared completion holds (no scheduler signal demotes it),
    // so it is marked completed and its outputs are ingested.
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    );
  });
});
