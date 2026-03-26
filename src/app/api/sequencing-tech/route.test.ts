import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  parseTechConfig: vi.fn(),
  withResolvedTechAssetUrls: vi.fn(),
  getDefaultTechSyncUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/sequencing-tech/config", () => ({
  getDefaultTechSyncUrl: mocks.getDefaultTechSyncUrl.mockReturnValue(
    "https://seqdesk.com/api/registry/sequencing-tech"
  ),
  parseTechConfig: mocks.parseTechConfig,
  withResolvedTechAssetUrls: mocks.withResolvedTechAssetUrls,
}));

import { GET } from "./route";

const baseConfig = {
  technologies: [
    { id: "t1", name: "Illumina", available: true, comingSoon: false, order: 1 },
    { id: "t2", name: "Hidden", available: false, comingSoon: false, order: 2 },
  ],
  devices: [
    { id: "dev1", name: "MiSeq", available: true, comingSoon: false, order: 1 },
  ],
  flowCells: [],
  kits: [],
  software: [],
  barcodeSchemes: [],
  barcodeSets: [],
  syncUrl: "https://seqdesk.com/api/registry/sequencing-tech",
};

describe("GET /api/sequencing-tech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseTechConfig.mockReturnValue({
      technologies: [],
      devices: [],
      flowCells: [],
      kits: [],
      software: [],
      barcodeSchemes: [],
      barcodeSets: [],
      syncUrl: "",
    });
    mocks.withResolvedTechAssetUrls.mockReturnValue(baseConfig);
  });

  it("returns available technologies filtered and sorted", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    // Only the available, non-comingSoon technology should appear
    expect(body.technologies).toHaveLength(1);
    expect(body.technologies[0].id).toBe("t1");
    expect(body.devices).toHaveLength(1);
  });

  it("parses extraSettings from siteSettings", async () => {
    const configPayload = { custom: true };
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      id: "singleton",
      extraSettings: JSON.stringify({ sequencingTechConfig: configPayload }),
    });

    await GET();

    expect(mocks.parseTechConfig).toHaveBeenCalledWith(configPayload);
  });

  it("handles invalid JSON in extraSettings gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      id: "singleton",
      extraSettings: "not-json",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    // parseTechConfig called with null because extraSettings parse failed
    expect(mocks.parseTechConfig).toHaveBeenCalledWith(null);
  });

  it("returns 500 on db error", async () => {
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("db down"));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
