import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  checkForUpdates: vi.fn(),
  getInstalledVersion: vi.fn(),
  installUpdate: vi.fn(),
  repairInstalledUpdate: vi.fn(),
  acquireUpdateLock: vi.fn(),
  isUpdateInProgress: vi.fn(),
  releaseUpdateLock: vi.fn(),
  writeUpdateStatus: vi.fn(),
  notifyAppUpdateStartedInApp: vi.fn(),
  notifyAppUpdateProgressInApp: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/updater", () => ({
  checkForUpdates: mocks.checkForUpdates,
  getInstalledVersion: mocks.getInstalledVersion,
}));

vi.mock("@/lib/updater/installer", () => ({
  installUpdate: mocks.installUpdate,
  repairInstalledUpdate: mocks.repairInstalledUpdate,
}));

vi.mock("@/lib/updater/status", () => ({
  acquireUpdateLock: mocks.acquireUpdateLock,
  isUpdateInProgress: mocks.isUpdateInProgress,
  releaseUpdateLock: mocks.releaseUpdateLock,
  writeUpdateStatus: mocks.writeUpdateStatus,
}));

vi.mock("@/lib/notifications/in-app", () => ({
  notifyAppUpdateStartedInApp: mocks.notifyAppUpdateStartedInApp,
  notifyAppUpdateProgressInApp: mocks.notifyAppUpdateProgressInApp,
}));

import { POST } from "./route";

function makeInstallRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/updates/install", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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
    mocks.repairInstalledUpdate.mockResolvedValue(undefined);
    mocks.getInstalledVersion.mockResolvedValue("1.2.0");
    mocks.notifyAppUpdateStartedInApp.mockResolvedValue(undefined);
    mocks.notifyAppUpdateProgressInApp.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeInstallRequest());

    expect(response.status).toBe(401);
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await POST(makeInstallRequest());

    expect(response.status).toBe(401);
  });

  it("starts update when available", async () => {
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      databaseCompatible: true,
      latest: { version: "1.2.0", downloadUrl: "https://example.com/update.tar.gz" },
    });

    const response = await POST(makeInstallRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.version).toBe("1.2.0");
    expect(mocks.installUpdate).toHaveBeenCalled();
    expect(mocks.notifyAppUpdateStartedInApp).toHaveBeenCalledWith({
      targetVersion: "1.2.0",
    });

    const progressCallback = mocks.installUpdate.mock.calls[0][1];
    progressCallback({
      status: "complete",
      progress: 100,
      message: "Update complete!",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.notifyAppUpdateProgressInApp).toHaveBeenCalledWith(
      { status: "complete", progress: 100, message: "Update complete!" },
      { targetVersion: "1.2.0" }
    );
  });

  it("starts repair mode without requiring a newer update", async () => {
    const response = await POST(
      makeInstallRequest({ repair: true, targetVersion: "1.2.0" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, repair: true, version: "1.2.0" });
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.installUpdate).not.toHaveBeenCalled();
    expect(mocks.repairInstalledUpdate).toHaveBeenCalledWith(
      "1.2.0",
      expect.any(Function)
    );
    expect(mocks.notifyAppUpdateStartedInApp).toHaveBeenCalledWith({
      targetVersion: "1.2.0",
      repair: true,
    });
    expect(mocks.writeUpdateStatus).toHaveBeenCalledWith(
      { status: "checking", progress: 0, message: "Preparing update repair..." },
      { targetVersion: "1.2.0" }
    );

    const progressCallback = mocks.repairInstalledUpdate.mock.calls[0][1];
    progressCallback({
      status: "error",
      progress: 0,
      message: "Update repair failed",
      error: "Prisma failed",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.notifyAppUpdateProgressInApp).toHaveBeenCalledWith(
      {
        status: "error",
        progress: 0,
        message: "Update repair failed",
        error: "Prisma failed",
      },
      { targetVersion: "1.2.0", repair: true }
    );
  });

  it("uses installed version as repair target when not provided", async () => {
    const response = await POST(makeInstallRequest({ repair: true }));

    expect(response.status).toBe(200);
    expect(mocks.getInstalledVersion).toHaveBeenCalled();
    expect(mocks.repairInstalledUpdate).toHaveBeenCalledWith(
      "1.2.0",
      expect.any(Function)
    );
  });

  it("returns 409 when update already in progress", async () => {
    mocks.isUpdateInProgress.mockResolvedValue(true);

    const response = await POST(makeInstallRequest());

    expect(response.status).toBe(409);
  });

  it("returns update check errors instead of reporting no update", async () => {
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: false,
      latest: null,
      error: "Failed to check for updates: network down",
    });

    const response = await POST(makeInstallRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({ error: "Failed to check for updates: network down" });
    expect(mocks.releaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mocks.installUpdate).not.toHaveBeenCalled();
  });
});
