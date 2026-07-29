import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  cleanupRunOutputData: vi.fn(),
  cancelPipelineRunForOperator: vi.fn(),
  readIdentityCheckedQueueSnapshot: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    assembly: {
      deleteMany: vi.fn(),
    },
    bin: {
      deleteMany: vi.fn(),
    },
    pipelineRunStep: {
      deleteMany: vi.fn(),
    },
    pipelineArtifact: {
      deleteMany: vi.fn(),
    },
  },
  fs: {
    rm: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/pipelines/run-delete", () => ({
  cleanupRunOutputData: mocks.cleanupRunOutputData,
}));

vi.mock("@/lib/pipelines/pipeline-run-ops-service", () => ({
  cancelPipelineRunForOperator: mocks.cancelPipelineRunForOperator,
}));

vi.mock("@/lib/pipelines/queue-probe", () => ({
  readIdentityCheckedQueueSnapshot: mocks.readIdentityCheckedQueueSnapshot,
  isQueueSnapshotRetryable: (snapshot: {
    identityVerified: boolean;
    state: string | null;
  }) =>
    !snapshot.identityVerified ||
    !snapshot.state ||
    snapshot.state === "UNKNOWN",
  isActiveQueueState: (state: string | null) =>
    Boolean(state && ["PENDING", "RUNNING", "COMPLETING"].includes(state)),
  isTerminalQueueState: (state: string | null) =>
    Boolean(
      state &&
        (["COMPLETED", "EXITED", "FAILED"].includes(state) ||
          state.startsWith("CANCELLED"))
    ),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("fs/promises", () => ({
  default: {
    rm: mocks.fs.rm,
  },
}));

import { POST } from "./route";

describe("POST /api/pipelines/runs/[id]/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.cleanupRunOutputData.mockResolvedValue(undefined);
    mocks.cancelPipelineRunForOperator.mockResolvedValue({
      status: 200,
      body: { success: true, status: "cancelled" },
    });
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({
      state: "CANCELLED",
      reason: null,
      source: "sacct",
      identityVerified: true,
    });
    mocks.db.assembly.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.bin.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRunStep.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineArtifact.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRun.delete.mockResolvedValue({ id: "run-1" });
    mocks.fs.rm.mockResolvedValue(undefined);
  });

  it("uses the fresh cancelled snapshot for queued-run output cleanup", async () => {
    const queuedRun = {
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: null,
      inputSampleIds: '["sample-1"]',
      order: {
        id: "order-1",
        samples: [
          { id: "sample-1", sampleId: "S1" },
          { id: "sample-2", sampleId: "S2" },
        ],
      },
      study: null,
    };
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        status: "cancelled",
        statusSource: "manual",
      });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cleanupRunOutputData).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        samples: [{ id: "sample-1", sampleId: "S1" }],
      })
    );
  });

  it("limits cleanup to the run's selected samples", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "completed",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      inputSampleIds: '["sample-1"]',
      order: {
        id: "order-1",
        samples: [
          { id: "sample-1", sampleId: "S1" },
          { id: "sample-2", sampleId: "S2" },
        ],
      },
      study: null,
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cleanupRunOutputData).toHaveBeenCalledWith({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the run does not exist", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.cleanupRunOutputData).not.toHaveBeenCalled();
  });

  it("returns 400 for running runs", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "running",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      inputSampleIds: null,
      order: {
        id: "order-1",
        samples: [{ id: "sample-1", sampleId: "S1" }],
      },
      study: null,
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.cleanupRunOutputData).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });

  it.each(["finalizing", "cancelling"])(
    "rejects an active %s lifecycle owner before cancellation",
    async (statusSource) => {
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        id: "run-1",
        pipelineId: "simulate-reads",
        status: "queued",
        statusSource,
        queueJobId: null,
        targetType: "order",
        orderId: "order-1",
        studyId: null,
        runFolder: "/tmp/run-1",
        inputSampleIds: null,
        order: { id: "order-1", samples: [] },
        study: null,
      });

      const response = await POST(
        new NextRequest(
          "http://localhost:3000/api/pipelines/runs/run-1/delete",
          { method: "POST" }
        ),
        { params: Promise.resolve({ id: "run-1" }) }
      );

      expect(response.status).toBe(409);
      expect(mocks.cancelPipelineRunForOperator).not.toHaveBeenCalled();
      expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
    }
  );

  it("cancels the live scheduler job before deleting a queued run", async () => {
    const queuedRun = {
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "12345",
      inputSampleIds: null,
      order: {
        id: "order-1",
        samples: [{ id: "sample-1", sampleId: "S1" }],
      },
      study: null,
    };
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        status: "cancelled",
        statusSource: "manual",
      });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelPipelineRunForOperator).toHaveBeenCalledWith("run-1");
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalled();
  });

  it("does not delete while the exact queue job is still active", async () => {
    const queuedRun = {
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      statusSource: "launcher",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "12345",
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    };
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        status: "cancelled",
        statusSource: "manual",
      });
    mocks.readIdentityCheckedQueueSnapshot.mockResolvedValue({
      state: "COMPLETING",
      reason: null,
      source: "squeue",
      identityVerified: true,
    });

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/pipelines/runs/run-1/delete",
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
    expect(mocks.fs.rm).not.toHaveBeenCalled();
  });

  it("cancels the live scheduler job before deleting a pending run", async () => {
    const pendingRun = {
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "pending",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "local-9999",
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    };
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce(pendingRun)
      .mockResolvedValueOnce({
        ...pendingRun,
        status: "cancelled",
        statusSource: "manual",
      });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelPipelineRunForOperator).toHaveBeenCalledWith("run-1");
  });

  it("claims and cancels a queued run without an initial queue job id", async () => {
    const queuedRun = {
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: null,
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    };
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        status: "cancelled",
        statusSource: "manual",
      });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelPipelineRunForOperator).toHaveBeenCalledWith("run-1");
    expect(mocks.db.pipelineRun.delete).toHaveBeenCalled();
  });

  it("aborts deletion when cancelling the live job fails", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "12345",
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    });
    mocks.cancelPipelineRunForOperator.mockResolvedValue({
      status: 400,
      body: { error: "Cannot cancel a completed or failed run" },
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
  });

  it("does not delete while another lifecycle owner holds cancellation", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "12345",
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    });
    mocks.cancelPipelineRunForOperator.mockResolvedValue({
      status: 409,
      body: {
        error: "Run output finalization is already in progress",
        status: "queued",
        statusSource: "finalizing",
      },
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.cleanupRunOutputData).not.toHaveBeenCalled();
    expect(mocks.db.assembly.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.bin.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRunStep.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineArtifact.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
    expect(mocks.fs.rm).not.toHaveBeenCalled();
  });

  it("defensively rejects a non-terminal successful cancellation response", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "queued",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      queueJobId: "12345",
      inputSampleIds: null,
      order: { id: "order-1", samples: [] },
      study: null,
    });
    mocks.cancelPipelineRunForOperator.mockResolvedValue({
      status: 200,
      body: {
        success: true,
        status: "queued",
        statusSource: "cancelling",
      },
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "queued",
      statusSource: "cancelling",
    });
    expect(mocks.db.pipelineRun.delete).not.toHaveBeenCalled();
    expect(mocks.fs.rm).not.toHaveBeenCalled();
  });

  it("falls back to all target samples when selected sample metadata is invalid", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "completed",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      inputSampleIds: '{"sample":"bad"}',
      order: {
        id: "order-1",
        samples: [
          { id: "sample-1", sampleId: "S1" },
          { id: "sample-2", sampleId: "S2" },
        ],
      },
      study: null,
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cleanupRunOutputData).toHaveBeenCalledWith({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [
        { id: "sample-1", sampleId: "S1" },
        { id: "sample-2", sampleId: "S2" },
      ],
    });
  });

  it("falls back to all target samples when selected sample metadata cannot be parsed", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "completed",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: "/tmp/run-1",
      inputSampleIds: "not-json",
      order: {
        id: "order-1",
        samples: [
          { id: "sample-1", sampleId: "S1" },
          { id: "sample-2", sampleId: "S2" },
        ],
      },
      study: null,
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cleanupRunOutputData).toHaveBeenCalledWith({
      runId: "run-1",
      pipelineId: "simulate-reads",
      runFolder: "/tmp/run-1",
      target: { type: "order", orderId: "order-1" },
      samples: [
        { id: "sample-1", sampleId: "S1" },
        { id: "sample-2", sampleId: "S2" },
      ],
    });
  });

  it("returns 500 when deletion fails unexpectedly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      status: "completed",
      targetType: "order",
      orderId: "order-1",
      studyId: null,
      runFolder: null,
      inputSampleIds: null,
      order: {
        id: "order-1",
        samples: [{ id: "sample-1", sampleId: "S1" }],
      },
      study: null,
    });
    mocks.db.pipelineRun.delete.mockRejectedValue(new Error("db write failed"));

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
