import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  execFile: vi.fn(),
  execFileAsync: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("util", () => ({
  promisify: () => mocks.execFileAsync,
}));

import { GET } from "./route";

describe("GET /api/pipelines/runs/[id]/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.execFileAsync.mockReset();
    mocks.db.pipelineRun.update.mockResolvedValue({});
  });

  it("returns 401 without a session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(401);
  });

  it("returns unavailable when a run has no queue job id", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: null,
      status: "pending",
      study: null,
      order: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      message: "No queue job id set",
    });
  });

  it("reports a running local job and revives a completed run", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-42",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "42\n", stderr: "" });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      type: "local",
      status: "running",
      pid: 42,
    });
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        queueStatus: "RUNNING",
        queueReason: null,
        status: "running",
        currentStep: "Finalizing...",
        completedAt: null,
        statusSource: "queue",
      }),
    });
  });

  it("falls back to sacct when squeue does not return a job", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "1234",
      status: "queued",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "1234|FAILED|00:10|1:0\n", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      type: "slurm",
      status: "FAILED",
      elapsed: "00:10",
      exitCode: "1:0",
      source: "sacct",
    });
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        queueStatus: "FAILED",
      }),
    });
  });

  it("returns unavailable when neither local nor slurm lookups find the job", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "1234",
      status: "queued",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockRejectedValue(new Error("missing"));

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      message: "Job not found in squeue or sacct",
    });
  });
});
