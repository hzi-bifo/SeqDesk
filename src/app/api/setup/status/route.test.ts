import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkDatabaseStatus: vi.fn(),
  autoSeedIfNeeded: vi.fn(),
}));

vi.mock("@/lib/db-status", () => ({
  checkDatabaseStatus: mocks.checkDatabaseStatus,
}));

vi.mock("@/lib/auto-seed", () => ({
  autoSeedIfNeeded: mocks.autoSeedIfNeeded,
}));

import { GET, dynamic, revalidate } from "./route";

describe("GET /api/setup/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports uncached route settings", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("returns the database status without auto-seeding when already configured", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
    });

    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      exists: true,
      configured: true,
    });
    expect(mocks.autoSeedIfNeeded).not.toHaveBeenCalled();
  });

  it("re-checks status after a successful auto-seed", async () => {
    mocks.checkDatabaseStatus
      .mockResolvedValueOnce({
        exists: true,
        configured: false,
      })
      .mockResolvedValueOnce({
        exists: true,
        configured: true,
      });
    mocks.autoSeedIfNeeded.mockResolvedValue({ seeded: true });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      exists: true,
      configured: true,
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces an auto-seed result error without re-checking", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: false,
      error: "Seeding already in progress",
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      exists: true,
      configured: false,
      error: "Seeding already in progress",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("handles thrown auto-seed errors", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
    });
    mocks.autoSeedIfNeeded.mockRejectedValue(new Error("Automatic seeding failed hard"));

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      exists: true,
      configured: false,
      error: "Automatic seeding failed hard",
    });
  });
});
