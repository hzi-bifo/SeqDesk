import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getOnboardingStatus: vi.fn(),
  setOnboardingItemCompletion: vi.fn(),
  verifyAutomaticOnboarding: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/onboarding/server", () => ({
  getOnboardingStatus: mocks.getOnboardingStatus,
  setOnboardingItemCompletion: mocks.setOnboardingItemCompletion,
  verifyAutomaticOnboarding: mocks.verifyAutomaticOnboarding,
}));

import { GET, PATCH, POST } from "./route";

const status = {
  schemaVersion: 1,
  requiredVersion: 1,
  required: true,
  profile: "shared-lab",
  complete: false,
  completedCount: 0,
  totalCount: 8,
  items: [],
};

describe("/api/admin/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN", isDemo: false },
    });
    mocks.getOnboardingStatus.mockResolvedValue(status);
    mocks.setOnboardingItemCompletion.mockResolvedValue({
      ...status,
      completedCount: 1,
    });
    mocks.verifyAutomaticOnboarding.mockResolvedValue({
      ...status,
      completedCount: 1,
    });
  });

  it("returns the administrator checklist", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(status);
  });

  it("does not expose the checklist to ordinary members", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER" },
    });
    expect((await GET()).status).toBe(403);
  });

  it("records the authenticated administrator as the completion actor", async () => {
    const request = new Request("http://localhost/api/admin/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "acknowledge-backups",
        complete: true,
      }),
    });
    const response = await PATCH(request as never);
    expect(response.status).toBe(200);
    expect(mocks.setOnboardingItemCompletion).toHaveBeenCalledWith({
      itemId: "acknowledge-backups",
      complete: true,
      actorUserId: "admin-1",
    });
  });

  it("keeps demo installations read-only", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "demo-1", role: "FACILITY_ADMIN", isDemo: true },
    });
    const request = new Request("http://localhost/api/admin/onboarding", {
      method: "PATCH",
      body: JSON.stringify({ itemId: "verify-storage", complete: true }),
    });
    expect((await PATCH(request as never)).status).toBe(403);
    expect(mocks.setOnboardingItemCompletion).not.toHaveBeenCalled();
  });

  it("runs automatic readiness checks as the authenticated administrator", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.verifyAutomaticOnboarding).toHaveBeenCalledWith({
      actorUserId: "admin-1",
    });
  });

  it("does not let a manual PATCH bypass an automatic check", async () => {
    mocks.setOnboardingItemCompletion.mockRejectedValue(
      new Error("Automatic onboarding items cannot be changed manually.")
    );
    const request = new Request("http://localhost/api/admin/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "verify-storage", complete: true }),
    });
    const response = await PATCH(request as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Automatic onboarding items cannot be changed manually.",
    });
  });

  it("does not run automatic checks for demo administrators", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "demo-1", role: "FACILITY_ADMIN", isDemo: true },
    });

    expect((await POST()).status).toBe(403);
    expect(mocks.verifyAutomaticOnboarding).not.toHaveBeenCalled();
  });
});
