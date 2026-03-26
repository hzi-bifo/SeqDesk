import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  getDefaultTechSyncUrl: vi.fn(),
  loadDefaultTechConfig: vi.fn(),
  parseTechConfig: vi.fn(),
  withResolvedTechAssetUrls: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/sequencing-tech/config", () => ({
  getDefaultTechSyncUrl: mocks.getDefaultTechSyncUrl,
  loadDefaultTechConfig: mocks.loadDefaultTechConfig,
  parseTechConfig: mocks.parseTechConfig,
  withResolvedTechAssetUrls: mocks.withResolvedTechAssetUrls,
}));

// Mock global fetch for remote config fetching
const originalFetch = globalThis.fetch;

import { GET, PUT, POST } from "./route";

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const researcherSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

const defaultConfig = {
  technologies: [{ id: "nanopore", name: "Nanopore", available: true }],
  devices: [],
  flowCells: [],
  kits: [],
  software: [],
  barcodeSchemes: [],
  barcodeSets: [],
  version: 1,
  syncUrl: "https://seqdesk.com/api/sequencing-technologies",
};

describe("GET /api/admin/sequencing-tech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
    mocks.getDefaultTechSyncUrl.mockReturnValue(
      "https://seqdesk.com/api/sequencing-technologies"
    );
    mocks.loadDefaultTechConfig.mockReturnValue(defaultConfig);
    mocks.withResolvedTechAssetUrls.mockImplementation((config) => config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when user is not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns stored config for authenticated user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    const storedConfig = { ...defaultConfig, version: 2 };
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: JSON.stringify(storedConfig),
      }),
    });
    mocks.parseTechConfig.mockReturnValue(storedConfig);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toBeDefined();
    expect(mocks.parseTechConfig).toHaveBeenCalled();
  });

  it("auto-syncs from remote when no stored config exists", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => defaultConfig,
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});
    mocks.parseTechConfig.mockReturnValue(defaultConfig);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("falls back to parsed defaults when remote sync fails and no stored config", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.fetch.mockRejectedValue(new Error("Network error"));
    mocks.parseTechConfig.mockReturnValue(defaultConfig);

    const response = await GET();

    expect(response.status).toBe(200);
    // parseTechConfig is called with null stored config, returns defaults
    expect(mocks.parseTechConfig).toHaveBeenCalled();
  });

  it("returns 500 when database throws unexpectedly", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("DB down"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to fetch config");
  });
});

describe("PUT /api/admin/sequencing-tech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultTechSyncUrl.mockReturnValue(
      "https://seqdesk.com/api/sequencing-technologies"
    );
    mocks.withResolvedTechAssetUrls.mockImplementation((config) => config);
  });

  it("returns 401 for non-admin user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: defaultConfig }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when config is missing", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Config is required");
  });

  it("returns 400 when technologies is not an array", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { technologies: "not-array" } }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Technologies must be an array");
  });

  it("returns 400 when syncUrl is invalid", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: { technologies: [], syncUrl: "ftp://invalid" },
        }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("syncUrl must be a valid");
  });

  it("saves config and returns updated config for admin", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: {
            ...defaultConfig,
            syncUrl: "https://example.com/api/tech",
          },
        }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toBeDefined();
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/sequencing-tech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
    mocks.getDefaultTechSyncUrl.mockReturnValue(
      "https://seqdesk.com/api/sequencing-technologies"
    );
    mocks.loadDefaultTechConfig.mockReturnValue(defaultConfig);
    mocks.parseTechConfig.mockReturnValue(defaultConfig);
    mocks.withResolvedTechAssetUrls.mockImplementation((config) => config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 for non-admin user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for unknown action", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unknown" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown action");
  });

  it("returns 400 when syncUrl is invalid", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset", syncUrl: "not-a-url" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("syncUrl must be a valid");
  });

  it("resets config to remote defaults on reset action", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        technologies: [{ id: "nanopore", name: "Nanopore" }],
        devices: [],
        flowCells: [],
        kits: [],
        software: [],
        barcodeSchemes: [],
        barcodeSets: [],
        version: 3,
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toBeDefined();
    expect(body.message).toContain("registry defaults");
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("check-updates returns no updates when versions match", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: JSON.stringify(defaultConfig),
      }),
    });
    mocks.parseTechConfig.mockReturnValue(defaultConfig);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        technologies: [{ id: "nanopore", name: "Nanopore", available: true }],
        devices: [],
        flowCells: [],
        kits: [],
        software: [],
        barcodeSchemes: [],
        barcodeSets: [],
        version: 1,
      }),
    });

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(false);
    expect(body.message).toContain("up to date");
  });

  it("check-updates merges and saves when remote version is higher", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: JSON.stringify(defaultConfig),
      }),
    });
    mocks.parseTechConfig.mockReturnValue(defaultConfig);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        technologies: [
          { id: "nanopore", name: "Nanopore", available: true },
          { id: "illumina", name: "Illumina", available: true },
        ],
        devices: [],
        flowCells: [],
        kits: [],
        software: [],
        barcodeSchemes: [],
        barcodeSets: [],
        version: 5,
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(true);
    expect(body.updatedVersion).toBe(5);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when POST throws unexpectedly", async () => {
    mocks.getServerSession.mockRejectedValue(new Error("session crash"));

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to process");
  });

  it("check-updates updates syncUrl even when versions match if syncUrl changed", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const localConfig = {
      ...defaultConfig,
      syncUrl: "https://old-server.com/api/tech",
    };
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: JSON.stringify(localConfig),
      }),
    });
    mocks.parseTechConfig.mockReturnValue(localConfig);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        technologies: [{ id: "nanopore", name: "Nanopore", available: true }],
        devices: [],
        flowCells: [],
        kits: [],
        software: [],
        barcodeSchemes: [],
        barcodeSets: [],
        version: 1,
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "check-updates",
          syncUrl: "https://new-server.com/api/tech",
        }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(false);
    expect(body.message).toContain("Registry source updated");
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("check-updates detects missing remote items and merges", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const localConfig = {
      ...defaultConfig,
      technologies: [{ id: "nanopore", name: "Nanopore", available: true }],
      devices: [],
      flowCells: [],
      kits: [],
      software: [],
      barcodeSchemes: [],
      barcodeSets: [],
    };
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingTechConfig: JSON.stringify(localConfig),
      }),
    });
    mocks.parseTechConfig.mockReturnValue(localConfig);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        technologies: [
          { id: "nanopore", name: "Nanopore", available: true },
          { id: "illumina", name: "Illumina", available: true },
        ],
        devices: [{ id: "minion", name: "MinION" }],
        flowCells: [],
        kits: [],
        software: [],
        barcodeSchemes: [],
        barcodeSets: [],
        version: 1, // same version, but has missing items
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(true);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when PUT throws unexpectedly", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("DB down"));

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: defaultConfig }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to update config");
  });

  it("PUT saves with existing extraSettings", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ otherKey: "preserved" }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: defaultConfig }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(200);
    const upsertCall = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const savedExtra = JSON.parse(upsertCall.update.extraSettings);
    expect(savedExtra.otherKey).toBe("preserved");
    expect(savedExtra.sequencingTechConfig).toBeDefined();
  });

  it("GET handles malformed extraSettings JSON by auto-syncing", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: "invalid-json{",
    });
    // When extraSettings is malformed, storedConfig is null, so it auto-syncs
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => defaultConfig,
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});
    mocks.parseTechConfig.mockReturnValue(defaultConfig);

    const response = await GET();
    expect(response.status).toBe(200);
    // Should attempt remote auto-sync since no stored config
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("check-updates returns error info when fetch fails", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.parseTechConfig.mockReturnValue(defaultConfig);
    mocks.fetch.mockRejectedValue(new Error("Network fail"));

    const request = new NextRequest(
      "http://localhost/api/admin/sequencing-tech",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(false);
    expect(body.error).toBe(true);
    expect(body.message).toContain("Failed to check");
  });
});

// Need afterEach import
import { afterEach } from "vitest";
