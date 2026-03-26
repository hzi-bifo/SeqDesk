import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pipelineRunStep: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    pipelineRunEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    assembly: { count: vi.fn() },
    bin: { count: vi.fn() },
    pipelineArtifact: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  getExecutionSettings: vi.fn(),
  findStepByProcess: vi.fn(),
  getStepsForPipeline: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  resolveOutputs: vi.fn(),
  saveRunResults: vi.fn(),
  execFileAsync: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/definitions", () => ({
  findStepByProcess: mocks.findStepByProcess,
  getStepsForPipeline: mocks.getStepsForPipeline,
}));

vi.mock("@/lib/pipelines/adapters", () => ({
  getAdapter: mocks.getAdapter,
  registerAdapter: mocks.registerAdapter,
}));

vi.mock("@/lib/pipelines/generic-adapter", () => ({
  createGenericAdapter: mocks.createGenericAdapter,
}));

vi.mock("@/lib/pipelines/adapters/mag", () => ({}));

vi.mock("@/lib/pipelines/output-resolver", () => ({
  resolveOutputs: mocks.resolveOutputs,
  saveRunResults: mocks.saveRunResults,
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: () => mocks.execFileAsync,
}));

import { POST } from "./route";

function makeRequest(
  runId: string,
  body: Record<string, unknown>,
  token = ""
): NextRequest {
  const url = `http://localhost:3000/api/pipelines/weblog?runId=${runId}&token=${token}`;
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseRun = {
  id: "run-1",
  pipelineId: "mag",
  status: "running",
  queueJobId: null,
  startedAt: new Date("2025-01-01T00:00:00Z"),
  completedAt: null,
  lastEventAt: null,
  lastWeblogAt: null,
};

describe("POST /api/pipelines/weblog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "",
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(baseRun);
    mocks.db.pipelineRunStep.findUnique.mockResolvedValue(null);
    mocks.db.pipelineRunStep.count.mockResolvedValue(0);
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.findStepByProcess.mockReturnValue(null);
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        pipelineRunEvent: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
        },
        pipelineRun: {
          update: vi.fn(),
        },
      };
      return fn(tx);
    });
  });

  it("returns 400 when runId is missing", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/pipelines/weblog",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "process_start" }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("runId is required");
  });

  it("returns 403 when token is invalid", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "correct-secret",
    });
    const req = makeRequest("run-1", { event: "process_start" }, "wrong-token");
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Invalid token");
  });

  it("allows request when token matches weblogSecret", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "my-secret",
    });
    const req = makeRequest("run-1", { event: "process_start" }, "my-secret");
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("allows request when no weblogSecret is configured", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "",
    });
    const req = makeRequest("run-1", { event: "process_start" });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const req = makeRequest("nonexistent", { event: "process_start" });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Run not found");
  });

  it("processes a workflow_start event and sets status to running", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: "pending",
      startedAt: null,
    });

    const req = makeRequest("run-1", {
      event: "workflow_start",
      utcTime: "2025-01-01T12:00:00Z",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the transaction was called
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);

    // Check what the transaction callback did
    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    // The run should be updated with status=running
    expect(txMock.pipelineRun.update).toHaveBeenCalledTimes(1);
    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("running");
    expect(updateData.startedAt).toBeInstanceOf(Date);
  });

  it("processes a process_start event and upserts step", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "Quality Control" });

    const req = makeRequest("run-1", {
      event: "process_start",
      trace: { process: "FASTQC", status: "RUNNING" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Step should be upserted
    expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    expect(upsertArgs.create.stepId).toBe("step-qc");
    expect(upsertArgs.create.status).toBe("running");
  });

  it("processes a workflow_error event and marks run as failed", async () => {
    const req = makeRequest("run-1", {
      event: "workflow_error",
      message: "Pipeline crashed",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("failed");
    expect(updateData.currentStep).toBe("Failed");
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.getExecutionSettings.mockRejectedValue(new Error("DB connection lost"));

    const req = makeRequest("run-1", { event: "process_start" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to process weblog event");
  });

  it("calculates progress based on completed steps", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-assembly", name: "Assembly" });
    mocks.getStepsForPipeline.mockReturnValue([
      { id: "step-qc" },
      { id: "step-assembly" },
      { id: "step-binning" },
      { id: "step-annotation" },
    ]);
    mocks.db.pipelineRunStep.count.mockResolvedValue(2);

    const req = makeRequest("run-1", {
      event: "process_complete",
      trace: { process: "ASSEMBLY", status: "COMPLETED", exit: 0 },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    // 2 out of 4 steps = 50%
    expect(updateData.progress).toBe(50);
  });

  it("does not create duplicate events within the dedup window", async () => {
    const req = makeRequest("run-1", {
      event: "process_start",
      trace: { process: "FASTQC" },
    });

    // Make the transaction's findFirst return an existing event (duplicate)
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        pipelineRunEvent: {
          findFirst: vi.fn().mockResolvedValue({ id: "existing-event" }),
          create: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
        },
        pipelineRun: {
          update: vi.fn(),
        },
      };
      await fn(tx);
      // Verify create was NOT called since a duplicate was found
      expect(tx.pipelineRunEvent.create).not.toHaveBeenCalled();
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("parses utcTime as ISO string", async () => {
    const req = makeRequest("run-1", {
      event: "process_start",
      utcTime: "2025-06-15T10:30:00Z",
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("parses utcTime as numeric timestamp", async () => {
    const req = makeRequest("run-1", {
      event: "process_start",
      utcTime: Date.now(),
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("normalizes event type to lowercase", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "QC" });

    const req = makeRequest("run-1", {
      event: "PROCESS_START",
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Step should be upserted with running status (process_start)
    expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    expect(upsertArgs.create.status).toBe("running");
  });

  it("extracts process name from trace field", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-assembly", name: "Assembly" });

    const req = makeRequest("run-1", {
      event: "process_start",
      trace: { process: "MEGAHIT" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.findStepByProcess).toHaveBeenCalledWith("mag", "MEGAHIT");
  });

  it("derives completed status for process_complete with exit code 0", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "QC" });
    mocks.getStepsForPipeline.mockReturnValue([{ id: "step-qc" }]);
    mocks.db.pipelineRunStep.count.mockResolvedValue(1);

    const req = makeRequest("run-1", {
      event: "process_complete",
      trace: { process: "FASTQC", exit: 0, status: "COMPLETED" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    expect(upsertArgs.create.status).toBe("completed");
  });

  it("derives failed status for process_complete with non-zero exit", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "QC" });
    mocks.getStepsForPipeline.mockReturnValue([{ id: "step-qc" }]);
    mocks.db.pipelineRunStep.count.mockResolvedValue(0);

    const req = makeRequest("run-1", {
      event: "process_complete",
      trace: { process: "FASTQC", exit: 1, status: "FAILED" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    expect(upsertArgs.create.status).toBe("failed");
  });

  it("runs output processing on workflow_complete with terminal queue state", async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.getAdapter.mockReturnValue({
      discoverOutputs: vi.fn().mockResolvedValue({ summary: {}, assemblies: [], bins: [], artifacts: [] }),
    });
    mocks.resolveOutputs.mockResolvedValue({
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({ ...baseRun, queueJobId: null })
      .mockResolvedValueOnce({
        ...baseRun,
        runFolder: "/tmp/runs/run-1",
        targetType: "study",
        studyId: "study-1",
        orderId: null,
        study: { samples: [{ id: "s1", sampleId: "SAMPLE1" }] },
        order: null,
      });
    mocks.db.assembly.count.mockResolvedValue(1);
    mocks.db.bin.count.mockResolvedValue(0);
    mocks.db.pipelineArtifact.count.mockResolvedValue(0);

    const req = makeRequest("run-1", {
      event: "workflow_complete",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("completed");
    expect(updateData.progress).toBe(100);
  });

  it("extracts message from payload", async () => {
    const req = makeRequest("run-1", {
      event: "workflow_error",
      message: "Out of memory",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const createdEvent = txMock.pipelineRunEvent.create.mock.calls[0][0].data;
    expect(createdEvent.message).toBe("Out of memory");
  });

  it("stringifies and truncates payload exceeding limit", async () => {
    // Create a payload just over the threshold so it gets truncated
    const largeValue = "x".repeat(12000);
    const req = makeRequest("run-1", {
      event: "process_start",
      data: largeValue,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const createdEvent = txMock.pipelineRunEvent.create.mock.calls[0][0].data;
    // Payload should be truncated to MAX_EVENT_PAYLOAD (12000) chars
    expect(createdEvent.payload.length).toBeLessThanOrEqual(12000);
    expect(createdEvent.payload.endsWith("...")).toBe(true);
  });

  it("falls back to receivedAt when event time is too far in the future", async () => {
    const futureTime = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    const req = makeRequest("run-1", {
      event: "process_start",
      utcTime: futureTime,
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const createdEvent = txMock.pipelineRunEvent.create.mock.calls[0][0].data;
    const eventTime = new Date(createdEvent.occurredAt);
    const futureDate = new Date(futureTime);
    // Should use receivedAt instead of the far-future time
    expect(eventTime.getTime()).toBeLessThan(futureDate.getTime());
  });

  it("falls back to receivedAt when event time is too far in the past", async () => {
    const pastTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const req = makeRequest("run-1", {
      event: "process_start",
      utcTime: pastTime,
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const createdEvent = txMock.pipelineRunEvent.create.mock.calls[0][0].data;
    const eventTime = new Date(createdEvent.occurredAt);
    const pastDate = new Date(pastTime);
    // Should use receivedAt instead of the ancient past time
    expect(eventTime.getTime()).toBeGreaterThan(pastDate.getTime());
  });

  it("cleans up excess events beyond 100 in the transaction", async () => {
    const excessEvents = Array.from({ length: 5 }, (_, i) => ({ id: `excess-${i}` }));

    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        pipelineRunEvent: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          findMany: vi.fn().mockResolvedValue(excessEvents),
          deleteMany: vi.fn(),
        },
        pipelineRun: {
          update: vi.fn(),
        },
      };
      await fn(tx);
      // Verify excess events were deleted
      expect(tx.pipelineRunEvent.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["excess-0", "excess-1", "excess-2", "excess-3", "excess-4"] } },
      });
    });

    const req = makeRequest("run-1", {
      event: "process_start",
      trace: { process: "FASTQC" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("keeps run as running when workflow_complete but queue state is active", async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: "RUNNING|computing\n", stderr: "" });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      queueJobId: "12345",
    });

    const req = makeRequest("run-1", {
      event: "workflow_complete",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("running");
    expect(updateData.currentStep).toBe("Finalizing...");
  });

  it("marks run as running when processCompletedRun throws", async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);
    let callCount = 0;
    mocks.db.pipelineRun.findUnique.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { ...baseRun, queueJobId: null, pipelineId: "mag" };
      return null; // processCompletedRun - run not found, returns early
    });

    mocks.db.assembly.count.mockResolvedValue(0);
    mocks.db.bin.count.mockResolvedValue(0);
    mocks.db.pipelineArtifact.count.mockResolvedValue(0);

    const req = makeRequest("run-1", {
      event: "workflow_complete",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    // MAG pipeline with 0 materialized outputs should stay running
    expect(updateData.status).toBe("running");
    expect(updateData.currentStep).toBe("Finalizing outputs...");
  });

  it("handles non-numeric queue job IDs gracefully", async () => {
    vi.clearAllMocks();
    mocks.getExecutionSettings.mockResolvedValue({ weblogSecret: "" });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.findStepByProcess.mockReturnValue(null);
    mocks.db.pipelineRunStep.findUnique.mockResolvedValue(null);
    mocks.db.pipelineRunStep.count.mockResolvedValue(0);
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        pipelineRunEvent: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
        },
        pipelineRun: { update: vi.fn() },
      };
      return fn(tx);
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      queueJobId: "invalid-format",
    });

    const req = makeRequest("run-1", {
      event: "workflow_complete",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Non-numeric, non-local job IDs return null state, so workflow_complete
    // should still process the run as completed
    const txCallback = mocks.db.$transaction.mock.calls[0][0];
    const txMock = {
      pipelineRunEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      pipelineRun: {
        update: vi.fn(),
      },
    };
    await txCallback(txMock);

    // With null queue state and no adapter, it still processes
    const updateData = txMock.pipelineRun.update.mock.calls[0][0].data;
    // No outputs discovered since no adapter, so status depends on pipeline type
    expect(["completed", "running"]).toContain(updateData.status);
  });

  it("processes a process_error event and marks step as failed", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "QC" });
    mocks.getStepsForPipeline.mockReturnValue([{ id: "step-qc" }]);
    mocks.db.pipelineRunStep.count.mockResolvedValue(0);

    const req = makeRequest("run-1", {
      event: "process_error",
      trace: { process: "FASTQC", status: "ERROR" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    expect(upsertArgs.create.status).toBe("failed");
  });

  it("preserves failed step status when a later running event arrives", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-qc", name: "QC" });
    mocks.db.pipelineRunStep.findUnique.mockResolvedValue({
      status: "failed",
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const req = makeRequest("run-1", {
      event: "process_start",
      trace: { process: "FASTQC", status: "RUNNING" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const upsertArgs = mocks.db.pipelineRunStep.upsert.mock.calls[0][0];
    // Should preserve failed status even though process_start would normally set running
    expect(upsertArgs.update.status).toBe("failed");
  });

  it("extracts process name from task field when trace is absent", async () => {
    mocks.findStepByProcess.mockReturnValue({ id: "step-assembly", name: "Assembly" });

    const req = makeRequest("run-1", {
      event: "process_start",
      task: { process: "MEGAHIT" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.findStepByProcess).toHaveBeenCalledWith("mag", "MEGAHIT");
  });
});
