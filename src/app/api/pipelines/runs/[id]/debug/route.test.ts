import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
  },
  getExecutionSettings: vi.fn(),
  execFileAsync: vi.fn(),
  fsAccess: vi.fn(),
  fsStat: vi.fn(),
  fsOpen: vi.fn(),
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

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: () => mocks.execFileAsync,
}));

vi.mock("fs/promises", () => ({
  default: {
    access: (...args: unknown[]) => mocks.fsAccess(...args),
    stat: (...args: unknown[]) => mocks.fsStat(...args),
    open: (...args: unknown[]) => mocks.fsOpen(...args),
  },
}));

import { GET } from "./route";

const defaultExecSettings = {
  useSlurm: false,
  slurmQueue: "default",
  slurmCores: 8,
  slurmMemory: "32G",
  slurmTimeLimit: 48,
  slurmOptions: "",
  runtimeMode: "conda" as const,
  condaPath: "/opt/conda",
  condaEnv: "seqdesk-pipelines",
  nextflowProfile: "standard",
  pipelineRunDir: "/data/runs",
  weblogUrl: "http://localhost:3000/api/pipelines/weblog",
  weblogSecret: "",
};

const baseRun = {
  id: "run-1",
  runNumber: "RUN-001",
  pipelineId: "mag",
  status: "running",
  statusSource: "weblog",
  currentStep: "Assembly",
  progress: 50,
  queueJobId: null,
  queueStatus: null,
  queueReason: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  queuedAt: null,
  startedAt: new Date("2025-01-01T00:01:00Z"),
  completedAt: null,
  lastEventAt: new Date("2025-01-01T01:00:00Z"),
  runFolder: "/data/runs/run-1",
  outputPath: null,
  errorPath: null,
  outputTail: null,
  errorTail: null,
  config: null,
  targetType: "study",
  inputSampleIds: null,
  userId: "user-1",
  orderId: null,
  studyId: "study-1",
  order: null,
  study: {
    id: "study-1",
    title: "Test Study",
    userId: "user-1",
    samples: [
      {
        id: "sample-1",
        sampleId: "S001",
        reads: [
          {
            id: "read-1",
            file1: "/data/reads/S001_R1.fastq.gz",
            file2: "/data/reads/S001_R2.fastq.gz",
            checksum1: "abc123",
            checksum2: "def456",
          },
        ],
      },
    ],
  },
  user: {
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
  },
};

function makeRequest(runId: string, format?: string): NextRequest {
  const url = format
    ? `http://localhost:3000/api/pipelines/runs/${runId}/debug?format=${format}`
    : `http://localhost:3000/api/pipelines/runs/${runId}/debug`;
  return new NextRequest(url, { method: "GET" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/pipelines/runs/[id]/debug", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue(baseRun);
    mocks.getExecutionSettings.mockResolvedValue(defaultExecSettings);

    // Default: shell commands succeed with empty output
    mocks.execFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

    // Default: files don't exist
    mocks.fsAccess.mockRejectedValue(new Error("ENOENT"));
    mocks.fsStat.mockRejectedValue(new Error("ENOENT"));
    mocks.fsOpen.mockRejectedValue(new Error("ENOENT"));
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("demo");
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("nonexistent"), makeParams("nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Run not found");
  });

  it("returns 403 when non-admin user does not own the run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("allows study owner to access their run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("run-1");
  });

  it("returns JSON debug bundle by default", async () => {
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.run).toBeDefined();
    expect(body.run.id).toBe("run-1");
    expect(body.run.pipelineId).toBe("mag");
    expect(body.run.status).toBe("running");
    expect(body.executionSettings).toBeDefined();
    expect(body.executionSettings.useSlurm).toBe(false);
    expect(body.hostDiagnostics).toBeDefined();
    expect(body.files).toBeDefined();
    expect(body.collectionCommand).toBeDefined();
    expect(body.notes).toBeInstanceOf(Array);
  });

  it("returns text format when requested", async () => {
    const res = await GET(makeRequest("run-1", "text"), makeParams("run-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("SeqDesk Debug Bundle");
    expect(text).toContain("RunID: run-1");
    expect(text).toContain("Pipeline: mag");
  });

  it("includes target info for study-based runs", async () => {
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.target).toBeDefined();
    expect(body.target.type).toBe("study");
    expect(body.target.id).toBe("study-1");
    expect(body.target.selectedSampleCount).toBe(1);
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.db.pipelineRun.findUnique.mockRejectedValue(new Error("DB error"));
    const res = await GET(makeRequest("run-1"), makeParams("run-1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to build debug bundle");
  });
});
