import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateFastqFile } from "./fastq-validation";

let root: string;
const valid = "@local-test\nACGT\n+\nIIII\n";
describe("local FASTQ validation", () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-fastq-validation-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  async function check(data: string | Buffer, gzip = false, maxExpandedBytes = 1024) {
    const file = path.join(root, "local-test.fastq");
    await fs.writeFile(file, data);
    return validateFastqFile(file, { gzip, maxExpandedBytes });
  }
  it("validates plain and gzipped local reads", async () => {
    expect(await check(valid)).toMatchObject({ records: 1 });
    expect(await check(gzipSync(valid), true)).toMatchObject({ records: 1 });
  });
  it.each(["", "<html>error</html>", "@read\nACGT\n+\n", "@read\nACGT\n+\nIII\n", "@read\nACGT\nwrong\nIIII\n"])("rejects invalid content %j", async (data) => {
    await expect(check(data)).rejects.toThrow();
  });
  it("rejects a truncated gzip stream", async () => {
    await expect(check(gzipSync(valid).subarray(0, -6), true)).rejects.toThrow();
  });
  it("bounds expanded content", async () => {
    await expect(check(gzipSync(valid.repeat(10)), true, 50)).rejects.toThrow("expanded size");
  });
  it("handles missing input without an unhandled stream error", async () => {
    await expect(validateFastqFile(path.join(root, "missing"), { gzip: true, maxExpandedBytes: 1024 })).rejects.toThrow();
  });
});
