import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findMany: vi.fn(),
    },
    submission: {
      findMany: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    sample: {
      findUnique: vi.fn(),
    },
  },
  pipelineRegistry: {
    "simulate-reads": {
      name: "Simulate Reads",
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

vi.mock("@/lib/pipelines", () => ({
  PIPELINE_REGISTRY: mocks.pipelineRegistry,
}));

import { GET } from "./route";

describe("GET /api/sidebar/recent-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
        isDemo: false,
      },
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runNumber: "SIM-001",
        pipelineId: "simulate-reads",
        status: "completed",
        createdAt: new Date("2025-01-02T03:04:05.000Z"),
        study: {
          id: "study-1",
          title: "Study One",
        },
      },
      {
        id: "run-2",
        runNumber: "UNK-001",
        pipelineId: "unknown-pipeline",
        status: "queued",
        createdAt: new Date("2025-01-03T03:04:05.000Z"),
        study: null,
      },
    ]);
    mocks.db.submission.findMany.mockResolvedValue([
      {
        id: "submission-1",
        submissionType: "ena",
        status: "submitted",
        entityType: "study",
        entityId: "study-1",
        createdAt: new Date("2025-01-04T03:04:05.000Z"),
      },
      {
        id: "submission-2",
        submissionType: "ena",
        status: "queued",
        entityType: "sample",
        entityId: "sample-1",
        createdAt: new Date("2025-01-05T03:04:05.000Z"),
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study One",
    });
    mocks.db.sample.findUnique.mockResolvedValue({
      sampleId: "S1",
      sampleTitle: "Sample One",
      study: {
        id: "study-1",
        title: "Study One",
      },
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns mapped pipeline runs and archive uploads for admins", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.findMany).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        runNumber: true,
        pipelineId: true,
        status: true,
        createdAt: true,
        study: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    expect(mocks.db.submission.findMany).toHaveBeenCalledTimes(1);
    expect(body.pipelineRuns).toEqual([
      expect.objectContaining({
        id: "run-1",
        pipelineName: "Simulate Reads",
      }),
      expect.objectContaining({
        id: "run-2",
        pipelineName: "unknown-pipeline",
      }),
    ]);
    expect(body.archiveUploads).toEqual([
      {
        id: "submission-1",
        submissionType: "ena",
        status: "submitted",
        entityType: "study",
        entityLabel: "Study One",
        createdAt: "2025-01-04T03:04:05.000Z",
        study: {
          id: "study-1",
          title: "Study One",
        },
      },
      {
        id: "submission-2",
        submissionType: "ena",
        status: "queued",
        entityType: "sample",
        entityLabel: "Sample One",
        createdAt: "2025-01-05T03:04:05.000Z",
        study: {
          id: "study-1",
          title: "Study One",
        },
      },
    ]);
  });

  it("suppresses pipeline and submission queries for demo users and non-admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
        isDemo: true,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.findMany).not.toHaveBeenCalled();
    expect(mocks.db.submission.findMany).not.toHaveBeenCalled();
    expect(body).toEqual({
      pipelineRuns: [],
      archiveUploads: [],
    });
  });
});
