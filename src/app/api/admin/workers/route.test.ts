import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  visibleWorkers: vi.fn(),
  reconcileWorker: vi.fn(),
  listPausedWorkers: vi.fn(),
  getPipelineLoadSummary: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workers/registry", () => ({
  visibleWorkers: mocks.visibleWorkers,
}));

vi.mock("@/lib/workers/process", () => ({
  reconcileWorker: mocks.reconcileWorker,
}));

vi.mock("@/lib/workers/pause", () => ({
  listPausedWorkers: mocks.listPausedWorkers,
}));

vi.mock("@/lib/admin/pipeline-load", () => ({
  getPipelineLoadSummary: mocks.getPipelineLoadSummary,
}));

import { GET } from "./route";

describe("GET /api/admin/workers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.visibleWorkers.mockReturnValue([
      {
        name: "pipeline-monitor",
        label: "Pipeline monitor",
        description: "Polls SLURM and Nextflow trace files.",
        script: "scripts/pipeline-monitor.ts",
        supportsPause: false,
        devOnly: false,
      },
    ]);
    mocks.reconcileWorker.mockResolvedValue({
      row: {
        id: "worker-1",
        name: "pipeline-monitor",
        pid: 1234,
        startedAt: "2026-05-19T10:00:00.000Z",
        stoppedAt: null,
        status: "RUNNING",
        exitCode: null,
        logPath: "/tmp/pipeline-monitor.log",
        lastErrorMsg: null,
        startedByEmail: "admin@example.com",
      },
    });
    mocks.listPausedWorkers.mockResolvedValue([]);
    mocks.getPipelineLoadSummary.mockResolvedValue({
      totalActive: 2,
      statuses: { pending: 0, queued: 1, running: 1 },
      modes: { slurm: 1, local: 1, unknown: 0 },
      staleActive: 0,
      staleByStatus: { pending: 0, queued: 0, running: 0 },
      totalUsers: 0,
      visibleUsers: [],
      hiddenUserCount: 0,
      users: [],
      updatedAt: "2026-05-19T10:01:00.000Z",
    });
  });

  it("returns 401 for non-admin sessions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getPipelineLoadSummary).not.toHaveBeenCalled();
  });

  it("returns worker cards and pipeline load for facility admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0]).toMatchObject({
      name: "pipeline-monitor",
      label: "Pipeline monitor",
      latest: { status: "RUNNING" },
    });
    expect(body.pipelineLoad).toMatchObject({
      totalActive: 2,
      statuses: { pending: 0, queued: 1, running: 1 },
      modes: { slurm: 1, local: 1, unknown: 0 },
    });
  });

  it("returns pipeline load when worker reconciliation fails", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.reconcileWorker.mockRejectedValue(new Error("process table unavailable"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workers).toEqual([
      expect.objectContaining({
        name: "pipeline-monitor",
        latest: null,
      }),
    ]);
    expect(body.pipelineLoad).toMatchObject({ totalActive: 2 });
    expect(body.workersError).toBe("Some background worker status could not be loaded.");
  });

  it("returns workers when pipeline load aggregation fails", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getPipelineLoadSummary.mockRejectedValue(new Error("db timeout"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workers).toHaveLength(1);
    expect(body.pipelineLoad).toBeNull();
    expect(body.pipelineLoadError).toBe("Pipeline load could not be loaded.");
  });

  it("returns safe empty sections when worker and pipeline load reads both fail", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.visibleWorkers.mockImplementation(() => {
      throw new Error("registry unavailable");
    });
    mocks.getPipelineLoadSummary.mockRejectedValue(new Error("db timeout"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workers).toEqual([]);
    expect(body.pipelineLoad).toBeNull();
    expect(body.workersError).toBe("Some background worker status could not be loaded.");
    expect(body.pipelineLoadError).toBe("Pipeline load could not be loaded.");
  });
});
