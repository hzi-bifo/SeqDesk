import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import {
  scanDirectory,
  checkFileExists,
  clearScanCache,
  getScanCacheStats,
  type ScanOptions,
} from "./scanner";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string = "x"): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe("scanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    clearScanCache();
    tempDir = await makeTempDir("seqdesk-scanner-");
  });

  afterEach(async () => {
    clearScanCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const options: ScanOptions = {
    allowedExtensions: [".fastq.gz", ".fq.gz"],
    maxDepth: 4,
  };

  it("returns only allowed extensions and sorts by filename", async () => {
    await writeFile(path.join(tempDir, "b.fastq.gz"));
    await writeFile(path.join(tempDir, "a.fq.gz"));
    await writeFile(path.join(tempDir, "c.txt"));

    const files = await scanDirectory(tempDir, options);

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.filename)).toEqual(["a.fq.gz", "b.fastq.gz"]);
    expect(files[0]).toMatchObject({
      relativePath: "a.fq.gz",
      filename: "a.fq.gz",
    });
    expect(files[0].size).toBeTypeOf("number");
    expect(files[0].modifiedAt).toBeInstanceOf(Date);
  });

  it("enforces maxDepth", async () => {
    await writeFile(path.join(tempDir, "lvl1", "in.fastq.gz"));
    await writeFile(path.join(tempDir, "lvl1", "lvl2", "out.fastq.gz"));

    const shallow = await scanDirectory(tempDir, {
      ...options,
      maxDepth: 2,
    });

    expect(shallow.map((f) => f.relativePath)).toEqual(["lvl1/in.fastq.gz"]);
  });

  it("applies ignore patterns", async () => {
    await writeFile(path.join(tempDir, "data", "keep.fastq.gz"));
    await writeFile(path.join(tempDir, "data", "tmp", "skip.fastq.gz"));

    const files = await scanDirectory(tempDir, {
      ...options,
      ignorePatterns: ["**/tmp/**"],
    });

    expect(files.map((f) => f.relativePath)).toEqual(["data/keep.fastq.gz"]);
  });

  it("uses cache on repeated calls and bypasses with force", async () => {
    await writeFile(path.join(tempDir, "first.fastq.gz"));

    const first = await scanDirectory(tempDir, options);
    expect(first.map((f) => f.filename)).toEqual(["first.fastq.gz"]);

    await writeFile(path.join(tempDir, "second.fastq.gz"));

    const cached = await scanDirectory(tempDir, options);
    expect(cached.map((f) => f.filename)).toEqual(["first.fastq.gz"]);

    const forced = await scanDirectory(tempDir, options, true);
    expect(forced.map((f) => f.filename)).toEqual(["first.fastq.gz", "second.fastq.gz"]);
  });

  it("throws for missing directory", async () => {
    const missing = path.join(tempDir, "missing-dir");
    await expect(scanDirectory(missing, options)).rejects.toThrow(
      `Directory does not exist: ${missing}`
    );
  });

  it("throws when base path is not a directory", async () => {
    const filePath = path.join(tempDir, "file.fastq.gz");
    await writeFile(filePath);

    await expect(scanDirectory(filePath, options)).rejects.toThrow(
      `${filePath} is not a directory`
    );
  });

  it("checkFileExists returns info for valid file", async () => {
    await writeFile(path.join(tempDir, "reads", "sample.fastq.gz"), "ACGT");

    const file = await checkFileExists(tempDir, "reads/sample.fastq.gz");

    expect(file).not.toBeNull();
    expect(file).toMatchObject({
      relativePath: "reads/sample.fastq.gz",
      filename: "sample.fastq.gz",
    });
    expect(file?.absolutePath).toBe(path.join(tempDir, "reads", "sample.fastq.gz"));
  });

  it("checkFileExists returns null for traversal", async () => {
    await writeFile(path.join(tempDir, "inside.fastq.gz"));
    const result = await checkFileExists(tempDir, "../outside.fastq.gz");
    expect(result).toBeNull();
  });

  it("clearScanCache and getScanCacheStats expose cache state", async () => {
    await writeFile(path.join(tempDir, "cached.fastq.gz"));
    await scanDirectory(tempDir, options);

    const stats = getScanCacheStats();
    expect(stats.entries).toBe(1);
    expect(stats.keys).toHaveLength(1);

    clearScanCache();
    expect(getScanCacheStats().entries).toBe(0);
  });
});
