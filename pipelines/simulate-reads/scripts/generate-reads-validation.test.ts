import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { describe, expect, it } from "vitest";

import { analyzeFastqBuffer, assertValidFastqLines, readLimits } from "./generate-reads.mjs";

describe("template FASTQ validation", () => {
  const good = ["@a", "ACGT", "+", "IIII"];

  it("accepts well-formed records", () => {
    expect(() => assertValidFastqLines([...good, ...good], "t.fastq")).not.toThrow();
  });

  it("rejects malformed compressed content instead of replaying it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-fastq-"));
    const file = path.join(dir, "t.fastq.gz");
    const bad = gzipSync(Buffer.from("not-header\nACGT\nnot-plus\n!\n", "utf8"));
    await fs.writeFile(file, bad);
    expect(() => analyzeFastqBuffer(bad, file)).toThrow(/not valid FASTQ/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects mismatched lengths and truncated records", () => {
    expect(() => assertValidFastqLines(["@a", "ACGT", "+", "II"], "t.fastq")).toThrow(/lengths differ/);
    expect(() => assertValidFastqLines(["@a", "ACGT", "+"], "t.fastq")).toThrow(/multiple of 4/);
  });
});

describe("mode-dependent read limits", () => {
  it("accepts in-range values and defaults per mode", () => {
    expect(readLimits("shortReadPaired", "50000", "300")).toEqual({ readCount: 50000, readLength: 300 });
    expect(readLimits("longRead", undefined, "")).toEqual({ readCount: 1000, readLength: 2500 });
  });
  it("rejects out-of-range values with a clear message instead of clamping", () => {
    expect(() => readLimits("longRead", "6000", "2500")).toThrow(/Read count must be a whole number between 5 and 5000 for long-read mode/);
    expect(() => readLimits("shortReadSingle", "100", "301")).toThrow(/Read length must be a whole number between 25 and 300 for short-read mode/);
    expect(() => readLimits("shortReadPaired", "abc", "150")).toThrow(/Read count/);
  });
});
