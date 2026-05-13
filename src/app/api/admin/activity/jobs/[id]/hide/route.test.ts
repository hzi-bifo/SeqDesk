import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  hideAdminActivityJob: vi.fn(),
  listAdminActivityJobs: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/admin/activity", () => ({
  hideAdminActivityJob: mocks.hideAdminActivityJob,
  listAdminActivityJobs: mocks.listAdminActivityJobs,
}));

import { POST } from "./route";

describe("POST /api/admin/activity/jobs/[id]/hide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.hideAdminActivityJob.mockResolvedValue(true);
    mocks.listAdminActivityJobs.mockResolvedValue([]);
  });

  it("hides an activity job for facility admins and returns refreshed jobs", async () => {
    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "pipeline-db:metaxpath:db-bundle" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.hideAdminActivityJob).toHaveBeenCalledWith(
      "pipeline-db:metaxpath:db-bundle"
    );
    await expect(response.json()).resolves.toEqual({
      hidden: true,
      jobs: [],
    });
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "seed:dummy-data:admin-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.hideAdminActivityJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the activity job is no longer visible", async () => {
    mocks.hideAdminActivityJob.mockResolvedValue(false);

    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
