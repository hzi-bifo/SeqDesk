import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllDatabaseDownloadJobStatuses: vi.fn(),
  getDatabaseDownloadJobStatus: vi.fn(),
  getPipelineDatabaseDefinition: vi.fn(),
}));

import {
  hideAdminActivityJob,
  listAdminActivityJobs,
  readRedactedLogTail,
  updateAdminActivityJob,
} from "./activity";

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPipelinesDir: () => "/tmp/seqdesk-admin-activity",
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  getAllDatabaseDownloadJobStatuses: mocks.getAllDatabaseDownloadJobStatuses,
  getDatabaseDownloadJobStatus: mocks.getDatabaseDownloadJobStatus,
  getPipelineDatabaseDefinition: mocks.getPipelineDatabaseDefinition,
}));

describe("admin activity", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await fs.rm("/tmp/seqdesk-admin-activity", { recursive: true, force: true });
    mocks.getAllDatabaseDownloadJobStatuses.mockResolvedValue([
      {
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
        state: "running",
        phase: "downloading",
        bytesDownloaded: 50,
        totalBytes: 100,
        startedAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:05.000Z",
        targetPath: "/data/metaxpath_db_bundle.tar",
      },
    ]);
    mocks.getDatabaseDownloadJobStatus.mockResolvedValue(null);
    mocks.getPipelineDatabaseDefinition.mockReturnValue({
      id: "db-bundle",
      label: "MetaxPath Database Bundle",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates running database downloads and stored admin jobs", async () => {
    await updateAdminActivityJob("seed:dummy-data:admin-1", {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "error",
      phase: "seeding",
      error: "Data base path is not writable",
      finishedAt: new Date().toISOString(),
    });

    const jobs = await listAdminActivityJobs();

    expect(jobs).toEqual([
      expect.objectContaining({
        id: "pipeline-db:metaxpath:db-bundle",
        type: "pipeline-db-download",
        label: "MetaxPath Database Bundle (metaxpath)",
        state: "running",
        progressPercent: 50,
      }),
      expect.objectContaining({
        id: "seed:dummy-data:admin-1",
        state: "error",
        error: "Data base path is not writable",
      }),
    ]);
  });

  it("redacts URLs and bearer tokens from log tails", async () => {
    const logPath = path.join("/tmp/seqdesk-admin-activity", "download.log");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(
      logPath,
      [
        "Command: curl -H Authorization: Bearer secret-token https://example.test/file?token=abc",
        "Download failed",
      ].join("\n")
    );

    await expect(readRedactedLogTail(logPath)).resolves.toEqual([
      "Command: curl -H Authorization: Bearer [redacted] [url]",
      "Download failed",
    ]);
  });

  it("hides a stored activity entry until it is updated again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T10:00:00.000Z"));

    await updateAdminActivityJob("seed:dummy-data:admin-1", {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "error",
      phase: "seeding",
      error: "Data base path is not writable",
      finishedAt: "2026-05-13T10:00:00.000Z",
    });

    await expect(hideAdminActivityJob("seed:dummy-data:admin-1")).resolves.toBe(true);
    await expect(listAdminActivityJobs()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "seed:dummy-data:admin-1" }),
      ])
    );

    vi.setSystemTime(new Date("2026-05-13T10:01:00.000Z"));
    await updateAdminActivityJob("seed:dummy-data:admin-1", {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "error",
      phase: "seeding",
      error: "Data base path is still not writable",
      finishedAt: "2026-05-13T10:01:00.000Z",
    });

    await expect(listAdminActivityJobs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed:dummy-data:admin-1",
          error: "Data base path is still not writable",
        }),
      ])
    );
  });

  it("hides a database download activity only for the current status timestamp", async () => {
    await expect(hideAdminActivityJob("pipeline-db:metaxpath:db-bundle")).resolves.toBe(true);
    await expect(listAdminActivityJobs()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pipeline-db:metaxpath:db-bundle" }),
      ])
    );

    mocks.getAllDatabaseDownloadJobStatuses.mockResolvedValue([
      {
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
        state: "running",
        phase: "downloading",
        bytesDownloaded: 75,
        totalBytes: 100,
        startedAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:01:05.000Z",
        targetPath: "/data/metaxpath_db_bundle.tar",
      },
    ]);

    await expect(listAdminActivityJobs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pipeline-db:metaxpath:db-bundle",
          progressPercent: 75,
        }),
      ])
    );
  });
});
