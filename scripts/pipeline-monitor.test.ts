import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The monitor (safety-net daemon) finalizes runs the /sync API and weblog might
// miss. The critical guarantee (regression P4): when it transitions a run to
// completed it must ingest outputs FIRST, and if ingestion fails it must keep the
// run non-terminal so the next pass retries — never leave a "completed" run with
// no artifacts and no retry path.

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: { updateMany: vi.fn() },
    pipelineRunStep: { upsert: vi.fn() },
  },
  findTraceFile: vi.fn(),
  parseTraceFile: vi.fn(),
  readTail: vi.fn(),
  getStepsForPipeline: vi.fn(),
  findStepByProcess: vi.fn(),
  inferPipelineExitCode: vi.fn(),
  finalizeCompletedPipelineRun: vi.fn(),
  notifyPipelineRunTerminalInApp: vi.fn(),
  execFile: vi.fn(),
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
  finalizeCompletedPipelineRun: mocks.finalizeCompletedPipelineRun,
}));
vi.mock("../src/lib/notifications/in-app", () => ({
  notifyPipelineRunTerminalInApp: mocks.notifyPipelineRunTerminalInApp,
}));
vi.mock("child_process", () => ({
  execFile: (
    file: string,
    args: readonly string[],
    _options: unknown,
    callback: (
      error: Error | null,
      result?: { stdout: string; stderr: string }
    ) => void
  ) => mocks.execFile(file, args, callback),
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
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    // Exit marker present + exit 0 => a local run resolves to completed regardless
    // of PID liveness (exit-marker-wins).
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.finalizeCompletedPipelineRun.mockResolvedValue("completed");
    mocks.execFile.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: "", stderr: "" });
    });
    // The failure path logs via console.error; silence it for clean test output.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests outputs BEFORE marking the run completed", async () => {
    await syncRun(completedLocalRun);

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      "run-1",
      "mag",
      { statusSource: "monitor" }
    );
    // The lifecycle helper owns the claim, ingestion, and terminal status write.
    // The monitor must not follow it with a second lifecycle update.
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
    const finalizeOrder =
      mocks.finalizeCompletedPipelineRun.mock.invocationCallOrder[0];
    const notificationOrder =
      mocks.notifyPipelineRunTerminalInApp.mock.invocationCallOrder[0];
    expect(finalizeOrder).toBeLessThan(notificationOrder);
    expect(mocks.notifyPipelineRunTerminalInApp).toHaveBeenCalledWith(
      "run-1",
      "running",
      "completed"
    );
  });

  it("does not notify or overwrite when a concurrent terminal transition wins", async () => {
    mocks.finalizeCompletedPipelineRun.mockResolvedValue("claim-unavailable");

    await syncRun(completedLocalRun);

    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalled();
  });

  it("holds the run non-terminal (does NOT mark completed) when ingestion fails", async () => {
    mocks.finalizeCompletedPipelineRun.mockRejectedValue(new Error("DB hiccup"));

    await syncRun(completedLocalRun);

    // The run must be kept in a retryable, non-terminal state...
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "running",
          currentStep: "Finalizing outputs...",
        }),
      })
    );
    // ...and must NOT have been written as completed.
    const wroteCompleted = mocks.db.pipelineRun.updateMany.mock.calls.some(
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

    const wroteCompleted = mocks.db.pipelineRun.updateMany.mock.calls.some(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "completed"
    );
    expect(wroteCompleted).toBe(false);
  });

  it("does not complete a LOCAL run from only the steps that have appeared", async () => {
    // read-cleaning's external trace does not cover every SeqDesk definition.
    // Two completed entries are not terminal evidence while downstream work may
    // still be absent from the trace; the wrapper exit marker finalizes it later.
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
    mocks.findTraceFile.mockResolvedValue("/runs/run-3/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        { process: "KRAKEN2_CLASSIFICATION", status: "COMPLETED", complete: new Date("2026-03-03T10:00:01Z") },
        { process: "DETAXIZER_FILTER", status: "COMPLETED", complete: new Date("2026-03-03T10:00:02Z") },
      ],
      overallProgress: 100,
    });

    await syncRun(localRun);

    const wroteCompleted = mocks.db.pipelineRun.updateMany.mock.calls.some(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "completed"
    );
    expect(wroteCompleted).toBe(false);
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it("does not let completed unknown helper processes satisfy declared-step coverage", async () => {
    const localRun = {
      ...completedLocalRun,
      id: "run-unknown-helper",
      pipelineId: "one-step-pipeline",
      queueJobId: "local-99999999",
    };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "required-step", name: "Required step" },
    ]);
    mocks.findStepByProcess.mockReturnValue(null);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.findTraceFile.mockResolvedValue("/runs/run-unknown-helper/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "INPUT_CHECK",
          status: "COMPLETED",
          complete: new Date("2026-03-03T10:00:01Z"),
        },
      ],
      overallProgress: 100,
    });

    await syncRun(localRun);

    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("replaces a premature terminal trace label while the local process is active", async () => {
    const localRun = {
      ...completedLocalRun,
      id: "run-active-wrapper",
      pipelineId: "one-step-pipeline",
      runFolder: "/runs/run-active-wrapper",
      queueJobId: `local-${process.pid}`,
    };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "required-step", name: "Required step" },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: "required-step",
      name: "Required step",
    });
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === "ps") {
        callback(null, {
          stdout: "bash /runs/run-active-wrapper/run.sh\n",
          stderr: "",
        });
        return;
      }
      callback(null, { stdout: "", stderr: "" });
    });
    mocks.findTraceFile.mockResolvedValue("/runs/run-active-wrapper/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "ONLY_STEP",
          status: "COMPLETED",
          complete: new Date("2026-03-03T10:00:01Z"),
        },
      ],
      overallProgress: 100,
    });

    await syncRun(localRun);

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "running",
          currentStep: "Running on compute node",
          progress: 99,
        }),
      })
    );
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it("keeps a trace-complete run active while exact SLURM state is COMPLETING", async () => {
    const slurmRun = {
      ...completedLocalRun,
      id: "run-completing",
      pipelineId: "one-step-pipeline",
      runFolder: "/runs/run-completing",
      queueJobId: "123456",
    };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "required-step", name: "Required step" },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: "required-step",
      name: "Required step",
    });
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === "squeue") {
        callback(null, {
          stdout:
            "COMPLETING|None|seqdesk-run-completing|/runs/run-completing\n",
          stderr: "",
        });
        return;
      }
      callback(null, { stdout: "", stderr: "" });
    });
    mocks.findTraceFile.mockResolvedValue("/runs/run-completing/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "ONLY_STEP",
          status: "COMPLETED",
          complete: new Date("2026-03-03T10:00:01Z"),
        },
      ],
      overallProgress: 100,
    });

    await syncRun(slurmRun);

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "running",
          currentStep: "Running on compute node",
          progress: 99,
        }),
      })
    );
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it("keeps a trace failure retryable while the stored SLURM identity is unverified", async () => {
    const slurmRun = {
      ...completedLocalRun,
      id: "run-unverified",
      pipelineId: "one-step-pipeline",
      runFolder: "/runs/run-unverified",
      queueJobId: "123456",
    };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "required-step", name: "Required step" },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: "required-step",
      name: "Required step",
    });
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === "squeue") {
        callback(null, {
          stdout:
            "FAILED|None|seqdesk-another-run|/runs/run-unverified\n",
          stderr: "",
        });
        return;
      }
      callback(null, { stdout: "", stderr: "" });
    });
    mocks.findTraceFile.mockResolvedValue("/runs/run-unverified/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "ONLY_STEP",
          status: "FAILED",
          exit: 1,
          complete: new Date("2026-03-03T10:00:01Z"),
        },
      ],
      overallProgress: 100,
    });

    await syncRun(slurmRun);

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "running",
          currentStep: "Waiting for scheduler confirmation...",
        }),
      })
    );
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalled();
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it.each([
    { label: "blank", tag: undefined },
    { label: "reused", tag: "same-sample" },
  ])(
    "keeps $label-tag sibling tasks separate when one fails",
    async ({ tag }) => {
      const run = {
        ...completedLocalRun,
        id: `run-${tag ?? "blank"}-siblings`,
        pipelineId: "one-step-pipeline",
        queueJobId: null,
      };
      mocks.getStepsForPipeline.mockReturnValue([
        { id: "align", name: "Align" },
      ]);
      mocks.findStepByProcess.mockReturnValue({
        id: "align",
        name: "Align",
      });
      mocks.inferPipelineExitCode.mockResolvedValue(null);
      mocks.findTraceFile.mockResolvedValue(`${run.runFolder}/trace.txt`);
      mocks.parseTraceFile.mockResolvedValue({
        tasks: [
          {
            process: "ALIGN",
            taskId: "1",
            attempt: 1,
            tag,
            status: "FAILED",
            exit: 1,
          },
          {
            process: "ALIGN",
            taskId: "2",
            attempt: 1,
            tag,
            status: "COMPLETED",
            exit: 0,
          },
        ],
        overallProgress: 50,
      });

      await syncRun(run);

      expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: "failed" }),
        })
      );
      expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "failed",
            currentStep: "Failed",
          }),
        })
      );
      expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
    }
  );

  it("joins an explicit retry without merging a completed sibling", async () => {
    const run = {
      ...completedLocalRun,
      id: "run-retry-with-sibling",
      pipelineId: "one-step-pipeline",
      queueJobId: null,
    };
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "align", name: "Align" },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: "align",
      name: "Align",
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.findTraceFile.mockResolvedValue(`${run.runFolder}/trace.txt`);
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "ALIGN",
          taskId: "1",
          attempt: 1,
          tag: "same-sample",
          status: "FAILED",
          exit: 1,
        },
        {
          process: "ALIGN",
          taskId: "2",
          attempt: 1,
          tag: "same-sample",
          status: "COMPLETED",
          exit: 0,
        },
        {
          process: "ALIGN",
          taskId: "3",
          attempt: 2,
          tag: "same-sample",
          status: "COMPLETED",
          exit: 0,
        },
      ],
      overallProgress: 100,
    });

    await syncRun(run);

    expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "completed" }),
      })
    );
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      run.id,
      run.pipelineId,
      { statusSource: "monitor" }
    );
  });
});
