import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {},
  getActiveMixsConfig: vi.fn(),
  saveActiveMixsConfig: vi.fn(),
  snapshotMixsConfig: vi.fn(),
  getDefaultMixsSyncUrl: vi.fn(),
  normalizeSyncUrl: vi.fn(),
  resolveSyncUrl: vi.fn(),
  parseMixsConfig: vi.fn(),
  normalizeMixsConfig: vi.fn(),
  loadBaselineConfig: vi.fn(),
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

vi.mock("@/lib/mixs/config", () => ({
  getActiveMixsConfig: mocks.getActiveMixsConfig,
  saveActiveMixsConfig: mocks.saveActiveMixsConfig,
  snapshotMixsConfig: mocks.snapshotMixsConfig,
  getDefaultMixsSyncUrl: mocks.getDefaultMixsSyncUrl,
  normalizeSyncUrl: mocks.normalizeSyncUrl,
  resolveSyncUrl: mocks.resolveSyncUrl,
  parseMixsConfig: mocks.parseMixsConfig,
  normalizeMixsConfig: mocks.normalizeMixsConfig,
  loadBaselineConfig: mocks.loadBaselineConfig,
}));

const originalFetch = globalThis.fetch;

import { GET, PUT, POST } from "./route";

const DEFAULT_SYNC_URL = "https://www.seqdesk.com/api/registry/mixs";

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const researcherSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

const field = (name: string, required = false): Record<string, unknown> => ({
  type: "text",
  label: name,
  name,
  required,
  visible: true,
});

const checklist = (
  accession: string,
  name: string,
  fields: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  name,
  description: "desc",
  version: "1",
  source: "ENA",
  category: "mixs",
  accession,
  fields,
  available: true,
  ...extra,
});

const baseConfig = {
  version: 1,
  checklists: [checklist("GSC-A", "Checklist A", [field("f1")])],
  deprecated: [],
  syncUrl: DEFAULT_SYNC_URL,
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mocks.fetch;
  mocks.getDefaultMixsSyncUrl.mockReturnValue(DEFAULT_SYNC_URL);
  mocks.normalizeSyncUrl.mockImplementation((value: unknown) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return null;
      return trimmed;
    } catch {
      return null;
    }
  });
  mocks.resolveSyncUrl.mockImplementation(
    (config?: { syncUrl?: string } | null, override?: unknown) => {
      const o = mocks.normalizeSyncUrl(override);
      if (o) return o;
      const c = mocks.normalizeSyncUrl(config?.syncUrl);
      if (c) return c;
      return DEFAULT_SYNC_URL;
    }
  );
  mocks.loadBaselineConfig.mockReturnValue(baseConfig);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/admin/mixs-checklists", () => {
  it("returns 401 when user is not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns active config for any authenticated user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.getActiveMixsConfig.mockResolvedValue(baseConfig);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toBeDefined();
    expect(body.config.syncUrl).toBe(DEFAULT_SYNC_URL);
    expect(mocks.getActiveMixsConfig).toHaveBeenCalled();
  });

  it("returns 500 when getActiveMixsConfig throws", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.getActiveMixsConfig.mockRejectedValue(new Error("DB down"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to fetch config");
  });
});

describe("PUT /api/admin/mixs-checklists", () => {
  const makeRequest = (payload: unknown) =>
    new NextRequest("http://localhost/api/admin/mixs-checklists", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  it("returns 401 for non-admin user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const response = await PUT(makeRequest({ config: baseConfig }));
    expect(response.status).toBe(401);
  });

  it("returns 400 when config is missing", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PUT(makeRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Config is required");
  });

  it("returns 400 when checklists is not an array", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PUT(
      makeRequest({ config: { checklists: "nope" } })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Checklists must be an array");
  });

  it("returns 400 when syncUrl is invalid", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await PUT(
      makeRequest({ config: { checklists: [], syncUrl: "ftp://nope" } })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("syncUrl must be a valid");
  });

  it("saves config and returns it for admin", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.saveActiveMixsConfig.mockResolvedValue(undefined);

    const config = {
      ...baseConfig,
      checklists: [
        checklist("GSC-A", "Checklist A", [field("f1")], {
          available: false,
          localOverrides: true,
        }),
      ],
      syncUrl: "https://example.com/registry",
    };

    const response = await PUT(makeRequest({ config }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toBeDefined();
    expect(mocks.saveActiveMixsConfig).toHaveBeenCalledTimes(1);
    const saved = mocks.saveActiveMixsConfig.mock.calls[0][1];
    expect(saved.checklists[0].available).toBe(false);
    expect(saved.checklists[0].localOverrides).toBe(true);
  });

  it("returns 500 when save throws", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.saveActiveMixsConfig.mockRejectedValue(new Error("DB down"));

    const response = await PUT(makeRequest({ config: baseConfig }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to update config");
  });
});

describe("POST /api/admin/mixs-checklists", () => {
  const makeRequest = (payload: unknown) =>
    new NextRequest("http://localhost/api/admin/mixs-checklists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  it("returns 401 for non-admin user", async () => {
    mocks.getServerSession.mockResolvedValue(researcherSession);

    const response = await POST(makeRequest({ action: "reset" }));
    expect(response.status).toBe(401);
  });

  it("returns 400 for unknown action", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await POST(makeRequest({ action: "frobnicate" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown action");
  });

  it("returns 400 when syncUrl is invalid", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);

    const response = await POST(
      makeRequest({ action: "reset", syncUrl: "not-a-url" })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("syncUrl must be a valid");
  });

  it("reset saves baseline config", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getActiveMixsConfig.mockResolvedValue(baseConfig);
    mocks.saveActiveMixsConfig.mockResolvedValue(undefined);

    const response = await POST(makeRequest({ action: "reset" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toContain("baseline");
    expect(mocks.loadBaselineConfig).toHaveBeenCalled();
    expect(mocks.saveActiveMixsConfig).toHaveBeenCalledTimes(1);
    const saved = mocks.saveActiveMixsConfig.mock.calls[0][1];
    expect(saved.checklists).toEqual(baseConfig.checklists);
  });

  it("check-updates returns hasUpdates=false when versions match and no diffs", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getActiveMixsConfig.mockResolvedValue(baseConfig);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        checklists: [checklist("GSC-A", "Checklist A", [field("f1")])],
      }),
    });

    const response = await POST(makeRequest({ action: "check-updates" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(false);
    expect(body.message).toContain("up to date");
    expect(mocks.saveActiveMixsConfig).not.toHaveBeenCalled();
  });

  it("check-updates reports added/removed/changed without saving", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const current = {
      version: 1,
      checklists: [
        checklist("GSC-A", "Checklist A", [field("f1"), field("oldField")]),
        checklist("GSC-GONE", "Going Away", [field("g1")]),
      ],
      deprecated: [],
      syncUrl: DEFAULT_SYNC_URL,
    };
    mocks.getActiveMixsConfig.mockResolvedValue(current);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 2,
        checklists: [
          // GSC-A: drops oldField, adds newField (now required)
          checklist("GSC-A", "Checklist A", [
            field("f1"),
            field("newField", true),
          ]),
          // brand new checklist
          checklist("GSC-NEW", "New Checklist", [field("n1")]),
        ],
      }),
    });

    const response = await POST(makeRequest({ action: "check-updates" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(true);
    expect(body.remoteVersion).toBe(2);
    expect(body.added.map((a: { accession: string }) => a.accession)).toContain(
      "GSC-NEW"
    );
    expect(
      body.removed.map((r: { accession: string }) => r.accession)
    ).toContain("GSC-GONE");
    const changedA = body.changed.find(
      (c: { accession: string }) => c.accession === "GSC-A"
    );
    expect(changedA).toBeDefined();
    expect(changedA.newFields).toContain("newField");
    expect(changedA.removedFields).toContain("oldField");
    expect(changedA.newlyRequired).toContain("newField");
    expect(mocks.saveActiveMixsConfig).not.toHaveBeenCalled();
  });

  it("check-updates returns error info when fetch fails", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getActiveMixsConfig.mockResolvedValue(baseConfig);
    mocks.fetch.mockRejectedValue(new Error("network fail"));

    const response = await POST(makeRequest({ action: "check-updates" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasUpdates).toBe(false);
    expect(body.error).toBe(true);
    expect(body.message).toContain("Failed to check");
    expect(mocks.saveActiveMixsConfig).not.toHaveBeenCalled();
  });

  it("apply snapshots then saves, deprecates removed, and protects localOverrides", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    const current = {
      version: 1,
      checklists: [
        // locally overridden — must survive verbatim
        checklist("GSC-A", "Checklist A (local)", [field("local")], {
          available: false,
          localOverrides: true,
        }),
        // admin set available=false — choice must be preserved
        checklist("GSC-B", "Checklist B", [field("b1")], { available: false }),
        // removed upstream — must move to deprecated
        checklist("GSC-GONE", "Going Away", [field("g1")]),
      ],
      deprecated: [],
      syncUrl: DEFAULT_SYNC_URL,
    };
    mocks.getActiveMixsConfig.mockResolvedValue(current);
    mocks.snapshotMixsConfig.mockResolvedValue(undefined);
    mocks.saveActiveMixsConfig.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 2,
        lastUpdated: "2026-06-01",
        checklists: [
          checklist("GSC-A", "Checklist A (remote)", [field("remote")]),
          checklist("GSC-B", "Checklist B", [field("b1"), field("b2")], {
            available: true,
          }),
          checklist("GSC-NEW", "New Checklist", [field("n1")]),
        ],
      }),
    });

    const response = await POST(makeRequest({ action: "apply" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toBe(true);
    expect(body.config.version).toBe(2);

    // snapshot called before save, with outgoing config
    expect(mocks.snapshotMixsConfig).toHaveBeenCalledTimes(1);
    expect(mocks.snapshotMixsConfig.mock.calls[0][1]).toBe(current);
    expect(mocks.saveActiveMixsConfig).toHaveBeenCalledTimes(1);
    expect(
      mocks.snapshotMixsConfig.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.saveActiveMixsConfig.mock.invocationCallOrder[0]);

    const saved = mocks.saveActiveMixsConfig.mock.calls[0][1];
    const byAcc = Object.fromEntries(
      saved.checklists.map((c: { accession: string }) => [c.accession, c])
    );
    // localOverrides protected: keeps local name + fields
    expect(byAcc["GSC-A"].name).toBe("Checklist A (local)");
    expect(byAcc["GSC-A"].fields[0].name).toBe("local");
    // availability choice preserved
    expect(byAcc["GSC-B"].available).toBe(false);
    expect(byAcc["GSC-B"].fields.length).toBe(2);
    // new checklist included
    expect(byAcc["GSC-NEW"]).toBeDefined();
    // removed upstream moved to deprecated
    expect(saved.deprecated.map((d: { accession: string }) => d.accession)).toContain(
      "GSC-GONE"
    );
    expect(
      saved.deprecated.find(
        (d: { accession: string }) => d.accession === "GSC-GONE"
      ).deprecated
    ).toBe(true);
  });

  it("apply returns error info when fetch fails", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getActiveMixsConfig.mockResolvedValue(baseConfig);
    mocks.fetch.mockRejectedValue(new Error("network fail"));

    const response = await POST(makeRequest({ action: "apply" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toBe(false);
    expect(body.error).toBe(true);
    expect(mocks.saveActiveMixsConfig).not.toHaveBeenCalled();
  });

  it("returns 500 when POST throws unexpectedly", async () => {
    mocks.getServerSession.mockRejectedValue(new Error("session crash"));

    const response = await POST(makeRequest({ action: "reset" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to process");
  });
});
