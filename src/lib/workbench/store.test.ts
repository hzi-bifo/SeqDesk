import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  getExecutionSettings: vi.fn(),
  resolveWorkbenchStorageBase: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/workbench/storage", () => ({
  resolveWorkbenchStorageBase: mocks.resolveWorkbenchStorageBase,
  sanitizePathSegment: (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item",
}));

import {
  getWorkbenchStoreItem,
  listWorkbenchStoreCatalog,
  listWorkbenchStoreItems,
  startWorkbenchStoreInstall,
} from "./store";

let tempDir: string;

describe("workbench store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-workbench-store-"));
    mocks.resolveWorkbenchStorageBase.mockResolvedValue({
      baseDir: path.join(tempDir, "workbench"),
      cacheRoot: path.join(tempDir, "workbench", "cache"),
      jobsRoot: path.join(tempDir, "workbench", "jobs"),
    });
    mocks.getExecutionSettings.mockResolvedValue({ condaPath: "" });
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("missing"), { stdout: "", stderr: "" });
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("declares NCBI Datasets CLI as a curated Store tool", () => {
    expect(listWorkbenchStoreCatalog()).toEqual([
      expect.objectContaining({
        id: "ncbi-datasets-cli",
        kind: "tool",
        usedBy: ["ncbi-genomes-taxon"],
        install: expect.objectContaining({
          method: "conda",
          packages: expect.arrayContaining(["ncbi-datasets-cli"]),
        }),
      }),
    ]);
    expect(getWorkbenchStoreItem("missing")).toBeNull();
  });

  it("reports setup-needed when neither commands nor Conda are available", async () => {
    const [item] = await listWorkbenchStoreItems();

    expect(item.status).toMatchObject({
      state: "setup-needed",
      message: "Conda is required for managed setup",
    });
  });

  it("reports missing but installable when Conda is available", async () => {
    mocks.execFile.mockImplementation((command, _args, _options, callback) => {
      if (command === "conda") {
        callback(null, { stdout: "conda 24.1.0", stderr: "" });
        return;
      }
      callback(new Error("missing"), { stdout: "", stderr: "" });
    });

    const [item] = await listWorkbenchStoreItems();

    expect(item.status).toMatchObject({
      state: "missing",
      message: "Not installed",
    });
    expect(item.status.details).toContain("conda");
  });

  it("fails safely when starting setup without Conda", async () => {
    await expect(startWorkbenchStoreInstall("ncbi-datasets-cli")).rejects.toThrow(
      "Conda is not configured or available"
    );
  });
});
