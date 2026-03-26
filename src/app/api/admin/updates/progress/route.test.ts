import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getCurrentVersion: vi.fn(),
  getInstalledVersion: vi.fn(),
  readUpdateStatus: vi.fn(),
  writeUpdateStatus: vi.fn(),
  clearUpdateStatus: vi.fn(),
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
  readUpdateStatus: mocks.readUpdateStatus,
  writeUpdateStatus: mocks.writeUpdateStatus,
  clearUpdateStatus: mocks.clearUpdateStatus,
}));

import { GET } from "./route";

describe("GET /api/admin/updates/progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.getCurrentVersion.mockReturnValue("1.0.0");
    mocks.getInstalledVersion.mockResolvedValue("1.0.0");
    mocks.readUpdateStatus.mockResolvedValue(null);
    mocks.writeUpdateStatus.mockResolvedValue(undefined);
    mocks.clearUpdateStatus.mockResolvedValue(undefined);
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
});
