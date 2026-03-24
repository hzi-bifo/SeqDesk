import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  cleanupRunOutputData: vi.fn(),
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
    mocks.db.assembly.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.bin.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRunStep.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineArtifact.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRun.delete.mockResolvedValue({ id: "run-1" });
    mocks.fs.rm.mockResolvedValue(undefined);
  });

  it("skips output cleanup for queued runs", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
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
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/delete", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cleanupRunOutputData).not.toHaveBeenCalled();
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
