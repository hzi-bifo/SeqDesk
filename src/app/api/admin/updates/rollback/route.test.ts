import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  rollbackInstalledUpdate: vi.fn(),
  acquireUpdateLock: vi.fn(),
  isUpdateInProgress: vi.fn(),
  readUpdateState: vi.fn(),
  releaseUpdateLock: vi.fn(),
  writeUpdateStatus: vi.fn(),
  notifyAppUpdateProgressInApp: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/updater/installer", () => ({
  rollbackInstalledUpdate: mocks.rollbackInstalledUpdate,
}));

vi.mock("@/lib/updater/status", () => ({
  acquireUpdateLock: mocks.acquireUpdateLock,
  isUpdateInProgress: mocks.isUpdateInProgress,
  readUpdateState: mocks.readUpdateState,
  releaseUpdateLock: mocks.releaseUpdateLock,
  writeUpdateStatus: mocks.writeUpdateStatus,
}));

vi.mock("@/lib/notifications/in-app", () => ({
  notifyAppUpdateProgressInApp: mocks.notifyAppUpdateProgressInApp,
}));

import { POST } from "./route";

describe("POST /api/admin/updates/rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.isUpdateInProgress.mockResolvedValue(false);
    mocks.acquireUpdateLock.mockResolvedValue(true);
    mocks.readUpdateState.mockResolvedValue({
      phase: "error",
      startedAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:01:00.000Z",
      previousRelease: "/srv/seqdesk/releases/1.1.80",
      targetRelease: "/srv/seqdesk/releases/1.2.0",
      activeRelease: "/srv/seqdesk/releases/1.2.0",
      targetVersion: "1.2.0",
    });
    mocks.writeUpdateStatus.mockResolvedValue(undefined);
    mocks.releaseUpdateLock.mockResolvedValue(undefined);
    mocks.rollbackInstalledUpdate.mockResolvedValue({
      fromRelease: "/srv/seqdesk/releases/1.2.0",
      toRelease: "/srv/seqdesk/releases/1.1.80",
    });
    mocks.notifyAppUpdateProgressInApp.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it("returns 409 when an update is in progress", async () => {
    mocks.isUpdateInProgress.mockResolvedValue(true);

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: "Update already in progress" });
    expect(mocks.acquireUpdateLock).not.toHaveBeenCalled();
  });

  it("returns 409 when no previous release is recorded", async () => {
    mocks.readUpdateState.mockResolvedValue({
      phase: "error",
      startedAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:01:00.000Z",
      targetRelease: "/srv/seqdesk/releases/1.2.0",
      activeRelease: "/srv/seqdesk/releases/1.2.0",
      targetVersion: "1.2.0",
    });

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: "No previous release is recorded for rollback" });
    expect(mocks.releaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mocks.rollbackInstalledUpdate).not.toHaveBeenCalled();
  });

  it("starts rollback and records progress", async () => {
    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, rollback: true });
    expect(mocks.writeUpdateStatus).toHaveBeenCalledWith(
      { status: "checking", progress: 0, message: "Preparing release rollback..." },
      { targetVersion: "1.2.0" }
    );
    expect(mocks.rollbackInstalledUpdate).toHaveBeenCalledWith(expect.any(Function));

    const progressCallback = mocks.rollbackInstalledUpdate.mock.calls[0][0];
    progressCallback({
      status: "complete",
      progress: 100,
      message: "Rollback complete!",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.notifyAppUpdateProgressInApp).toHaveBeenCalledWith(
      { status: "complete", progress: 100, message: "Rollback complete!" },
      { targetVersion: "1.2.0" }
    );
  });
});
