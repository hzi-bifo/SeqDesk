import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResolvedDataBasePath: vi.fn(),
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

import {
  assertPathInsideBase,
  buildStableRequestHash,
  isPathInsideBase,
  resolveWorkbenchImportStorage,
  sanitizePathSegment,
  stableStringify,
} from "./storage";

let tempDir: string | null = null;

describe("workbench storage helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = null;
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates stable request hashes independent of object key order", () => {
    const first = buildStableRequestHash("provider", {
      taxon: "Escherichia coli",
      filters: { source: "refseq", cap: 25 },
    });
    const second = buildStableRequestHash("provider", {
      filters: { cap: 25, source: "refseq" },
      taxon: "Escherichia coli",
    });

    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
  });

  it("sanitizes path segments for provider cache directories", () => {
    expect(sanitizePathSegment("NCBI Genomes: Taxon / RefSeq")).toBe(
      "ncbi-genomes-taxon-refseq"
    );
    expect(sanitizePathSegment("!!!")).toBe("item");
  });

  it("detects paths that escape an allowed Workbench base path", () => {
    const base = path.join(os.tmpdir(), "seqdesk-workbench-base");
    const inside = path.join(base, "cache", "provider", "dataset");
    const outside = path.join(os.tmpdir(), "seqdesk-other-base", "dataset");

    expect(isPathInsideBase(inside, base)).toBe(true);
    expect(isPathInsideBase(base, base)).toBe(true);
    expect(isPathInsideBase(outside, base)).toBe(false);
    expect(() => assertPathInsideBase(outside, base, "Dataset path")).toThrow(
      "Dataset path must stay inside"
    );
  });

  it("resolves import cache and job paths below the configured data base path", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-workbench-"));
    mocks.getResolvedDataBasePath.mockResolvedValue({ dataBasePath: tempDir });

    const storage = await resolveWorkbenchImportStorage({
      providerId: "NCBI Genomes / Taxon",
      cacheKey: "abc123",
      jobId: "job-1",
    });

    expect(storage.cacheDir).toBe(
      path.join(tempDir, "workbench", "cache", "ncbi-genomes-taxon", "abc123")
    );
    expect(storage.logPath).toBe(
      path.join(tempDir, "workbench", "jobs", "job-1", "import.log")
    );
    await expect(fs.access(storage.cacheDir)).resolves.toBeUndefined();
    await expect(fs.access(storage.jobDir)).resolves.toBeUndefined();
  });
});
