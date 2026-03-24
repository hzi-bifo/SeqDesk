import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browseSequencingStorageFiles } from "./browse";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string = "x"): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

describe("browseSequencingStorageFiles", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await makeTempDir("seqdesk-browse-");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("recursively lists files and sorts them by modification time descending", async () => {
    const olderFile = path.join(tempDir, "run-1", "older.fastq.gz");
    const newerFile = path.join(tempDir, "run-1", "nested", "newer.fastq.gz");
    const reportFile = path.join(tempDir, "run-1", "report.txt");

    await writeFile(olderFile, "older");
    await writeFile(newerFile, "newer");
    await writeFile(reportFile, "report");

    await fs.utimes(olderFile, new Date("2026-03-20T10:00:00.000Z"), new Date("2026-03-20T10:00:00.000Z"));
    await fs.utimes(newerFile, new Date("2026-03-21T10:00:00.000Z"), new Date("2026-03-21T10:00:00.000Z"));
    await fs.utimes(reportFile, new Date("2026-03-19T10:00:00.000Z"), new Date("2026-03-19T10:00:00.000Z"));

    const files = await browseSequencingStorageFiles(tempDir);

    expect(files.map((file) => file.relativePath)).toEqual([
      path.join("run-1", "nested", "newer.fastq.gz"),
      path.join("run-1", "older.fastq.gz"),
      path.join("run-1", "report.txt"),
    ]);
    expect(files[0]).toMatchObject({
      filename: "newer.fastq.gz",
      size: 5,
    });
    expect(files[0]?.modifiedAt).toBeInstanceOf(Date);
  });

  it("applies search, ignore patterns, depth limits, and result limits", async () => {
    await writeFile(path.join(tempDir, "run-1", "Sample_R1.fastq.gz"));
    await writeFile(path.join(tempDir, "run-1", "tmp", "ignored_R1.fastq.gz"));
    await writeFile(path.join(tempDir, "run-1", "nested", "deep", "too-deep_R1.fastq.gz"));
    await writeFile(path.join(tempDir, "run-1", "Sample_R2.fastq.gz"));

    const filtered = await browseSequencingStorageFiles(tempDir, {
      search: "r1",
      ignorePatterns: ["**/tmp/**"],
      maxDepth: 3,
    });

    expect(filtered.map((file) => file.relativePath)).toEqual([
      path.join("run-1", "Sample_R1.fastq.gz"),
    ]);

    const limited = await browseSequencingStorageFiles(tempDir, {
      limit: 1,
    });

    expect(limited).toHaveLength(1);
  });

  it("returns an empty list for unreadable directories and ignores non-file entries", async () => {
    await expect(
      browseSequencingStorageFiles(path.join(tempDir, "missing"))
    ).resolves.toEqual([]);

    const keptFile = path.join(tempDir, "keep.fastq.gz");
    const linkedTarget = path.join(tempDir, "linked-target.fastq.gz");
    const symlinkPath = path.join(tempDir, "linked.fastq.gz");

    await writeFile(keptFile, "keep");
    await writeFile(linkedTarget, "target");
    await fs.symlink(linkedTarget, symlinkPath);

    const files = await browseSequencingStorageFiles(tempDir);

    expect(files.map((file) => file.filename).sort()).toEqual([
      "keep.fastq.gz",
      "linked-target.fastq.gz",
    ]);
  });
});
