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
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public";
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  });

  it("exports uncached route settings", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("returns the database status without auto-seeding when already configured", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });

    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: true,
      phase: "ready",
      nextAction: {
        href: "/login",
      },
    });
    expect(mocks.autoSeedIfNeeded).not.toHaveBeenCalled();
  });

  it("re-checks status after a successful auto-seed", async () => {
    mocks.checkDatabaseStatus
      .mockResolvedValueOnce({
        exists: true,
        configured: false,
        reason: "not_seeded",
      })
      .mockResolvedValueOnce({
        exists: true,
        configured: true,
        reason: "configured",
      });
    mocks.autoSeedIfNeeded.mockResolvedValue({ seeded: true });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: true,
      phase: "ready",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces an auto-seed result error without re-checking", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
      reason: "not_seeded",
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: false,
      error: "Seeding already in progress",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: false,
      phase: "seeding",
      error: "Seeding already in progress",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("handles thrown auto-seed errors", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
      reason: "not_seeded",
    });
    mocks.autoSeedIfNeeded.mockRejectedValue(new Error("Automatic seeding failed hard"));

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: false,
      phase: "seed-failed",
      error: "Automatic seeding failed hard",
    });
  });
});
