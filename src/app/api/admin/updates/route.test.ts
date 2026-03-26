import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  checkForUpdates: vi.fn(),
  getCurrentVersion: vi.fn(),
  getInstalledVersion: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/updater", () => ({
  checkForUpdates: mocks.checkForUpdates,
  getCurrentVersion: mocks.getCurrentVersion,
  getInstalledVersion: mocks.getInstalledVersion,
}));

import { GET } from "./route";

describe("GET /api/admin/updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.getCurrentVersion.mockReturnValue("1.0.0");
    mocks.getInstalledVersion.mockResolvedValue("1.0.0");
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: false,
      latest: { version: "1.0.0" },
      currentDatabaseProvider: "sqlite",
      databaseCompatible: true,
      databaseCompatibilityError: null,
      error: null,
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));

    expect(response.status).toBe(401);
  });

  it("returns update status when no update available", async () => {
    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      currentVersion: "1.0.0",
      runningVersion: "1.0.0",
      installedVersion: "1.0.0",
      restartRequired: false,
      updateAvailable: false,
      latest: { version: "1.0.0" },
      currentDatabaseProvider: "sqlite",
      databaseCompatible: true,
      databaseCompatibilityError: null,
      error: null,
    });
  });

  it("returns update available when newer version exists", async () => {
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latest: { version: "2.0.0", downloadUrl: "https://example.com/update.tar.gz" },
      currentDatabaseProvider: "sqlite",
      databaseCompatible: true,
      databaseCompatibilityError: null,
      error: null,
    });

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updateAvailable).toBe(true);
    expect(data.latest.version).toBe("2.0.0");
  });

  it("indicates restart required when installed differs from running", async () => {
    mocks.getInstalledVersion.mockResolvedValue("1.1.0");

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.restartRequired).toBe(true);
    expect(data.runningVersion).toBe("1.0.0");
    expect(data.installedVersion).toBe("1.1.0");
  });

  it("passes force parameter to checkForUpdates", async () => {
    await GET(new Request("http://localhost:3000/api/admin/updates?force=true"));

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
  });

  it("does not force when force param is absent", async () => {
    await GET(new Request("http://localhost:3000/api/admin/updates"));

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(false);
  });

  it("returns 500 when checkForUpdates throws", async () => {
    mocks.checkForUpdates.mockRejectedValue(new Error("Network error"));

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to check for updates" });
  });

  it("includes database compatibility info", async () => {
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latest: { version: "2.0.0" },
      currentDatabaseProvider: "sqlite",
      databaseCompatible: false,
      databaseCompatibilityError: "Version requires PostgreSQL",
      error: null,
    });

    const response = await GET(new Request("http://localhost:3000/api/admin/updates"));
    const data = await response.json();

    expect(data.databaseCompatible).toBe(false);
    expect(data.databaseCompatibilityError).toBe("Version requires PostgreSQL");
  });
});
