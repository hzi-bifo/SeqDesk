import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractBenchmarkReads, prepareBenchmarkReads } from "./prepare-benchmark-reads";

// Recheck a previously downloaded real archive with current extraction code.
// The source is read-only; only this test's mkdtemp output is removed.
describe.runIf(Boolean(process.env.SEQDESK_CAMI_LOCAL_ARCHIVE))("real CAMI archive preparation", () => {
  it("extracts and validates the full saved marine short-read sample", async () => {
    const archive = process.env.SEQDESK_CAMI_LOCAL_ARCHIVE!;
    const expected = Number(process.env.SEQDESK_CAMI_SOURCE_BYTES);
    if (!Number.isSafeInteger(expected) || expected < 1 || expected > 6 * 1024 ** 3 || (await fs.stat(archive)).size !== expected) throw new Error("Saved real archive does not match the verified source size");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-cami-preparation-"));
    try {
      const file = await extractBenchmarkReads(archive, path.join(root, "reads"));
      console.info("Current extractor accepted real CAMI archive");
      const reads = await prepareBenchmarkReads(file, "short");
      expect(reads).toHaveLength(2);
      expect(reads[0].records).toBeGreaterThan(0);
      expect(reads[0].records).toBe(reads[1].records);
      expect(reads.every(read => /^[a-f0-9]{64}$/.test(read.sha256))).toBe(true);
      console.info(`Validated ${reads[0].records} real read pairs`);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 1_800_000);
});
