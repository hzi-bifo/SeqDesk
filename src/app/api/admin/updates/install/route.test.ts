import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  acquireUpdateLock: vi.fn(),
  isUpdateInProgress: vi.fn(),
  releaseUpdateLock: vi.fn(),
  writeUpdateStatus: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/updater", () => ({
  checkForUpdates: mocks.checkForUpdates,
}));

vi.mock("@/lib/updater/installer", () => ({
  installUpdate: mocks.installUpdate,
}));

vi.mock("@/lib/updater/status", () => ({
  acquireUpdateLock: mocks.acquireUpdateLock,
  isUpdateInProgress: mocks.isUpdateInProgress,
  releaseUpdateLock: mocks.releaseUpdateLock,
  writeUpdateStatus: mocks.writeUpdateStatus,
}));

import { POST } from "./route";

describe("POST /api/admin/updates/install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.isUpdateInProgress.mockResolvedValue(false);
    mocks.acquireUpdateLock.mockResolvedValue(true);
    mocks.writeUpdateStatus.mockResolvedValue(undefined);
    mocks.installUpdate.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it("starts update when available", async () => {
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      databaseCompatible: true,
      latest: { version: "1.2.0", downloadUrl: "https://example.com/update.tar.gz" },
    });

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.version).toBe("1.2.0");
    expect(mocks.installUpdate).toHaveBeenCalled();
  });

  it("returns 409 when update already in progress", async () => {
    mocks.isUpdateInProgress.mockResolvedValue(true);

    const response = await POST();

    expect(response.status).toBe(409);
  });
});
