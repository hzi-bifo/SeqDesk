import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipelinesDir = path.join(os.tmpdir(), "seqdesk-nextflow-downloads-tests");

vi.mock("./package-loader", () => ({
  getPipelinesDir: () => pipelinesDir,
}));

import {
  clearDownloadJobStatus,
  createDownloadLogPath,
  getDownloadJobStatus,
  getDownloadLogDir,
  getNextflowAssetsDir,
  getPipelineDownloadStatus,
  readNextflowManifestVersion,
  resolvePipelineAssetsPath,
  updateDownloadJobStatus,
  updateDownloadRecord,
} from "./nextflow-downloads";

const indexPath = path.join(pipelinesDir, ".pipeline-downloads.json");
const statusPath = path.join(pipelinesDir, ".pipeline-download-status.json");

let originalNxfAssets: string | undefined;
let originalNxfHome: string | undefined;

describe("nextflow-downloads", () => {
  beforeEach(async () => {
    await fs.rm(pipelinesDir, { recursive: true, force: true });
    originalNxfAssets = process.env.NXF_ASSETS;
    originalNxfHome = process.env.NXF_HOME;
    process.env.NXF_ASSETS = path.join(pipelinesDir, "assets");
    process.env.NXF_HOME = path.join(pipelinesDir, "home");
  });

  afterEach(async () => {
    if (originalNxfAssets === undefined) {
      delete process.env.NXF_ASSETS;
    } else {
      process.env.NXF_ASSETS = originalNxfAssets;
    }
    if (originalNxfHome === undefined) {
      delete process.env.NXF_HOME;
    } else {
      process.env.NXF_HOME = originalNxfHome;
    }
    await fs.rm(pipelinesDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("classifies pipeline references into unsupported/local/remote assets", () => {
    expect(resolvePipelineAssetsPath("")).toEqual({
      kind: "unsupported",
      reason: "Missing pipeline reference",
    });
    expect(resolvePipelineAssetsPath("./pipelines/mag")).toEqual({
      kind: "local",
      reason: "Local pipeline path",
    });
    expect(resolvePipelineAssetsPath("https://github.com/nf-core/mag")).toEqual({
      kind: "unsupported",
      reason: "Remote pipeline URL",
    });
    expect(resolvePipelineAssetsPath("nf-core/mag")).toEqual({
      kind: "remote",
      path: path.join(getNextflowAssetsDir(), "nf-core", "mag"),
    });
    expect(resolvePipelineAssetsPath("mag")).toEqual({
      kind: "remote",
      path: path.join(getNextflowAssetsDir(), "mag"),
    });
  });

  it("parses manifest version from nextflow config", async () => {
    const assetsPath = path.join(getNextflowAssetsDir(), "nf-core", "mag");
    await fs.mkdir(assetsPath, { recursive: true });
    await fs.writeFile(
      path.join(assetsPath, "nextflow.config"),
      "manifest.version = '3.4.5'\n"
    );

    const version = await readNextflowManifestVersion(assetsPath);
    expect(version).toBe("3.4.5");
  });

  it("returns null when nextflow config is missing or does not contain manifest version", async () => {
    const missingPath = path.join(getNextflowAssetsDir(), "nf-core", "missing");
    expect(await readNextflowManifestVersion(missingPath)).toBeNull();

    const assetsPath = path.join(getNextflowAssetsDir(), "nf-core", "mag");
    await fs.mkdir(assetsPath, { recursive: true });
    await fs.writeFile(path.join(assetsPath, "nextflow.config"), "process.executor = 'local'\n");
    expect(await readNextflowManifestVersion(assetsPath)).toBeNull();
  });

  it("updates, reads, and clears job status", async () => {
    await updateDownloadJobStatus("mag", { state: "running", pipelineRef: "nf-core/mag" });
    await updateDownloadJobStatus("mag", { state: "success", resolvedVersion: "1.2.3" });

    const status = await getDownloadJobStatus("mag");
    expect(status).toEqual({
      pipelineId: "mag",
      state: "success",
      pipelineRef: "nf-core/mag",
      resolvedVersion: "1.2.3",
    });

    await clearDownloadJobStatus("mag");
    expect(await getDownloadJobStatus("mag")).toBeNull();
  });

  it("creates timestamped download log paths", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);

    const logPath = await createDownloadLogPath("mag");

    expect(logPath).toBe(path.join(getDownloadLogDir(), "mag-12345.log"));
    await expect(fs.access(path.dirname(logPath))).resolves.toBeUndefined();
    nowSpy.mockRestore();
  });

  it("returns unsupported status for non-remote pipeline refs", async () => {
    const status = await getPipelineDownloadStatus("mag", "/local/pipeline", "1.0.0");

    expect(status).toEqual({
      status: "unsupported",
      expectedVersion: "1.0.0",
      detail: "Local pipeline path",
      job: null,
    });
  });

  it("returns missing status when remote assets are absent", async () => {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      JSON.stringify(
        {
          mag: {
            pipeline: "mag",
            version: "2.0.0",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        null,
        2
      )
    );
    await fs.writeFile(
      statusPath,
      JSON.stringify(
        {
          mag: {
            pipelineId: "mag",
            state: "running",
          },
        },
        null,
        2
      )
    );

    const status = await getPipelineDownloadStatus("mag", "nf-core/mag", "2.0.0");

    expect(status).toEqual({
      status: "missing",
      expectedVersion: "2.0.0",
      path: path.join(getNextflowAssetsDir(), "nf-core", "mag"),
      lastUpdated: "2026-01-01T00:00:00.000Z",
      job: {
        pipelineId: "mag",
        state: "running",
      },
    });
  });

  it("returns downloaded status with detected manifest version", async () => {
    const assetsPath = path.join(getNextflowAssetsDir(), "nf-core", "mag");
    await fs.mkdir(assetsPath, { recursive: true });
    await fs.writeFile(
      path.join(assetsPath, "nextflow.config"),
      "manifest.version = \"9.9.9\"\n"
    );
    await updateDownloadRecord("mag", {
      pipeline: "mag",
      version: "1.0.0",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });

    const status = await getPipelineDownloadStatus("mag", "nf-core/mag", "1.0.0");

    expect(status).toEqual({
      status: "downloaded",
      expectedVersion: "1.0.0",
      version: "9.9.9",
      path: assetsPath,
      lastUpdated: "2026-02-02T00:00:00.000Z",
      job: null,
    });
  });

  it("falls back to recorded version when manifest version is unavailable", async () => {
    const assetsPath = path.join(getNextflowAssetsDir(), "nf-core", "mag");
    await fs.mkdir(assetsPath, { recursive: true });
    await updateDownloadRecord("mag", {
      pipeline: "mag",
      version: "7.1.0",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });

    const status = await getPipelineDownloadStatus("mag", "nf-core/mag", "7.1.0");

    expect(status).toEqual({
      status: "downloaded",
      expectedVersion: "7.1.0",
      version: "7.1.0",
      path: assetsPath,
      lastUpdated: "2026-03-03T00:00:00.000Z",
      job: null,
    });
  });
});
