import fs from "fs/promises";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAdminActivityJobs,
  readRedactedLogTail,
  updateAdminActivityJob,
} from "./activity";

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPipelinesDir: () => "/tmp/seqdesk-admin-activity",
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  getAllDatabaseDownloadJobStatuses: vi.fn(async () => [
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
  ]),
  getDatabaseDownloadJobStatus: vi.fn(async () => null),
  getPipelineDatabaseDefinition: vi.fn(() => ({
    id: "db-bundle",
    label: "MetaxPath Database Bundle",
  })),
}));

describe("admin activity", () => {
  beforeEach(async () => {
    await fs.rm("/tmp/seqdesk-admin-activity", { recursive: true, force: true });
  });

  it("aggregates running database downloads and stored admin jobs", async () => {
    await updateAdminActivityJob("seed:dummy-data:admin-1", {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "error",
      phase: "seeding",
      error: "Data base path is not writable",
      finishedAt: "2026-05-12T10:01:00.000Z",
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
});
