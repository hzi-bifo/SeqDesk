import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as fs from "fs/promises";
import { inspectReadFiles } from "./read-files-inspection";

vi.mock("fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs/promises")>();
  return { ...original, stat: vi.fn(original.stat) };
});

describe("inspectReadFiles", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "seqdesk-read-inspection-")); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("verifies real read files and flags a missing mate", async () => {
    await writeFile(join(directory, "R1.fastq"), "@read\nACGT\n+\nIIII\n");
    expect(await inspectReadFiles(directory, { file1: "R1.fastq" })).toMatchObject({ filesMissing: false, fileSize1: 18 });
    expect(await inspectReadFiles(directory, { file1: join(directory, "R1.fastq") })).toMatchObject({ filesMissing: false, fileSize1: 18 });
    expect(await inspectReadFiles(directory, { file1: "R1.fastq", file2: "R2.fastq" })).toMatchObject({ filesMissing: true });
  });

  it("does not count a directory or traversal path as a readable input", async () => {
    await mkdir(join(directory, "directory.fastq"));
    expect(await inspectReadFiles(directory, { file1: "directory.fastq" })).toMatchObject({ filesMissing: true });
    expect(await inspectReadFiles(directory, { file1: "../outside.fastq" })).toMatchObject({ filesMissing: true });
  });

  it("reports unverified storage separately from proven missing inputs", async () => {
    expect(await inspectReadFiles(null, { file1: "R1.fastq" })).toEqual({ filesMissing: null, fileSize1: null, fileSize2: null });
    vi.mocked(fs.stat).mockRejectedValueOnce(Object.assign(new Error("Permission denied"), { code: "EACCES" }));
    expect(await inspectReadFiles(directory, { file1: "R1.fastq" })).toMatchObject({ filesMissing: null });
  });
});
