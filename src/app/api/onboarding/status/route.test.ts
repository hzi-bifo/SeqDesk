import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getOnboardingStatus: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/onboarding/server", () => ({
  getOnboardingStatus: mocks.getOnboardingStatus,
}));

import { GET } from "./route";

describe("GET /api/onboarding/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER" },
    });
    mocks.getOnboardingStatus.mockResolvedValue({
      schemaVersion: 1,
      requiredVersion: 1,
      required: true,
      profile: "research-workbench",
      complete: false,
      completedCount: 2,
      totalCount: 8,
      items: [
        {
          id: "verify-storage",
          label: "Verify storage",
          description: "private administrator detail",
          complete: true,
          completion: {
            completedAt: "2026-09-03T12:00:00.000Z",
            completedByUserId: "admin-1",
          },
        },
      ],
    });
  });

  it("returns only non-sensitive progress to authenticated members", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      required: true,
      complete: false,
      profile: "research-workbench",
      completedCount: 2,
      totalCount: 8,
    });
    expect(JSON.stringify(body)).not.toContain("admin-1");
  });

  it("requires authentication", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });
});
