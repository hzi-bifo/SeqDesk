import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pipelineRunStep: {
      upsert: vi.fn(),
    },
    assembly: {
      count: vi.fn(),
    },
    bin: {
      count: vi.fn(),
    },
    pipelineArtifact: {
      count: vi.fn(),
    },
  },
  parseTraceFile: vi.fn(),
  findTraceFile: vi.fn(),
  findStepByProcess: vi.fn(),
  getStepsForPipeline: vi.fn(),
  inferPipelineExitCode: vi.fn(),
  processCompletedPipelineRun: vi.fn(),
  execFileAsync: vi.fn(),
  isDemoSession: vi.fn(),
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

vi.mock("@/lib/pipelines/nextflow", () => ({
  parseTraceFile: mocks.parseTraceFile,
  findTraceFile: mocks.findTraceFile,
}));

vi.mock("@/lib/pipelines/definitions", () => ({
  findStepByProcess: mocks.findStepByProcess,
  getStepsForPipeline: mocks.getStepsForPipeline,
}));

vi.mock("@/lib/pipelines/run-completion", () => ({
  inferPipelineExitCode: mocks.inferPipelineExitCode,
  processCompletedPipelineRun: mocks.processCompletedPipelineRun,
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: () => mocks.execFileAsync,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

import { POST } from "./route";

function makeRequest() {
  return new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/sync", {
    method: "POST",
  });
}

const baseParams = Promise.resolve({ id: "run-1" });

const defaultRun = {
  id: "run-1",
  runFolder: "/tmp/runs/run-1",
  status: "running",
  pipelineId: "fastqc",
  startedAt: new Date("2024-01-01"),
  completedAt: null,
  lastEventAt: null,
  lastTraceAt: null,
  queueJobId: "local-12345",
  study: null,
  order: { userId: "user-1" },
};

describe("POST /api/pipelines/runs/[id]/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue(defaultRun);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.db.pipelineRunStep.upsert.mockResolvedValue({});
    mocks.findTraceFile.mockResolvedValue(null);
    mocks.execFileAsync.mockRejectedValue(new Error("not found"));
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.findStepByProcess.mockReturnValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("demo");
  });

  it("returns 404 when run not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(404);
  });

  it("returns 403 when user has no access to the run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      study: { userId: "owner-user" },
      order: { userId: "owner-user" },
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  it("returns 400 when run folder is not set", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      runFolder: null,
    });

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Run folder not set");
  });

  it("returns synced=false when no trace file is found", async () => {
    mocks.findTraceFile.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.synced).toBe(false);
    expect(body.message).toContain("No trace file");
  });

  it("syncs successfully when trace file is found with tasks", async () => {
    mocks.findTraceFile.mockResolvedValue("/tmp/runs/run-1/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "FASTQC",
          status: "COMPLETED",
          exit: 0,
          submit: new Date("2024-01-01T10:00:00Z"),
          start: new Date("2024-01-01T10:01:00Z"),
          complete: new Date("2024-01-01T10:05:00Z"),
        },
      ],
      processes: new Map([["FASTQC", { completed: 1, total: 1 }]]),
      overallProgress: 100,
      startedAt: new Date("2024-01-01T10:00:00Z"),
      completedAt: new Date("2024-01-01T10:05:00Z"),
    });
    mocks.findStepByProcess.mockReturnValue({ id: "fastqc", name: "FastQC" });
    mocks.getStepsForPipeline.mockReturnValue([{ id: "fastqc", name: "FastQC" }]);
    mocks.inferPipelineExitCode.mockResolvedValue(0);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.synced).toBe(true);
    expect(body.tasks).toBe(1);
  });

  it("allows the study owner (non-admin) to sync their run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "study-owner", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      study: { userId: "study-owner" },
      order: null,
    });
    mocks.findTraceFile.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("detects failed tasks from trace file", async () => {
    mocks.findTraceFile.mockResolvedValue("/tmp/runs/run-1/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      tasks: [
        {
          process: "FASTQC",
          status: "FAILED",
          exit: 1,
          submit: new Date("2024-01-01T10:00:00Z"),
          start: new Date("2024-01-01T10:01:00Z"),
          complete: new Date("2024-01-01T10:02:00Z"),
        },
      ],
      processes: new Map([["FASTQC", { completed: 0, total: 1 }]]),
      overallProgress: 0,
      startedAt: new Date("2024-01-01T10:00:00Z"),
      completedAt: null,
    });
    mocks.getStepsForPipeline.mockReturnValue([{ id: "fastqc", name: "FastQC" }]);
    mocks.inferPipelineExitCode.mockResolvedValue(1);

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.synced).toBe(true);
    // The run status should be updated in the DB
    expect(mocks.db.pipelineRun.update).toHaveBeenCalled();
  });

  it("handles queue state transition from queued to running (no trace)", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...defaultRun,
      status: "queued",
      queueJobId: "12345",
    });
    mocks.findTraceFile.mockResolvedValue(null);
    // squeue returns RUNNING
    mocks.execFileAsync.mockImplementation(
      async (cmd: string) => {
        if (cmd === "squeue") {
          return { stdout: "RUNNING|Resources\n" };
        }
        throw new Error("not found");
      }
    );

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("running");
    expect(body.queueStatus).toBe("RUNNING");
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.db.pipelineRun.findUnique.mockRejectedValue(new Error("DB crashed"));

    const response = await POST(makeRequest(), { params: baseParams });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to sync pipeline run");
  });
});
