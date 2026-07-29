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
      updateMany: vi.fn(),
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
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
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

  it("reports a running local job but does NOT revive a completed run (PID reuse safety)", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-42",
      runFolder: "/runs/run-1",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockResolvedValueOnce({
      stdout: "bash /runs/run-1/run.sh\n",
      stderr: "",
    });

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
    // Queue status is refreshed, but a terminal run must not be revived:
    // local PIDs are recycled by the OS, so a live PID does not prove the
    // original job is still running.
    const updateCall = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(updateCall.data).toMatchObject({
      queueStatus: "RUNNING",
      queueReason: null,
    });
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.completedAt).toBeUndefined();
    expect(updateCall.data.currentStep).toBeUndefined();
  });

  it("promotes a queued run when SLURM reports RUNNING", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "5371",
      runFolder: "/runs/run-1",
      status: "queued",
      startedAt: null,
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "5371|cpu|seqdesk-run-1|brokerdp|RUNNING|01:19|1|dzif-compute-01|/runs/run-1\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("RUNNING");
    const updateCall = mocks.db.pipelineRun.updateMany.mock.calls[0][0];
    expect(updateCall.where).toEqual(
      expect.objectContaining({
        id: "run-1",
        status: { in: ["pending", "queued", "running"] },
        OR: [
          { statusSource: null },
          {
            statusSource: {
              notIn: ["finalizing", "cancelling"],
            },
          },
        ],
      })
    );
    expect(updateCall.data).toEqual(
      expect.objectContaining({
        queueStatus: "RUNNING",
        queueReason: "dzif-compute-01",
        status: "running",
        currentStep: "Running on compute node",
        statusSource: "queue",
      })
    );
    expect(updateCall.data.startedAt).toBeInstanceOf(Date);
  });

  it("falls back to sacct when squeue does not return a job", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "1234",
      runFolder: "/runs/run-1",
      status: "queued",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "", stderr: "" };
      }
      return {
        stdout:
          "1234|FAILED|scheduler failure|seqdesk-run-1|/runs/run-1|00:10|1:0\n",
        stderr: "",
      };
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
      reason: "scheduler failure",
      elapsed: "00:10",
      exitCode: "1:0",
      source: "sacct",
    });
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "run-1",
        status: { in: ["pending", "queued", "running"] },
      }),
      data: expect.objectContaining({
        queueStatus: "FAILED",
      }),
    });
  });

  it("returns unavailable when neither local nor slurm lookups find the job", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "1234",
      runFolder: "/runs/run-1",
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
      message: "Stored SLURM job identity was not found in squeue or sacct",
    });
  });

  it("returns unavailable for invalid local PID format (non-numeric)", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-abc",
      runFolder: "/runs/run-1",
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
      message: "Stored local job ID is invalid",
    });
  });

  it("keeps a disappeared local process retryable without an exit marker", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-99",
      runFolder: "/runs/run-1",
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
      available: false,
      message: "Stored local job identity could not be inspected",
    });
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it("returns unavailable for SLURM job with non-numeric ID format", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "abc-xyz",
      runFolder: "/runs/run-1",
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
      message: "Stored SLURM job ID has an invalid format",
    });
  });

  it("falls through to sacct when squeue returns empty stdout", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "5678",
      runFolder: "/runs/run-1",
      status: "running",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return { stdout: "\n", stderr: "" };
      }
      return {
        stdout:
          "5678|COMPLETED|None|seqdesk-run-1|/runs/run-1|01:30|0:0\n",
        stderr: "",
      };
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
      runFolder: "/runs/run-1",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "9999|batch|seqdesk-run-1|user1|TIMEOUT|01:00|1|(null)|/runs/run-1\n",
          stderr: "",
        };
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
      runFolder: "/runs/run-1",
      status: "completed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "8888|batch|seqdesk-run-1|user1|NODE_FAIL|00:30|1|(null)|/runs/run-1\n",
          stderr: "",
        };
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
      runFolder: "/runs/run-1",
      status: "failed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "7777|batch|seqdesk-run-1|user1|PREEMPTED|00:15|1|(null)|/runs/run-1\n",
          stderr: "",
        };
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
      runFolder: "/runs/run-1",
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
      message: "Stored SLURM job identity was not found in squeue or sacct",
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
      selectedResultSelections: [{ id: "sel-1" }],
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 for a non-admin owner of an unpublished run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "local-42",
      status: "running",
      study: { userId: "user-1" },
      order: null,
      selectedResultSelections: [],
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("allows a non-admin owner of a published run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: null,
      status: "completed",
      study: { userId: "user-1" },
      order: null,
      selectedResultSelections: [{ id: "sel-1" }],
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

  it("does NOT revive a failed run even when SLURM reports PENDING (job id reuse safety)", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "4444",
      runFolder: "/runs/run-1",
      status: "failed",
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "4444|batch|seqdesk-run-1|user1|PENDING|00:00|1|(Resources)|/runs/run-1\n",
          stderr: "",
        };
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
    // SLURM numeric job ids are recycled, so a live PENDING job for the same
    // id does not justify reviving a terminal run.
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.currentStep).toBeUndefined();
    expect(updateCall.data.completedAt).toBeUndefined();
  });

  it("still reconciles a non-terminal queued run promoted to running", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      queueJobId: "5555",
      runFolder: "/runs/run-1",
      status: "queued",
      startedAt: null,
      study: null,
      order: null,
    });
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === "squeue") {
        return {
          stdout:
            "5555|cpu|seqdesk-run-1|user1|RUNNING|00:30|1|node-01|/runs/run-1\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/queue"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const updateCall = mocks.db.pipelineRun.updateMany.mock.calls[0][0];
    expect(updateCall.data.status).toBe("running");
    expect(updateCall.data.currentStep).toBe("Running on compute node");
  });
});
