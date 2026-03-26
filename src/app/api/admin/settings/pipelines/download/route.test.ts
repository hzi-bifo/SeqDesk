import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getPackageManifest: vi.fn(),
  getExecutionSettings: vi.fn(),
  resolvePipelineAssetsPath: vi.fn(),
  getDownloadJobStatus: vi.fn(),
  updateDownloadJobStatus: vi.fn(),
  createDownloadLogPath: vi.fn(),
  getPipelineDownloadStatus: vi.fn(),
  readNextflowManifestVersion: vi.fn(),
  updateDownloadRecord: vi.fn(),
  spawn: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackageManifest: mocks.getPackageManifest,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/nextflow-downloads", () => ({
  resolvePipelineAssetsPath: mocks.resolvePipelineAssetsPath,
  getDownloadJobStatus: mocks.getDownloadJobStatus,
  updateDownloadJobStatus: mocks.updateDownloadJobStatus,
  createDownloadLogPath: mocks.createDownloadLogPath,
  getPipelineDownloadStatus: mocks.getPipelineDownloadStatus,
  readNextflowManifestVersion: mocks.readNextflowManifestVersion,
  updateDownloadRecord: mocks.updateDownloadRecord,
}));

vi.mock("child_process", () => {
  const mockChild = {
    pid: 1234,
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
  promisify: () =>
    vi.fn().mockImplementation(async (cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("nextflow")) {
        return { stdout: "nextflow version 24.04.0", stderr: "" };
      }
      throw new Error("command not found");
    }),
}));

vi.mock("fs", () => ({
  createWriteStream: () => ({
    write: vi.fn(),
    end: vi.fn(),
  }),
}));

vi.mock("fs/promises", () => ({
  default: { access: vi.fn().mockRejectedValue(new Error("not found")) },
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost:3000/api/admin/settings/pipelines/download",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/settings/pipelines/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    });
    mocks.getPackageManifest.mockReturnValue({
      execution: {
        type: "nextflow",
        pipeline: "nf-core/mag",
        version: "2.5.4",
      },
    });
    mocks.resolvePipelineAssetsPath.mockReturnValue({
      kind: "remote",
      path: "/home/.nextflow/assets/nf-core/mag",
    });
    mocks.getDownloadJobStatus.mockResolvedValue(null);
    mocks.getExecutionSettings.mockResolvedValue({
      condaPath: "/opt/conda",
      condaEnv: "seqdesk-pipelines",
    });
    mocks.updateDownloadJobStatus.mockResolvedValue(undefined);
    mocks.createDownloadLogPath.mockResolvedValue("/tmp/log.txt");
    mocks.getPipelineDownloadStatus.mockResolvedValue({
      downloaded: true,
      version: "2.5.4",
    });
  });

  it("starts a pipeline download successfully", async () => {
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.pipelineId).toBe("mag");
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(403);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline ID required");
  });

  it("returns 404 when manifest is not found", async () => {
    mocks.getPackageManifest.mockReturnValue(null);
    const response = await POST(makeRequest({ pipelineId: "unknown" }));

    expect(response.status).toBe(404);
  });

  it("returns 400 when pipeline is not nextflow type", async () => {
    mocks.getPackageManifest.mockReturnValue({
      execution: { type: "shell", pipeline: "test" },
    });
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not a Nextflow pipeline");
  });

  it("returns 400 when pipeline reference is not remote", async () => {
    mocks.resolvePipelineAssetsPath.mockReturnValue({
      kind: "local",
      reason: "Local pipeline",
    });
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not supported");
  });

  it("returns 409 when download is already in progress", async () => {
    mocks.getDownloadJobStatus.mockResolvedValue({ state: "running" });
    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already in progress");
  });

  it("returns 400 when pipelineId is a non-string type", async () => {
    const response = await POST(makeRequest({ pipelineId: 123 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline ID required");
  });

  it("returns 400 when pipeline reference is missing in manifest", async () => {
    mocks.getPackageManifest.mockReturnValue({
      execution: {
        type: "nextflow",
        pipeline: null,
        version: "2.5.4",
      },
    });

    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Pipeline reference missing");
  });

  it("allows re-download when existing job is in success state", async () => {
    mocks.getDownloadJobStatus.mockResolvedValue({
      state: "success",
      finishedAt: "2025-01-01T00:00:00Z",
    });

    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("allows re-download when existing job is in error state", async () => {
    mocks.getDownloadJobStatus.mockResolvedValue({
      state: "error",
      error: "Download exited with code 1",
    });

    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("returns 500 when getExecutionSettings throws", async () => {
    mocks.getExecutionSettings.mockRejectedValue(
      new Error("Settings unavailable")
    );

    const response = await POST(makeRequest({ pipelineId: "mag" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("Failed to download pipeline");
    expect(body.details).toContain("Settings unavailable");
  });

  it("uses custom version when provided in request body", async () => {
    const response = await POST(
      makeRequest({ pipelineId: "mag", version: "3.0.0" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe("3.0.0");
  });
});
