import { describe, expect, it } from "vitest";
import { gzipMismatch, looksLikeGzip } from "./gzip-name-check";

describe("gzipMismatch", () => {
  it("accepts real gzip bytes under a .gz name", () => {
    expect(looksLikeGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(gzipMismatch("reads_1.fastq.gz", new Uint8Array([0x1f, 0x8b, 8, 0]))).toBeNull();
  });
  it("refuses plain text under a .gz name", () => {
    expect(gzipMismatch("reads_1.fastq.GZ", new TextEncoder().encode("@r1\nACGT\n+\nIIII\n"))).toMatch(/not gzip-compressed/);
  });
  it("leaves other names and empty files to their own checks", () => {
    expect(gzipMismatch("table.csv", new TextEncoder().encode("a,b"))).toBeNull();
    expect(gzipMismatch("reads.fastq.gz", new Uint8Array())).toBeNull();
  });
});
