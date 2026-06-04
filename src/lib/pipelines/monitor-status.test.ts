import { describe, expect, it } from "vitest";
import {
  aggregateStepStatus,
  combineTaskStatuses,
  deriveStepStatus,
  reconcileRunStatus,
  resolveLocalLiveness,
} from "./monitor-status";

describe("reconcileRunStatus", () => {
  it("lets a terminal scheduler state override a wedged 'running' trace", () => {
    // The exact production bug: SLURM job COMPLETED but the trace is stuck at
    // running/99%, so the run hung as "running" indefinitely.
    expect(reconcileRunStatus("running", "completed")).toBe("completed");
    expect(reconcileRunStatus("running", "failed")).toBe("failed");
    expect(reconcileRunStatus("running", "cancelled")).toBe("cancelled");
  });

  it("overrides a stuck 'queued'/'pending' trace with a terminal scheduler state", () => {
    expect(reconcileRunStatus("queued", "completed")).toBe("completed");
    expect(reconcileRunStatus("pending", "failed")).toBe("failed");
  });

  it("keeps a genuinely running job running (non-terminal scheduler state)", () => {
    expect(reconcileRunStatus("running", "running")).toBe("running");
    expect(reconcileRunStatus("running", "queued")).toBe("running");
    expect(reconcileRunStatus("running", null)).toBe("running");
  });

  it("never overrides a terminal trace status (the pipeline's own report wins)", () => {
    expect(reconcileRunStatus("completed", "running")).toBe("completed");
    expect(reconcileRunStatus("failed", "completed")).toBe("failed");
    expect(reconcileRunStatus("completed", null)).toBe("completed");
  });

  it("falls back to the scheduler status when there is no trace status", () => {
    expect(reconcileRunStatus(null, "queued")).toBe("queued");
    expect(reconcileRunStatus(null, "completed")).toBe("completed");
    expect(reconcileRunStatus(null, null)).toBeNull();
  });
});

describe("deriveStepStatus", () => {
  it("does not treat a SUBMITTED (queued) task as running", () => {
    expect(deriveStepStatus("SUBMITTED")).toBe("pending");
  });

  it("maps the active states", () => {
    expect(deriveStepStatus("RUNNING")).toBe("running");
    expect(deriveStepStatus("STARTED")).toBe("running");
    expect(deriveStepStatus("COMPLETED")).toBe("completed");
    expect(deriveStepStatus("FAILED")).toBe("failed");
  });

  it("treats CACHED (resumed) tasks as completed, matching the other code paths", () => {
    expect(deriveStepStatus("CACHED")).toBe("completed");
  });

  it("treats ABORTED tasks as failed, matching the other code paths", () => {
    expect(deriveStepStatus("ABORTED")).toBe("failed");
  });

  it("treats a non-zero exit code as failed even when the label is benign", () => {
    expect(deriveStepStatus("COMPLETED", 1)).toBe("failed");
    expect(deriveStepStatus("COMPLETED", 0)).toBe("completed");
  });

  it("defaults unknown states to pending", () => {
    expect(deriveStepStatus("UNKNOWN")).toBe("pending");
    expect(deriveStepStatus("")).toBe("pending");
  });
});

describe("aggregateStepStatus", () => {
  it("lets a later COMPLETED retry clear an earlier FAILED for the same step", () => {
    // The exact production bug: a failed attempt followed by a successful retry
    // must aggregate to completed, not stay stuck on failed.
    expect(aggregateStepStatus(["failed", "completed"])).toBe("completed");
    // Attempt order does not matter; the success still wins.
    expect(aggregateStepStatus(["completed", "failed"])).toBe("completed");
  });

  it("treats CACHED retries (mapped to completed) as clearing an earlier failure", () => {
    expect(aggregateStepStatus(["failed", deriveStepStatus("CACHED")])).toBe(
      "completed"
    );
  });

  it("stays running while any attempt is still in flight", () => {
    expect(aggregateStepStatus(["failed", "running"])).toBe("running");
    expect(aggregateStepStatus(["completed", "running"])).toBe("running");
  });

  it("reports failed only when every terminal attempt failed and none succeeded", () => {
    expect(aggregateStepStatus(["failed"])).toBe("failed");
    expect(aggregateStepStatus(["failed", "failed"])).toBe("failed");
  });

  it("defaults to pending when nothing has started", () => {
    expect(aggregateStepStatus([])).toBe("pending");
    expect(aggregateStepStatus(["pending", "pending"])).toBe("pending");
  });
});

describe("combineTaskStatuses", () => {
  it("does NOT let a distinct sibling task's success mask another task's failure", () => {
    // The exact production false-success bug: a MAG "binning" step maps METABAT2,
    // MAXBIN2 and CONCOCT to one step id. If CONCOCT fails but METABAT2 completes,
    // the step (and run) must be failed -- not falsely reported completed.
    expect(combineTaskStatuses(["completed", "failed"])).toBe("failed");
    expect(combineTaskStatuses(["failed", "completed"])).toBe("failed");
  });

  it("stays running while any task is still in flight, even if another failed", () => {
    expect(combineTaskStatuses(["failed", "running"])).toBe("running");
    expect(combineTaskStatuses(["completed", "running"])).toBe("running");
  });

  it("is completed only when every distinct task completed", () => {
    expect(combineTaskStatuses(["completed", "completed"])).toBe("completed");
    expect(combineTaskStatuses(["completed"])).toBe("completed");
  });

  it("is pending when some tasks are not yet done and none failed or run", () => {
    expect(combineTaskStatuses(["completed", "pending"])).toBe("pending");
    expect(combineTaskStatuses([])).toBe("pending");
  });

  it("composes with per-task retry resolution: a retried task does not fail the step", () => {
    // Each distinct task is first resolved retry-aware via aggregateStepStatus,
    // then combined. CONCOCT retried to success + METABAT2 completed -> completed.
    const concot = aggregateStepStatus(["failed", "completed"]); // retry of one task
    const metabat = aggregateStepStatus(["completed"]);
    expect(combineTaskStatuses([concot, metabat])).toBe("completed");
    // But a genuinely failed (never-retried) distinct task still fails the step.
    const failedConcot = aggregateStepStatus(["failed"]);
    expect(combineTaskStatuses([failedConcot, metabat])).toBe("failed");
  });
});

describe("resolveLocalLiveness", () => {
  it("prefers the exit marker over a live PID so a recycled PID cannot pin a finished run", () => {
    // The exact production bug: the run already wrote exit code 0, but the PID
    // was recycled to an unrelated live process -- the run must be terminal.
    expect(resolveLocalLiveness(0, true)).toBe("completed");
    expect(resolveLocalLiveness(1, true)).toBe("failed");
  });

  it("uses the exit marker when the PID is gone", () => {
    expect(resolveLocalLiveness(0, false)).toBe("completed");
    expect(resolveLocalLiveness(2, false)).toBe("failed");
  });

  it("falls back to PID-liveness 'running' only when no exit marker exists", () => {
    expect(resolveLocalLiveness(null, true)).toBe("running");
  });

  it("returns null (unknown) when there is no marker and the PID is gone", () => {
    expect(resolveLocalLiveness(null, false)).toBeNull();
  });
});
