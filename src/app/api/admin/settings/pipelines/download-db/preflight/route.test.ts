import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getExecutionSettings: vi.fn(),
  buildPipelineDatabaseTargetPath: vi.fn(),
  getPipelineDatabaseDefinition: vi.fn(),
  fsStat: vi.fn(),
  fsAccess: vi.fn(),
  statfs: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  buildPipelineDatabaseTargetPath: mocks.buildPipelineDatabaseTargetPath,
  getPipelineDatabaseDefinition: mocks.getPipelineDatabaseDefinition,
}));

vi.mock("fs/promises", () => ({
  default: {
    stat: (...args: unknown[]) => mocks.fsStat(...args),
    access: (...args: unknown[]) => mocks.fsAccess(...args),
    // statfs is read off the fs module via a typeof check in the route.
    get statfs() {
      return mocks.statfs;
    },
  },
}));

import { POST } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };

function makeRequest(body?: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/admin/settings/pipelines/download-db/preflight",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
}

const database = {
  id: "core-nt",
  label: "Core NT",
  fileName: "core_nt.tar.gz",
  downloadUrl: "https://example.com/core_nt.tar.gz",
  configKey: "ntDbPath",
  sha256: "abc123",
};

describe("POST /api/admin/settings/pipelines/download-db/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getPipelineDatabaseDefinition.mockReturnValue(database);
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/data/runs",
      pipelineDatabaseDir: "",
    });
    mocks.buildPipelineDatabaseTargetPath.mockReturnValue(
      "/data/runs/metaxpath/core-nt/core_nt.tar.gz"
    );
    // HEAD request returns a content-length for expectedBytes.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "2000" },
      })
    );
    // statfs -> 10MB free by default.
    mocks.statfs.mockResolvedValue({ bsize: 1024, bavail: 10240 });
    mocks.fsAccess.mockResolvedValue(undefined);
    // No partial local file by default.
    mocks.fsStat.mockRejectedValue(new Error("ENOENT"));
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" }));

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(makeRequest({ databaseId: "core-nt" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Pipeline ID required" });
  });

  it("returns 400 when databaseId is missing", async () => {
    const response = await POST(makeRequest({ pipelineId: "metaxpath" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Database ID required" });
  });

  it("returns 404 when the database is not defined", async () => {
    mocks.getPipelineDatabaseDefinition.mockReturnValue(null);

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "nope" })
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("is not defined");
  });

  it("computes preflight numbers on the happy path", async () => {
    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pipelineId).toBe("metaxpath");
    expect(body.databaseId).toBe("core-nt");
    expect(body.sourceUrl).toBe(database.downloadUrl);
    expect(body.targetPath).toBe("/data/runs/metaxpath/core-nt/core_nt.tar.gz");
    expect(body.parentDir).toBe("/data/runs/metaxpath/core-nt");
    expect(body.expectedBytes).toBe(2000);
    expect(body.freeBytes).toBe(1024 * 10240);
    expect(body.partialBytes).toBe(0);
    expect(body.remainingBytes).toBe(2000);
    expect(body.sufficient).toBe(true);
    expect(body.hasSha256).toBe(true);
    expect(body.error).toBeNull();
  });

  it("subtracts a partial local download from the remaining bytes", async () => {
    mocks.fsStat.mockResolvedValue({ size: 500 });

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    const body = await response.json();
    expect(body.partialBytes).toBe(500);
    expect(body.remainingBytes).toBe(1500);
  });

  it("reports insufficient space when free bytes are below remaining", async () => {
    mocks.statfs.mockResolvedValue({ bsize: 1, bavail: 100 });

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    const body = await response.json();
    expect(body.freeBytes).toBe(100);
    expect(body.sufficient).toBe(false);
  });

  it("leaves sufficient null when the remote size is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } })
    );

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    const body = await response.json();
    expect(body.expectedBytes).toBeNull();
    expect(body.remainingBytes).toBeNull();
    expect(body.sufficient).toBeNull();
  });

  it("reports hasSha256 false when the definition has no checksum", async () => {
    mocks.getPipelineDatabaseDefinition.mockReturnValue({
      ...database,
      sha256: undefined,
    });

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    const body = await response.json();
    expect(body.hasSha256).toBe(false);
  });

  it("resolves an absolute custom target path", async () => {
    const response = await POST(
      makeRequest({
        pipelineId: "metaxpath",
        databaseId: "core-nt",
        targetPath: "/custom/db.tar.gz",
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.targetPath).toBe("/custom/db.tar.gz");
    expect(body.error).toBeNull();
    // Custom path bypasses the registry path builder.
    expect(mocks.buildPipelineDatabaseTargetPath).not.toHaveBeenCalled();
  });

  it("rejects a relative custom target path", async () => {
    const response = await POST(
      makeRequest({
        pipelineId: "metaxpath",
        databaseId: "core-nt",
        targetPath: "relative/db.tar.gz",
      })
    );

    const body = await response.json();
    expect(body.targetPath).toBeNull();
    expect(body.error).toContain("must be absolute");
  });

  it("rejects a custom target path that is a directory", async () => {
    const response = await POST(
      makeRequest({
        pipelineId: "metaxpath",
        databaseId: "core-nt",
        targetPath: "/custom/dir/",
      })
    );

    const body = await response.json();
    expect(body.targetPath).toBeNull();
    expect(body.error).toContain("file name");
  });

  it("reports a configuration error when pipelineRunDir is unusable", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/",
      pipelineDatabaseDir: "",
    });

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    const body = await response.json();
    expect(body.targetPath).toBeNull();
    expect(body.error).toContain("Pipeline run directory is not configured");
  });

  it("returns 500 when an unexpected error is thrown", async () => {
    mocks.getExecutionSettings.mockRejectedValue(new Error("settings boom"));

    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt" })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Preflight check failed");
    expect(body.details).toBe("settings boom");
  });
});
