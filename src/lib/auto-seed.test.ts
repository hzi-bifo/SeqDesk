import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing
const mockDb = {
  siteSettings: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  user: {
    upsert: vi.fn(),
  },
  orderFormConfig: {
    upsert: vi.fn(),
  },
};

vi.mock("./db", () => ({ db: mockDb }));

// Use a fresh import for each test to reset the module-level seedingInProgress flag
let autoSeedIfNeeded: typeof import("./auto-seed").autoSeedIfNeeded;

beforeEach(async () => {
  vi.resetAllMocks();
  // Reset the module to clear the seedingInProgress flag
  vi.resetModules();
  vi.mock("./db", () => ({ db: mockDb }));
  const mod = await import("./auto-seed");
  autoSeedIfNeeded = mod.autoSeedIfNeeded;
});

describe("autoSeedIfNeeded", () => {
  it("returns seeded: false when site settings already exist", async () => {
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });

    const result = await autoSeedIfNeeded();

    expect(result).toEqual({ seeded: false });
    expect(mockDb.user.upsert).not.toHaveBeenCalled();
  });

  it("seeds database when no site settings exist", async () => {
    mockDb.siteSettings.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockResolvedValue({});
    mockDb.siteSettings.upsert.mockResolvedValue({});
    mockDb.orderFormConfig.upsert.mockResolvedValue({});
    mockDb.siteSettings.update.mockResolvedValue({});

    const result = await autoSeedIfNeeded();

    expect(result).toEqual({ seeded: true });
    // Should create admin and test user
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "admin@example.com" },
        create: expect.objectContaining({
          role: "FACILITY_ADMIN",
        }),
      })
    );
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "user@example.com" },
        create: expect.objectContaining({
          role: "RESEARCHER",
        }),
      })
    );
    // Should create site settings
    expect(mockDb.siteSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        create: expect.objectContaining({
          siteName: "SeqDesk",
        }),
      })
    );
    // Should create order form config
    expect(mockDb.orderFormConfig.upsert).toHaveBeenCalledOnce();
    // Should update site settings with study form config
    expect(mockDb.siteSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        data: expect.objectContaining({
          extraSettings: expect.any(String),
        }),
      })
    );
  });

  it("returns error when database operation fails", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue(
      new Error("Connection refused")
    );

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  it("stringifies non-Error exceptions", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue("raw string error");

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(false);
    expect(result.error).toBe("raw string error");
  });

  it("prevents concurrent seeding calls", async () => {
    // First call: simulate slow seeding by making user.upsert block
    let resolveUpsert!: () => void;
    const upsertPromise = new Promise<void>((r) => (resolveUpsert = r));

    mockDb.siteSettings.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockImplementation(async () => {
      await upsertPromise;
      return {};
    });
    mockDb.siteSettings.upsert.mockResolvedValue({});
    mockDb.orderFormConfig.upsert.mockResolvedValue({});
    mockDb.siteSettings.update.mockResolvedValue({});

    const first = autoSeedIfNeeded();

    // Give the first call time to pass the findUnique check and set seedingInProgress
    await new Promise((r) => setTimeout(r, 10));

    // Second call should return immediately since seeding is in progress
    const secondResult = await autoSeedIfNeeded();
    expect(secondResult).toEqual({
      seeded: false,
      error: "Seeding already in progress",
    });

    // Let the first call proceed
    resolveUpsert();
    const firstResult = await first;
    expect(firstResult.seeded).toBe(true);
  });

  it("resets seedingInProgress flag after an error", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue(new Error("fail"));

    const result1 = await autoSeedIfNeeded();
    expect(result1.seeded).toBe(false);

    // Second call should not say "seeding already in progress"
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    const result2 = await autoSeedIfNeeded();
    expect(result2).toEqual({ seeded: false });
  });
});
