import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  db: {
    order: { count: vi.fn() },
    study: { count: vi.fn() },
    read: { count: vi.fn() },
    submission: { count: vi.fn() },
    pipelineRun: { count: vi.fn() },
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

import { GET } from "./route";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

describe("GET /api/sidebar/counts", () => {
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

  it("returns counts for a regular researcher", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER", isDemo: false },
    });
    mocks.db.order.count.mockResolvedValue(3);
    mocks.db.study.count.mockResolvedValue(2);
    mocks.db.pipelineRun.count.mockResolvedValue(1);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      orders: 3,
      studies: 2,
      files: 0,
      submissions: 0,
      analysis: 1,
    });
    // Researcher queries are scoped to their userId
    expect(mocks.db.order.count).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("returns all counts for a facility admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN", isDemo: false },
    });
    mocks.db.order.count.mockResolvedValue(10);
    mocks.db.study.count.mockResolvedValue(5);
    mocks.db.read.count.mockResolvedValue(100);
    mocks.db.submission.count.mockResolvedValue(7);
    mocks.db.pipelineRun.count.mockResolvedValue(2);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      orders: 10,
      studies: 5,
      files: 100,
      submissions: 7,
      analysis: 2,
    });
  });

  it("returns installation-wide operational counts for a Shared Lab member", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER", isDemo: false },
    });
    mocks.db.order.count.mockResolvedValue(10);
    mocks.db.study.count.mockResolvedValue(5);
    mocks.db.read.count.mockResolvedValue(100);
    mocks.db.submission.count.mockResolvedValue(7);
    mocks.db.pipelineRun.count.mockResolvedValue(2);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: 10,
      studies: 5,
      files: 100,
      submissions: 7,
      analysis: 2,
    });
    expect(mocks.db.order.count).toHaveBeenCalledWith({ where: {} });
    expect(mocks.db.pipelineRun.count).toHaveBeenCalledWith({
      where: { status: { in: ["pending", "queued", "running"] } },
    });
  });

  it("returns 404 for the facility sidebar in Research Workbench", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER", isDemo: false },
    });

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mocks.db.order.count).not.toHaveBeenCalled();
  });
});
