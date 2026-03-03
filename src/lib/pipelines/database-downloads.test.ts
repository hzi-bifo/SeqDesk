import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import {
  buildPipelineDatabaseTargetPath,
  buildPipelineDatabaseRoot,
  calculateProgressPercent,
  createDatabaseDownloadLogPath,
  getDatabaseDownloadJobStatus,
  getDatabaseDownloadLogDir,
  getPipelineDatabaseDefinition,
  getPipelineDatabaseDefinitions,
  getPathSize,
  getPipelineDatabaseStatuses,
  updateDatabaseDownloadRecord,
  updateDatabaseDownloadJobStatus,
} from "./database-downloads";

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPipelinesDir: () => "/tmp/pipelines",
}));

const pipelinesDir = "/tmp/pipelines";
const indexPath = path.join(pipelinesDir, ".pipeline-database-downloads.json");
const statusPath = path.join(pipelinesDir, ".pipeline-database-download-status.json");

describe("database-downloads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs.promises, "readFile");
    vi.spyOn(fs.promises, "writeFile");
    vi.spyOn(fs.promises, "mkdir");
    vi.spyOn(fs.promises, "stat");
  });

  afterEach(async () => {
    await fs.promises.rm(pipelinesDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  it("returns the pipeline definitions for known and unknown IDs", () => {
    expect(getPipelineDatabaseDefinitions("mag")).toHaveLength(1);
    expect(getPipelineDatabaseDefinitions("unknown")).toEqual([]);

    const def = getPipelineDatabaseDefinition("mag", "gtdb");
    expect(def).not.toBeNull();
    expect(def?.id).toBe("gtdb");
    expect(getPipelineDatabaseDefinition("mag", "missing")).toBeNull();
  });

  it("returns an empty status list for unknown pipeline IDs", async () => {
    const status = await getPipelineDatabaseStatuses("unknown", {});
    expect(status).toEqual([]);
  });

  it("builds database directories and report paths", () => {
    expect(buildPipelineDatabaseRoot("/run/root")).toBe(path.join(path.resolve("/run/root"), "databases"));
    expect(buildPipelineDatabaseTargetPath("/run/root", "mag", "gtdb", "gtdb.tar.gz")).toContain("databases/mag/gtdb/gtdb.tar.gz");
  });

  it("calculates download progress with safe clamp", () => {
    expect(calculateProgressPercent(5, 10)).toBe(50);
    expect(calculateProgressPercent(150, 100)).toBe(100);
    expect(calculateProgressPercent(10, 0)).toBeNull();
    expect(calculateProgressPercent(undefined, 10)).toBeNull();
  });

  it("returns undefined for getPathSize without a target path", async () => {
    const result = await getPathSize(undefined);

    expect(result).toBeUndefined();
    expect(fs.promises.stat).not.toHaveBeenCalled();
  });

  it("returns undefined when getPathSize cannot stat a path", async () => {
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error("missing"));

    const result = await getPathSize("/tmp/missing-file");

    expect(result).toBeUndefined();
    expect(fs.promises.stat).toHaveBeenCalledWith("/tmp/missing-file");
  });

  it("reads current database job status from index", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === statusPath) {
        return JSON.stringify({
          "mag:gtdb": {
            pipelineId: "mag",
            databaseId: "gtdb",
            state: "running",
            sourceUrl: "https://example.test/db.tar.gz",
          },
        });
      }
      throw new Error("not expected");
    });

    const status = await getDatabaseDownloadJobStatus("mag", "gtdb");
    expect(status).toEqual({
      pipelineId: "mag",
      databaseId: "gtdb",
      state: "running",
      sourceUrl: "https://example.test/db.tar.gz",
    });
  });

  it("updates database job status by merging defaults", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === statusPath) return JSON.stringify({});
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

    const status = await updateDatabaseDownloadJobStatus("mag", "gtdb", { state: "success", totalBytes: 100 });

    expect(status).toEqual({
      pipelineId: "mag",
      databaseId: "gtdb",
      state: "success",
      totalBytes: 100,
    });
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      statusPath,
      JSON.stringify(
        {
          "mag:gtdb": {
            pipelineId: "mag",
            databaseId: "gtdb",
            state: "success",
            totalBytes: 100,
          },
        },
        null,
        2
      )
    );
  });

  it("creates timestamped log file under download log directory", async () => {
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(123000);

    const logPath = await createDatabaseDownloadLogPath("mag", "gtdb");

    expect(logPath).toBe(path.join(getDatabaseDownloadLogDir(), "mag-gtdb-123000.log"));
    expect(fs.promises.mkdir).toHaveBeenCalledWith(path.join(pipelinesDir, ".pipeline-database-download-logs"), { recursive: true });

    now.mockRestore();
  });

  it("updates or creates a database download record", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) {
        return JSON.stringify({
          "other:db": {
            pipelineId: "other",
            databaseId: "db",
            path: "/old/path",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        });
      }
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

    const record = await updateDatabaseDownloadRecord("mag", "gtdb", {
      path: "/new/path",
      sizeBytes: 1000,
      updatedAt: "2024-01-02T00:00:00.000Z",
    });

    expect(record).toEqual({
      pipelineId: "mag",
      databaseId: "gtdb",
      path: "/new/path",
      sizeBytes: 1000,
      updatedAt: "2024-01-02T00:00:00.000Z",
    });

    const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
    const writtenJson = JSON.parse(writeCall[1] as string);
    expect(writtenJson).toEqual({
      "other:db": {
        pipelineId: "other",
        databaseId: "db",
        path: "/old/path",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      "mag:gtdb": {
        pipelineId: "mag",
        databaseId: "gtdb",
        path: "/new/path",
        sizeBytes: 1000,
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
    });
  });

  it("updates database download record using auto-generated updatedAt when omitted", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) return "{}";
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

    const record = await updateDatabaseDownloadRecord("mag", "gtdb", {
      path: "/auto/timestamp/path.tar.gz",
      sizeBytes: 2048,
    });

    expect(record.pipelineId).toBe("mag");
    expect(record.databaseId).toBe("gtdb");
    expect(record.path).toBe("/auto/timestamp/path.tar.gz");
    expect(record.sizeBytes).toBe(2048);
    expect(typeof record.updatedAt).toBe("string");
    expect(() => new Date(record.updatedAt).toISOString()).not.toThrow();
  });

  it("falls back to missing indexes when persisted files are invalid", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) return "not-json";
      if (target.toString() === statusPath) return "not-json";
      throw new Error("not expected");
    });

    const status = await getPipelineDatabaseStatuses("mag", {});

    expect(status[0]).toMatchObject({
      id: "gtdb",
      status: "missing",
      detail: "Database not downloaded",
    });
  });

  it("returns null status when status index is malformed", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === statusPath) return "not-json";
      throw new Error("not expected");
    });

    const status = await getDatabaseDownloadJobStatus("mag", "gtdb");

    expect(status).toBeNull();
  });

  it("returns downloaded status for configured path matching expected size", async () => {
    const configuredPath = "/cfg/gtdb.tar.gz";
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) {
        return JSON.stringify({
          "mag:gtdb": {
            pipelineId: "mag",
            databaseId: "gtdb",
            path: "/record/gtdb.tar.gz",
            sizeBytes: 1000,
            updatedAt: "now",
          },
        });
      }
      if (target.toString() === statusPath) return JSON.stringify({});
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.stat).mockImplementation(async (target) => {
      if (target.toString() === configuredPath) {
        return { size: 1000 } as { size: number };
      }
      throw new Error("no");
    });

    const result = await getPipelineDatabaseStatuses("mag", { gtdbDb: configuredPath }, "/run-root");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "gtdb",
      status: "downloaded",
      path: configuredPath,
      detail: undefined,
      configuredPath,
      sizeBytes: 1000,
      lastUpdated: "now",
    });
  });

  it("marks missing database when files are incomplete", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) {
        return JSON.stringify({
          "mag:gtdb": {
            pipelineId: "mag",
            databaseId: "gtdb",
            path: "/record/gtdb.tar.gz",
          },
        });
      }
      if (target.toString() === statusPath) {
        return JSON.stringify({
          "mag:gtdb": {
            pipelineId: "mag",
            databaseId: "gtdb",
            state: "running",
            targetPath: "/record/gtdb.tar.gz",
            totalBytes: 1200,
          },
        });
      }
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.stat).mockImplementation(async (target) => {
      if (target.toString() === "/record/gtdb.tar.gz") {
        return { size: 500 } as { size: number };
      }
      throw new Error("no");
    });

    const result = await getPipelineDatabaseStatuses("mag", { gtdbDb: "" }, "/run-root");

    expect(result[0]).toMatchObject({
      status: "missing",
      path: undefined,
      detail: "Partial download detected (500/1200 bytes). Re-run download to resume.",
    });
  });

  it("reports missing when no candidates exist", async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async () => "{}");
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error("missing"));

    const result = await getPipelineDatabaseStatuses("mag", {});

    expect(result[0].status).toBe("missing");
    expect(result[0].detail).toBe("Database not downloaded");
  });

  it("reports configured path mismatch when configured database file is absent", async () => {
    const configuredPath = "/configured/missing.tar.gz";

    vi.mocked(fs.promises.readFile).mockImplementation(async (target) => {
      if (target.toString() === indexPath) {
        return "{}";
      }
      if (target.toString() === statusPath) {
        return "{}";
      }
      throw new Error("not expected");
    });
    vi.mocked(fs.promises.stat).mockImplementation(async (target) => {
      if (target.toString() === configuredPath) {
        throw new Error("missing");
      }
      throw new Error("not expected");
    });

    const result = await getPipelineDatabaseStatuses("mag", { gtdbDb: configuredPath });

    expect(result[0]).toMatchObject({
      id: "gtdb",
      status: "missing",
      path: undefined,
      configuredPath,
      detail: "Configured database path does not exist",
    });
  });
});
