import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResolvedDataBasePath: vi.fn(),
  getExecutionSettings: vi.fn(),
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));
vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

import { isPathInsideBase, resolveContainedPath, resolveExploreStorage, sanitizeSegment } from "./storage";

describe("explore storage", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "explore-storage-"));
    mocks.getResolvedDataBasePath.mockResolvedValue({ dataBasePath: tmp, source: "file", isImplicit: false });
    mocks.getExecutionSettings.mockResolvedValue({ pipelineRunDir: path.join(tmp, "runs") });
    delete process.env.SEQDESK_EXPLORE_DIR;
    delete process.env.SEQDESK_EXPLORE_RUN_DIR;
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("creates dataset roots under the data base path and runs under the pipeline run dir", async () => {
    const storage = await resolveExploreStorage();
    expect(storage.baseDir).toBe(path.join(tmp, "explore"));
    expect(storage.runsRoot).toBe(path.join(tmp, "runs", "explore"));
    await expect(fs.stat(storage.datasetsRoot)).resolves.toBeTruthy();
    await expect(fs.stat(storage.importsRoot)).resolves.toBeTruthy();
  });

  it("honours environment overrides", async () => {
    process.env.SEQDESK_EXPLORE_DIR = path.join(tmp, "custom");
    process.env.SEQDESK_EXPLORE_RUN_DIR = path.join(tmp, "custom-runs");
    const storage = await resolveExploreStorage();
    expect(storage.baseDir).toBe(path.join(tmp, "custom"));
    expect(storage.runsRoot).toBe(path.join(tmp, "custom-runs"));
  });

  it("refuses paths that escape the base, lexically and through symlinks", async () => {
    const base = path.join(tmp, "base");
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, "ok.txt"), "ok");
    const outside = path.join(tmp, "secret.txt");
    await fs.writeFile(outside, "secret");
    await fs.symlink(outside, path.join(base, "link.txt"));

    expect(isPathInsideBase(path.join(base, "ok.txt"), base)).toBe(true);
    expect(isPathInsideBase(path.join(base, "..", "secret.txt"), base)).toBe(false);
    await expect(resolveContainedPath(base, "ok.txt")).resolves.toBe(await fs.realpath(path.join(base, "ok.txt")));
    await expect(resolveContainedPath(base, "../secret.txt")).rejects.toThrow(/escapes/);
    await expect(resolveContainedPath(base, "link.txt")).rejects.toThrow(/escapes/);
  });

  it("sanitizes path segments", () => {
    expect(sanitizeSegment("MetaxPath profiles / study A")).toBe("metaxpath-profiles-study-a");
    expect(sanitizeSegment("///")).toBe("item");
  });
});
