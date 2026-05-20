import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getCurrentVersion: vi.fn(),
  getInstalledVersion: vi.fn(),
  readUpdateStatus: vi.fn(),
  readUpdateState: vi.fn(),
  writeUpdateStatus: vi.fn(),
  clearUpdateStatus: vi.fn(),
  releaseUpdateLock: vi.fn(),
  notifyAppUpdateProgressInApp: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/updater", () => ({
  getCurrentVersion: mocks.getCurrentVersion,
  getInstalledVersion: mocks.getInstalledVersion,
}));

vi.mock("@/lib/updater/status", () => ({
  readUpdateState: mocks.readUpdateState,
  readUpdateStatus: mocks.readUpdateStatus,
  writeUpdateStatus: mocks.writeUpdateStatus,
  clearUpdateStatus: mocks.clearUpdateStatus,
  releaseUpdateLock: mocks.releaseUpdateLock,
}));

vi.mock("@/lib/notifications/in-app", () => ({
  notifyAppUpdateProgressInApp: mocks.notifyAppUpdateProgressInApp,
}));

import { DELETE, GET } from "./route";

describe("GET /api/admin/updates/progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.getCurrentVersion.mockReturnValue("1.0.0");
    mocks.getInstalledVersion.mockResolvedValue("1.0.0");
    mocks.readUpdateStatus.mockResolvedValue(null);
    mocks.readUpdateState.mockResolvedValue(null);
    mocks.writeUpdateStatus.mockResolvedValue(undefined);
    mocks.clearUpdateStatus.mockResolvedValue(undefined);
    mocks.releaseUpdateLock.mockResolvedValue(undefined);
    mocks.notifyAppUpdateProgressInApp.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns null status when no update is in progress", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: null,
      state: null,
      runningVersion: "1.0.0",
      installedVersion: "1.0.0",
    });
  });

  it("returns current status when update is in progress", async () => {
    mocks.readUpdateStatus.mockResolvedValue({
      status: "downloading",
      progress: 50,
      message: "Downloading update...",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toEqual({
      status: "downloading",
      progress: 50,
      message: "Downloading update...",
      targetVersion: "2.0.0",
    });
    expect(data.state).toBeNull();
  });

  it("returns recorded update recovery state", async () => {
    mocks.readUpdateState.mockResolvedValue({
      phase: "error",
      startedAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:01:00.000Z",
      previousRelease: "/srv/seqdesk/releases/1.1.80",
      targetRelease: "/srv/seqdesk/releases/1.2.0",
      activeRelease: "/srv/seqdesk/releases/1.1.80",
      targetVersion: "1.2.0",
      error: "migration failed",
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.state).toEqual(
      expect.objectContaining({
        phase: "error",
        previousRelease: "/srv/seqdesk/releases/1.1.80",
        targetVersion: "1.2.0",
      })
    );
  });

  it("marks update complete when target matches running and installed versions", async () => {
    mocks.getCurrentVersion.mockReturnValue("2.0.0");
    mocks.getInstalledVersion.mockResolvedValue("2.0.0");
    mocks.readUpdateStatus.mockResolvedValue({
      status: "installing",
      progress: 90,
      message: "Installing...",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status.status).toBe("complete");
    expect(data.state).toBeNull();
    expect(data.status.progress).toBe(100);
    expect(data.status.message).toBe("Update complete.");
    expect(mocks.writeUpdateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complete",
        progress: 100,
        message: "Update complete.",
      }),
      { targetVersion: "2.0.0" },
    );
    expect(mocks.notifyAppUpdateProgressInApp).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complete",
        progress: 100,
        message: "Update complete.",
      }),
      { targetVersion: "2.0.0" }
    );
  });

  it("does not mark complete if status is already error", async () => {
    mocks.getCurrentVersion.mockReturnValue("2.0.0");
    mocks.getInstalledVersion.mockResolvedValue("2.0.0");
    mocks.readUpdateStatus.mockResolvedValue({
      status: "error",
      progress: 0,
      message: "Something failed",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    expect(data.status.status).toBe("error");
    expect(mocks.writeUpdateStatus).not.toHaveBeenCalled();
  });

  it("does not mark complete if status is already complete (first pass)", async () => {
    mocks.getCurrentVersion.mockReturnValue("2.0.0");
    mocks.getInstalledVersion.mockResolvedValue("2.0.0");
    mocks.readUpdateStatus.mockResolvedValue({
      status: "complete",
      progress: 100,
      message: "Update complete.",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    // Should clear the status since complete and versions match
    expect(data.status).toBeNull();
    expect(mocks.clearUpdateStatus).toHaveBeenCalled();
  });

  it("clears status when complete and all versions match", async () => {
    mocks.getCurrentVersion.mockReturnValue("2.0.0");
    mocks.getInstalledVersion.mockResolvedValue("2.0.0");
    mocks.readUpdateStatus.mockResolvedValue({
      status: "complete",
      progress: 100,
      message: "Update complete.",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBeNull();
    expect(mocks.clearUpdateStatus).toHaveBeenCalled();
  });

  it("does not clear status when complete but versions do not match", async () => {
    mocks.getCurrentVersion.mockReturnValue("1.0.0");
    mocks.getInstalledVersion.mockResolvedValue("2.0.0");
    mocks.readUpdateStatus.mockResolvedValue({
      status: "complete",
      progress: 100,
      message: "Update complete.",
      targetVersion: "2.0.0",
    });

    const response = await GET();
    const data = await response.json();

    // running (1.0.0) !== target (2.0.0), so won't clear
    expect(mocks.clearUpdateStatus).not.toHaveBeenCalled();
    expect(data.status).toEqual({
      status: "complete",
      progress: 100,
      message: "Update complete.",
      targetVersion: "2.0.0",
    });
  });

  it("clears failed update status and releases lock", async () => {
    mocks.readUpdateStatus.mockResolvedValue({
      status: "error",
      progress: 0,
      message: "Update failed",
      error: "Prisma failed",
      targetVersion: "2.0.0",
    });

    const response = await DELETE();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mocks.clearUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.releaseUpdateLock).toHaveBeenCalledTimes(1);
  });

  it("rejects clearing status while an update is in progress", async () => {
    mocks.readUpdateStatus.mockResolvedValue({
      status: "downloading",
      progress: 20,
      message: "Downloading",
      targetVersion: "2.0.0",
    });

    const response = await DELETE();
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: "Cannot clear update status while an update is in progress",
    });
    expect(mocks.clearUpdateStatus).not.toHaveBeenCalled();
    expect(mocks.releaseUpdateLock).not.toHaveBeenCalled();
  });
});
