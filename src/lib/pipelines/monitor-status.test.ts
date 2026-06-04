import { describe, expect, it } from "vitest";
import {
  deriveStepStatus,
  reconcileRunStatus,
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
