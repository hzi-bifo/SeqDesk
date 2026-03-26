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

  it("returns unavailable for invalid local PID format (non-numeric)", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-abc",
      status: "running",
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
      message: "Invalid local job id",
    });
  });

  it("reports exited local job when ps command fails", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-99",
      status: "running",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockRejectedValueOnce(new Error("No such process"));

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      type: "local",
      status: "exited",
      pid: 99,
    });
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        queueStatus: "EXITED",
      }),
    });
  });

  it("returns unavailable for SLURM job with non-numeric ID format", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "abc-xyz",
      status: "running",
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
      message: "Unknown job id format",
    });
  });

  it("falls through to sacct when squeue returns empty stdout", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "5678",
      status: "running",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "\n", stderr: "" };
      }
      return { stdout: "5678|COMPLETED|01:30|0:0\n", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("sacct");
    expect(body.status).toBe("COMPLETED");
  });

  it("treats TIMEOUT as terminal state and does not revive run", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "9999",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "9999|batch|test|user1|TIMEOUT|01:00|1|(null)\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("TIMEOUT");
    // Should NOT revive the run (no status field in update data)
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it("treats NODE_FAIL as terminal state", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "8888",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "8888|batch|test|user1|NODE_FAIL|00:30|1|(null)\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("NODE_FAIL");
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it("treats PREEMPTED as terminal state", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "7777",
      status: "failed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "7777|batch|test|user1|PREEMPTED|00:15|1|(null)\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("PREEMPTED");
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it("returns unavailable when sacct returns empty output", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "6666",
      status: "queued",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "", stderr: "" };
      }
      // sacct also empty
      return { stdout: "\n", stderr: "" };
    });

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

  it("returns 500 on general error", async () => {
    mocks.db.pipelineRun.findUnique.mockRejectedValue(new Error("DB failure"));

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to check queue status");
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when non-admin user does not own the run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-42",
      status: "running",
      study: { userId: "user-1" },
      order: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("revives a failed run with PENDING queue state to queued", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "4444",
      status: "failed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "4444|batch|test|user1|PENDING|00:00|1|(Resources)\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("PENDING");
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("queued");
    expect(updateCall.data.currentStep).toBe("Queued");
  });
});
