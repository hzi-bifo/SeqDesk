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
  updateDatabaseDownloadJobStatus: vi.fn(),
  updateDatabaseDownloadRecord: vi.fn(),
  createDatabaseDownloadLogPath: vi.fn(),
  buildPipelineDatabaseTargetPath: vi.fn(),
  calculateProgressPercent: vi.fn(),
  getPipelineDatabaseStatuses: vi.fn(),
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
  updateDatabaseDownloadJobStatus: mocks.updateDatabaseDownloadJobStatus,
  updateDatabaseDownloadRecord: mocks.updateDatabaseDownloadRecord,
  createDatabaseDownloadLogPath: mocks.createDatabaseDownloadLogPath,
  buildPipelineDatabaseTargetPath: mocks.buildPipelineDatabaseTargetPath,
  calculateProgressPercent: mocks.calculateProgressPercent,
  getPipelineDatabaseStatuses: mocks.getPipelineDatabaseStatuses,
}));

vi.mock("child_process", () => {
  const mockChild = {
    pid: 5678,
    stdout: { pipe: vi.fn() },
    stderr: { pipe: vi.fn() },
    on: vi.fn(),
  };
  return {
    spawn: () => mockChild,
    exec: vi.fn(),
  };
});

vi.mock("util", () => ({
  promisify: () => vi.fn().mockResolvedValue({ stdout: "/usr/bin/curl" }),
}));

vi.mock("fs", () => ({
  createWriteStream: () => ({
    write: vi.fn(),
    end: vi.fn(),
  }),
}));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0 }),
  },
}));

// Mock global fetch for getRemoteContentLength
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "1000000" },
  })
);

import { POST } from "./route";

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost:3000/api/admin/settings/pipelines/download-db",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/settings/pipelines/download-db", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/data/runs",
    });
    mocks.getPipelineDatabaseDefinition.mockReturnValue({
      id: "gtdb",
      name: "GTDB",
      downloadUrl: "https://example.com/gtdb.tar.gz",
      fileName: "gtdb.tar.gz",
      version: "r220",
      configKey: "gtdbPath",
    });
    mocks.getDatabaseDownloadJobStatus.mockResolvedValue(null);
    mocks.buildPipelineDatabaseTargetPath.mockReturnValue(
      "/data/runs/mag/databases/gtdb.tar.gz"
    );
    mocks.updateDatabaseDownloadJobStatus.mockResolvedValue(undefined);
    mocks.updateDatabaseDownloadRecord.mockResolvedValue(undefined);
    mocks.createDatabaseDownloadLogPath.mockResolvedValue("/tmp/db-log.txt");
    mocks.calculateProgressPercent.mockReturnValue(0);
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([
      { id: "gtdb", status: "downloading" },
    ]);
    mocks.db.pipelineConfig.findUnique.mockResolvedValue(null);
    mocks.db.pipelineConfig.upsert.mockResolvedValue(undefined);
  });

  it("starts a database download successfully", async () => {
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.pipelineId).toBe("mag");
    expect(body.databaseId).toBe("gtdb");
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(makeRequest({ databaseId: "gtdb" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline ID required");
  });

  it("returns 400 when databaseId is missing", async () => {
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Database ID required");
  });

  it("returns 404 when database definition is not found", async () => {
    mocks.getPipelineDatabaseDefinition.mockReturnValue(null);
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "unknown" })
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 when download is already in progress", async () => {
    mocks.getDatabaseDownloadJobStatus.mockResolvedValue({
      state: "running",
    });
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already in progress");
  });

  it("returns 400 when pipeline run directory is not configured", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: undefined,
    });
    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline run directory is not configured");
  });
});
