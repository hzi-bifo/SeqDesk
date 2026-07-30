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
  resolveDataBasePathFromStoredValue: vi.fn(),
  inspectDataStoragePath: vi.fn(),
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

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue: mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("@/lib/files/data-storage-path-validation", () => ({
  inspectDataStoragePath: mocks.inspectDataStoragePath,
}));

import { GET, PUT } from "./route";

describe("GET /api/admin/settings/sequencing-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "",
      source: "none",
      isImplicit: false,
    });
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns default config when no settings exist", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dataBasePath).toBe("");
    expect(body.config).toEqual(
      expect.objectContaining({
        allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
        scanDepth: 2,
        allowSingleEnd: true,
        autoAssign: false,
      })
    );
  });

  it("returns stored config merged with defaults", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/data/sequencing",
      extraSettings: JSON.stringify({
        sequencingFiles: {
          scanDepth: 5,
          autoAssign: true,
        },
      }),
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/data/sequencing",
      source: "database",
      isImplicit: false,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dataBasePath).toBe("/data/sequencing");
    expect(body.config.scanDepth).toBe(5);
    expect(body.config.autoAssign).toBe(true);
    // allowSingleEnd is always forced to true
    expect(body.config.allowSingleEnd).toBe(true);
  });

  it("handles invalid JSON in extraSettings gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: null,
      extraSettings: "not-valid-json",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Falls back to defaults
    expect(body.config.scanDepth).toBe(2);
  });
});

describe("PUT /api/admin/settings/sequencing-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "",
      source: "none",
      isImplicit: false,
    });
    mocks.inspectDataStoragePath.mockImplementation(async (value: string) => ({
      valid: true,
      configuredPath: value.trim(),
      resolvedPath: value.trim(),
      readable: true,
      writable: true,
    }));
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "/data" }),
      })
    );

    expect(response.status).toBe(401);
  });

  it("updates dataBasePath and config", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataBasePath: "/data/sequencing",
          config: { scanDepth: 3 },
        }),
      })
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertArgs.update.dataBasePath).toBe("/data/sequencing");
    const extraSettings = JSON.parse(upsertArgs.update.extraSettings);
    expect(extraSettings.sequencingFiles.scanDepth).toBe(3);
    // allowSingleEnd is always forced to true
    expect(extraSettings.sequencingFiles.allowSingleEnd).toBe(true);
  });

  it("trims empty dataBasePath to null", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "  " }),
      })
    );

    expect(response.status).toBe(200);
    const upsertArgs = mocks.db.siteSettings.upsert.mock.calls[0][0];
    expect(upsertArgs.update.dataBasePath).toBeNull();
  });

  it("rejects an invalid data storage path before writing settings", async () => {
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: false,
      readable: false,
      writable: false,
      error: "Data storage must use an absolute path",
    });

    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "relative/data" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-string data storage path before inspecting or writing it", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: { path: "/data" } }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.inspectDataStoragePath).not.toHaveBeenCalled();
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("does not claim to replace a file-managed path with a shadowed database value", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/old/database/path",
      extraSettings: null,
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/managed/from-settings",
      source: "file",
      isImplicit: false,
    });

    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "/new/storage" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("data-storage-path-overridden");
    expect(body.error).toContain("seqdesk storage configure");
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("allows saving the normalized active file-managed path", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/old/database/path",
      extraSettings: null,
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/managed/from-settings/",
      source: "file",
      isImplicit: false,
    });
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: true,
      configuredPath: "/managed/from-settings",
      resolvedPath: "/managed/from-settings",
      readable: true,
      writable: true,
    });

    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "/managed/from-settings/" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalled();
  });

  it("returns 500 when database upsert fails", async () => {
    mocks.db.siteSettings.upsert.mockRejectedValue(new Error("DB error"));

    const response = await PUT(
      new NextRequest("http://localhost/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataBasePath: "/data" }),
      })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to save settings");
  });
});
