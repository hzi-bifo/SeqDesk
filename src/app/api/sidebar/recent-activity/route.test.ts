import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: {
    pipelineRun: { findMany: vi.fn() },
    submission: { findMany: vi.fn() },
    study: { findUnique: vi.fn() },
    sample: { findUnique: vi.fn() },
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

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

vi.mock("@/lib/pipelines", () => ({
  PIPELINE_REGISTRY: {
    fastqc: { name: "FastQC" },
  },
}));

import { GET } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

describe("GET /api/sidebar/recent-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns pipeline runs and archive uploads for facility admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN", isDemo: false },
    });

    const createdAt = new Date("2025-01-15T10:00:00Z");

    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runNumber: 1,
        pipelineId: "fastqc",
        status: "completed",
        createdAt,
        study: { id: "study-1", title: "My Study" },
      },
    ]);

    mocks.db.submission.findMany.mockResolvedValue([
      {
        id: "sub-1",
        submissionType: "ENA",
        status: "completed",
        entityType: "study",
        entityId: "study-1",
        createdAt,
      },
    ]);

    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "My Study",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pipelineRuns).toHaveLength(1);
    expect(body.pipelineRuns[0].pipelineName).toBe("FastQC");
    expect(body.archiveUploads).toHaveLength(1);
    expect(body.archiveUploads[0].entityLabel).toBe("My Study");
  });

  it("returns empty runs for demo users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "demo-1", role: "RESEARCHER", isDemo: true },
    });

    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.submission.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pipelineRuns).toEqual([]);
    expect(body.archiveUploads).toEqual([]);
  });

  it("shows installation-wide activity to a Shared Lab member", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER", isDemo: false },
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.submission.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.findMany.mock.calls[0][0].where).toEqual({});
    expect(mocks.db.submission.findMany).toHaveBeenCalledTimes(1);
  });
});
