import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  getGemmaMetaxPathExampleStatus: vi.fn(),
  seedGemmaMetaxPathExampleDataset: vi.fn(),
  resolveDataBasePathFromStoredValue: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue: mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("@/lib/seed/gemma-metaxpath-example", () => ({
  getGemmaMetaxPathExampleStatus: mocks.getGemmaMetaxPathExampleStatus,
  seedGemmaMetaxPathExampleDataset: mocks.seedGemmaMetaxPathExampleDataset,
}));

import { GET, POST } from "./route";

const seededStatus = {
  seeded: true,
  orderNumber: "DEV-GEMMA-ONT-001",
  orderId: "order-1",
  orderStatus: "SUBMITTED",
  studyId: "study-1",
  samplesCount: 5,
  readsCount: 5,
  sourceUrl:
    "https://research.bifo.helmholtz-hzi.de/downloads/genomenet/gemma_nanopore_metaxpath_5sample_seqdesk.tar.gz",
  sha256: "a05363abca66b4012caf9953a4a5beb6062e668334860efb4276718e8143e2ad",
};

describe("Gemma MetaxPath example dataset seed API", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/tmp",
    });
    mocks.resolveDataBasePathFromStoredValue.mockImplementation(
      (value: string | null | undefined) => ({
        dataBasePath: value?.trim() || null,
        source: value ? "database" : "none",
        isImplicit: false,
      })
    );
    mocks.getGemmaMetaxPathExampleStatus.mockResolvedValue(seededStatus);
    mocks.seedGemmaMetaxPathExampleDataset.mockResolvedValue({
      skipped: false,
      seeded: 1,
      results: [{ fixtureId: "gemma-nanopore-metaxpath-5sample" }],
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns the current dataset status", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(seededStatus);
    expect(mocks.getGemmaMetaxPathExampleStatus).toHaveBeenCalledTimes(1);
  });

  it("requires a facility admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("seeds the dataset and returns the refreshed status", async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.seedGemmaMetaxPathExampleDataset).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      success: true,
      seededFixtures: 1,
      orderNumber: "DEV-GEMMA-ONT-001",
      samplesCount: 5,
      readsCount: 5,
    });
  });

  it("rejects seeding when the data base path is missing", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: null,
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Data base path not configured");
    expect(mocks.seedGemmaMetaxPathExampleDataset).not.toHaveBeenCalled();
  });

  it("surfaces seeding failures", async () => {
    mocks.seedGemmaMetaxPathExampleDataset.mockRejectedValue(
      new Error("Fixture SHA256 mismatch")
    );

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Fixture SHA256 mismatch");
  });
});
