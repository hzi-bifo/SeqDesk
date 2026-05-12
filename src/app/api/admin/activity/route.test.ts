import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listAdminActivityJobs: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/admin/activity", () => ({
  listAdminActivityJobs: mocks.listAdminActivityJobs,
}));

import { GET } from "./route";

describe("GET /api/admin/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.listAdminActivityJobs.mockResolvedValue([
      {
        id: "pipeline-db:metaxpath:db-bundle",
        type: "pipeline-db-download",
        label: "MetaxPath Database Bundle (metaxpath)",
        state: "running",
        phase: "downloading",
        bytesDownloaded: 100,
        totalBytes: 200,
        progressPercent: 50,
      },
    ]);
  });

  it("returns admin activity jobs for facility admins", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [
        expect.objectContaining({
          id: "pipeline-db:metaxpath:db-bundle",
          state: "running",
          progressPercent: 50,
        }),
      ],
    });
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });
});
