import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import EventEmitter from "events";

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
  spawn: vi.fn(),
  exec: vi.fn(),
  fsStat: vi.fn(),
  fsMkdir: vi.fn(),
  fsRm: vi.fn(),
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

vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mocks.spawn(...args),
  exec: (...args: unknown[]) => mocks.exec(...args),
}));

vi.mock("util", () => ({
  promisify: () => {
    // promisify(exec) is used for commandExists and commandSupportsOption
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        mocks.exec(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
}));

vi.mock("fs", () => ({
  createWriteStream: () => ({
    write: vi.fn(),
    end: vi.fn(),
  }),
}));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mocks.fsMkdir(...args),
    rm: (...args: unknown[]) => mocks.fsRm(...args),
    stat: (...args: unknown[]) => mocks.fsStat(...args),
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

function makeDownloadChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { pipe: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { pipe: ReturnType<typeof vi.fn> };
  };
  child.pid = 5678;
  const stdout = new EventEmitter() as EventEmitter & { pipe: ReturnType<typeof vi.fn> };
  stdout.pipe = vi.fn();
  const stderr = new EventEmitter() as EventEmitter & { pipe: ReturnType<typeof vi.fn> };
  stderr.pipe = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  return child;
}

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
    mocks.fsMkdir.mockResolvedValue(undefined);
    mocks.fsRm.mockResolvedValue(undefined);
    mocks.fsStat.mockResolvedValue({ size: 0 });

    // Default: curl exists, no --retry-all-errors support
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v curl")) {
          callback(null, { stdout: "/usr/bin/curl" });
        } else if (cmd.includes("--help all")) {
          callback(null, { stdout: "", stderr: "" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );

    // Default: spawn returns a child that emits close(0) on next tick
    mocks.spawn.mockImplementation(() => {
      const child = makeDownloadChild();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });
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

  it("replace flag forces re-download even if file exists", async () => {
    // File exists and is complete
    mocks.fsStat.mockResolvedValue({ size: 1000000 });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb", replace: true })
    );

    expect(response.status).toBe(200);
    // fs.rm should have been called to remove the existing file
    expect(mocks.fsRm).toHaveBeenCalledWith(
      "/data/runs/mag/databases/gtdb.tar.gz",
      { force: true }
    );
    // Should proceed to download, not return alreadyPresent
    const body = await response.json();
    expect(body.alreadyPresent).toBeUndefined();
  });

  it("skips download when existing complete file is detected", async () => {
    // File size matches remote content-length (1000000)
    mocks.fsStat.mockResolvedValue({ size: 1000000 });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyPresent).toBe(true);
    // Should update the download record and pipeline config
    expect(mocks.updateDatabaseDownloadRecord).toHaveBeenCalled();
  });

  it("uses wget fallback when curl is not available", async () => {
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v curl")) {
          callback(new Error("not found"), null);
        } else if (cmd.includes("command -v wget")) {
          callback(null, { stdout: "/usr/bin/wget" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);
    // spawn should have been called with wget
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mocks.spawn.mock.calls[0];
    expect(spawnArgs[0]).toBe("wget");
  });

  it("returns 500 when no downloader is available", async () => {
    mocks.exec.mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        callback(new Error("not found"), null);
      }
    );

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.details).toContain("Neither curl nor wget");
    expect(body.error).toContain("Failed to download pipeline database");
  });

  it("process exit code 0 marks download as success", async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ size: 0 }) // initial getFileSize
      .mockResolvedValueOnce({ size: 500000 }); // getFileSize in close handler

    mocks.spawn.mockImplementation(() => {
      const child = makeDownloadChild();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);

    // Wait for async close handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should update job status to success
    const statusCalls = mocks.updateDatabaseDownloadJobStatus.mock.calls;
    const successCall = statusCalls.find(
      (call: { 0: string; 1: string; 2: { state?: string } }) => call[2]?.state === "success"
    );
    expect(successCall).toBeDefined();
  });

  it("process exit code 18 marks download as partial transfer (resumable)", async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ size: 0 })
      .mockResolvedValueOnce({ size: 250000 }); // partial download

    mocks.spawn.mockImplementation(() => {
      const child = makeDownloadChild();
      process.nextTick(() => child.emit("close", 18));
      return child;
    });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusCalls = mocks.updateDatabaseDownloadJobStatus.mock.calls;
    const errorCall = statusCalls.find(
      (call: { 0: string; 1: string; 2: { error?: string } }) =>
        call[2]?.error && String(call[2].error).includes("code 18")
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[2].error).toContain("partial transfer");
  });

  it("other exit codes mark download as error", async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ size: 0 })
      .mockResolvedValueOnce({ size: 100 });

    mocks.spawn.mockImplementation(() => {
      const child = makeDownloadChild();
      process.nextTick(() => child.emit("close", 7));
      return child;
    });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusCalls = mocks.updateDatabaseDownloadJobStatus.mock.calls;
    const errorCall = statusCalls.find(
      (call: { 0: string; 1: string; 2: { error?: string } }) =>
        call[2]?.error && String(call[2].error).includes("code 7")
    );
    expect(errorCall).toBeDefined();
  });

  it("process error event marks download as error", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = makeDownloadChild();
      process.nextTick(() => child.emit("error", new Error("spawn ENOENT")));
      return child;
    });

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusCalls = mocks.updateDatabaseDownloadJobStatus.mock.calls;
    const errorCall = statusCalls.find(
      (call: { 0: string; 1: string; 2: { state?: string; error?: string } }) =>
        call[2]?.state === "error" && call[2]?.error?.includes("ENOENT")
    );
    expect(errorCall).toBeDefined();
  });

  it("returns 500 on unexpected error in outer try-catch", async () => {
    // Force an unexpected error by making getExecutionSettings throw after auth
    mocks.getExecutionSettings.mockRejectedValue(new Error("DB down"));

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("Failed to download pipeline database");
  });

  it("curl downloader includes --retry-all-errors when supported", async () => {
    mocks.exec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback: (err: Error | null, result: unknown) => void
      ) => {
        if (cmd.includes("command -v curl")) {
          callback(null, { stdout: "/usr/bin/curl" });
        } else if (cmd.includes("--help all")) {
          // Return output that includes --retry-all-errors
          callback(null, { stdout: "--retry-all-errors", stderr: "" });
        } else {
          callback(new Error("not found"), null);
        }
      }
    );

    const response = await POST(
      makeRequest({ pipelineId: "mag", databaseId: "gtdb" })
    );

    expect(response.status).toBe(200);
    // spawn should have been called with curl and --retry-all-errors in the args
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mocks.spawn.mock.calls[0];
    expect(spawnArgs[0]).toBe("curl");
    expect(spawnArgs[1]).toContain("--retry-all-errors");
  });
});
