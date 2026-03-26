import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
  },
  fsReadFile: vi.fn(),
  findTraceFile: vi.fn(),
  parseTraceFile: vi.fn(),
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

vi.mock("fs/promises", () => ({
  default: {
    readFile: mocks.fsReadFile,
  },
}));

vi.mock("@/lib/pipelines/nextflow", () => ({
  parseTraceFile: mocks.parseTraceFile,
  findTraceFile: mocks.findTraceFile,
}));

import { GET } from "./route";

const makeRequest = (query = "") =>
  new NextRequest(`http://localhost:3000/api/pipelines/runs/run-1/logs${query}`);

const makeParams = (id = "run-1") => ({ params: Promise.resolve({ id }) });

const baseRun = {
  id: "run-1",
  runFolder: "/data/runs/run-1",
  outputPath: "logs/pipeline.out",
  errorPath: "logs/pipeline.err",
  outputTail: "cached output tail",
  errorTail: "cached error tail",
  status: "completed",
  progress: 100,
  currentStep: "Done",
  study: { userId: "user-1" },
  order: null,
};

describe("GET /api/pipelines/runs/[id]/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(baseRun);
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    mocks.findTraceFile.mockResolvedValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when run does not exist", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns cached tail when file read fails", async () => {
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("cached output tail");
    expect(body.fromFile).toBe(false);
  });

  it("returns file content when file exists", async () => {
    mocks.fsReadFile.mockResolvedValue("line1\nline2\nline3\n");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromFile).toBe(true);
    expect(body.content).toContain("line1");
  });

  it("returns error log when type=error", async () => {
    const res = await GET(makeRequest("?type=error"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("cached error tail");
  });

  it("allows FACILITY_ADMIN to view any run", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });

  it("includes trace steps when run is running", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: "running",
      progress: 50,
    });
    mocks.findTraceFile.mockResolvedValue("/data/runs/run-1/trace.txt");
    mocks.parseTraceFile.mockResolvedValue({
      overallProgress: 75,
      processes: new Map([
        ["FASTQC", { name: "FASTQC", status: "completed", totalTasks: 2 }],
      ]),
    });

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.progress).toBe(75);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].process).toBe("FASTQC");
  });
});
