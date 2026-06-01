import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  getExecutionSettings: vi.fn(),
  getPipelineDatabaseDefinition: vi.fn(),
  getDatabaseDownloadJobStatus: vi.fn(),
  getPipelineDatabaseStatuses: vi.fn(),
  updateDatabaseDownloadRecord: vi.fn(),
  updateDatabaseDownloadJobStatus: vi.fn(),
  fsStat: vi.fn(),
  createReadStream: vi.fn(),
  hashDigest: vi.fn(),
  PIPELINE_REGISTRY: {} as Record<string, unknown>,
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

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines", () => ({
  PIPELINE_REGISTRY: mocks.PIPELINE_REGISTRY,
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  getPipelineDatabaseDefinition: mocks.getPipelineDatabaseDefinition,
  getDatabaseDownloadJobStatus: mocks.getDatabaseDownloadJobStatus,
  getPipelineDatabaseStatuses: mocks.getPipelineDatabaseStatuses,
  updateDatabaseDownloadRecord: mocks.updateDatabaseDownloadRecord,
  updateDatabaseDownloadJobStatus: mocks.updateDatabaseDownloadJobStatus,
}));

vi.mock("fs/promises", () => ({
  default: {
    stat: (...args: unknown[]) => mocks.fsStat(...args),
  },
}));

vi.mock("fs", () => ({
  createReadStream: (...args: unknown[]) => mocks.createReadStream(...args),
}));

// Mock crypto.createHash so the sha256 the route computes is deterministic and
// controllable via mocks.hashDigest.
vi.mock("crypto", () => {
  const createHash = () => ({
    update: vi.fn(),
    digest: () => mocks.hashDigest(),
  });
  return { default: { createHash }, createHash };
});

import { POST } from "./route";

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };

function makeRequest(body?: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/admin/settings/pipelines/download-db/link-existing",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
}

const databaseWithChecksum = {
  id: "core-nt",
  label: "Core NT",
  fileName: "core_nt.tar.gz",
  downloadUrl: "https://example.com/core_nt.tar.gz",
  configKey: "ntDbPath",
  version: "2024-01",
  sha256: "ABC123DEF",
};

// A single-chunk async-iterable stream so `for await (const chunk of stream)`
// terminates immediately.
function makeStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("data");
    },
  };
}

const validBody = {
  pipelineId: "metaxpath",
  databaseId: "core-nt",
  path: "/data/db/core_nt.tar.gz",
};

describe("POST /api/admin/settings/pipelines/download-db/link-existing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.getPipelineDatabaseDefinition.mockReturnValue(databaseWithChecksum);
    mocks.getDatabaseDownloadJobStatus.mockResolvedValue(null);
    mocks.fsStat.mockResolvedValue({
      size: 12345,
      isFile: () => true,
    });
    mocks.createReadStream.mockReturnValue(makeStream());
    // Hash matches the (lowercased) declared checksum by default.
    mocks.hashDigest.mockReturnValue("abc123def");
    mocks.db.pipelineConfig.findUnique.mockResolvedValue(null);
    mocks.db.pipelineConfig.upsert.mockResolvedValue({});
    mocks.updateDatabaseDownloadRecord.mockResolvedValue(undefined);
    mocks.updateDatabaseDownloadJobStatus.mockResolvedValue(undefined);
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/data/runs",
      pipelineDatabaseDir: "",
    });
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([
      { id: "core-nt", status: "downloaded", path: "/data/db/core_nt.tar.gz" },
    ]);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(
      makeRequest({ databaseId: "core-nt", path: "/data/db/core_nt.tar.gz" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Pipeline ID required" });
  });

  it("returns 400 when databaseId is missing", async () => {
    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", path: "/data/db/core_nt.tar.gz" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Database ID required" });
  });

  it("returns 400 when the path is empty", async () => {
    const response = await POST(
      makeRequest({ pipelineId: "metaxpath", databaseId: "core-nt", path: "  " })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Path required" });
  });

  it("returns 400 when the path is not absolute", async () => {
    const response = await POST(
      makeRequest({
        pipelineId: "metaxpath",
        databaseId: "core-nt",
        path: "relative/db.tar.gz",
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("must be absolute");
  });

  it("returns 404 when the database is not defined", async () => {
    mocks.getPipelineDatabaseDefinition.mockReturnValue(null);

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("is not defined");
  });

  it("returns 409 when a download is currently running", async () => {
    mocks.getDatabaseDownloadJobStatus.mockResolvedValue({ state: "running" });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("currently running");
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 when no file exists at the path", async () => {
    mocks.fsStat.mockRejectedValue(new Error("ENOENT"));

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("No file or directory");
  });

  it("returns 400 when the target file is empty", async () => {
    mocks.fsStat.mockResolvedValue({ size: 0, isFile: () => true });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("empty");
  });

  it("links the file when the checksum matches", async () => {
    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.path).toBe("/data/db/core_nt.tar.gz");
    expect(body.sizeBytes).toBe(12345);
    expect(body.database).toMatchObject({ id: "core-nt", status: "downloaded" });

    // The config + download record + job status are all persisted.
    expect(mocks.db.pipelineConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.updateDatabaseDownloadRecord).toHaveBeenCalledWith(
      "metaxpath",
      "core-nt",
      expect.objectContaining({
        version: "2024-01",
        path: "/data/db/core_nt.tar.gz",
        sizeBytes: 12345,
      })
    );
    expect(mocks.updateDatabaseDownloadJobStatus).toHaveBeenCalledWith(
      "metaxpath",
      "core-nt",
      expect.objectContaining({ state: "success", progressPercent: 100 })
    );
  });

  it("returns 400 when the checksum does not match", async () => {
    mocks.hashDigest.mockReturnValue("deadbeef");

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Checksum mismatch");
    expect(body.error).toContain("ABC123DEF");
    // Nothing is persisted on a mismatch.
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
    expect(mocks.updateDatabaseDownloadRecord).not.toHaveBeenCalled();
    expect(mocks.updateDatabaseDownloadJobStatus).not.toHaveBeenCalled();
  });

  it("skips checksum verification when the definition has no checksum", async () => {
    mocks.getPipelineDatabaseDefinition.mockReturnValue({
      ...databaseWithChecksum,
      sha256: undefined,
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    // Hash never computed -> stream never opened.
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.db.pipelineConfig.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips checksum verification when the path is a directory", async () => {
    mocks.fsStat.mockResolvedValue({ size: 4096, isFile: () => false });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    // isFile() === false short-circuits both the empty-file check and the
    // checksum verification.
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("merges existing config with registry defaults under the configKey", async () => {
    mocks.PIPELINE_REGISTRY.metaxpath = {
      defaultConfig: { topn: 50 },
    };
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      enabled: true,
      config: JSON.stringify({ topn: 10, other: "keep" }),
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    const upsertArgs = mocks.db.pipelineConfig.upsert.mock.calls[0][0];
    const updatedConfig = JSON.parse(upsertArgs.update.config);
    expect(updatedConfig).toEqual({
      topn: 10,
      other: "keep",
      ntDbPath: "/data/db/core_nt.tar.gz",
    });

    delete mocks.PIPELINE_REGISTRY.metaxpath;
  });

  it("returns 500 when persistence fails unexpectedly", async () => {
    mocks.db.pipelineConfig.upsert.mockRejectedValue(new Error("db down"));

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to link existing file");
    expect(body.details).toBe("db down");
  });
});
