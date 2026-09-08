import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { afterEach, beforeEach, expect, it } from "vitest";
import { extractBenchmarkReads, prepareBenchmarkReads, pairedReadIdentity } from "./prepare-benchmark-reads";

// Local internal format fixtures, not simulated CAMI API responses or datasets.
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-format-test-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const pair = "@local/1\nACGT\n+\n!!!!\n@local/2\nTGCA\n+\n####\n";
async function archive(entries: { name: string; body: Buffer; type?: string }[]) {
  const tar = pack();
  const chunks: Buffer[] = [];
  const collect = (async () => { for await (const chunk of tar) chunks.push(chunk); })();
  for (const entry of entries) tar.entry({ name: entry.name, type: entry.type }, entry.body);
  tar.finalize(); await collect;
  const file = path.join(root, "local.tar.gz");
  await fs.writeFile(file, gzipSync(Buffer.concat(chunks))); return file;
}
it("extracts only read inputs, splits and validates interleaved pairs", async () => {
  const file = await archive([{ name: "local/reads_mapping.tsv.gz", body: gzipSync("internal truth") }, { name: "local/anonymous_reads.fq.gz", body: gzipSync(pair) }]);
  const extracted = await extractBenchmarkReads(file, path.join(root, "reads"));
  const reads = await prepareBenchmarkReads(extracted, "short");
  expect(reads).toHaveLength(2);
  expect(gunzipSync(await fs.readFile(reads[0].path)).toString()).toBe("@local/1\nACGT\n+\n!!!!\n");
  expect(gunzipSync(await fs.readFile(reads[1].path)).toString()).toBe("@local/2\nTGCA\n+\n####\n");
  expect(await fs.readdir(path.join(root, "reads"))).toEqual(["R1.fastq.gz", "R2.fastq.gz"]);
  expect(reads[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(reads[0].md5).toMatch(/^[a-f0-9]{32}$/);
});
it.each(["../anonymous_reads.fq.gz", "/anonymous_reads.fq.gz", "C:\\anonymous_reads.fq.gz"])("rejects unsafe archive path %s", async name => {
  await expect(extractBenchmarkReads(await archive([{ name, body: gzipSync(pair) }]), path.join(root, "reads"))).rejects.toThrow();
});
it("rejects duplicate read files and missing reads", async () => {
  const file = await archive([{ name: "a/anonymous_reads.fq.gz", body: gzipSync(pair) }, { name: "b/anonymous_reads.fq.gz", body: gzipSync(pair) }]);
  await expect(extractBenchmarkReads(file, path.join(root, "reads"))).rejects.toThrow(/Multiple/);
});
it("rejects links, missing reads and truncated archives", async () => {
  const link = await archive([{ name: "link", type: "symlink", body: Buffer.alloc(0) }]);
  await expect(extractBenchmarkReads(link, path.join(root, "link"))).rejects.toThrow();
  const missing = await archive([{ name: "notes.txt", body: Buffer.from("internal") }]);
  await expect(extractBenchmarkReads(missing, path.join(root, "missing"))).rejects.toThrow(/expected anonymous/);
  await fs.writeFile(missing, (await fs.readFile(missing)).subarray(0, 30));
  await expect(extractBenchmarkReads(missing, path.join(root, "truncated"))).rejects.toThrow();
});
it("honors cancellation before processing reads", async () => {
  const file = path.join(root, "input.fastq.gz"); await fs.writeFile(file, gzipSync(pair));
  const controller = new AbortController(); controller.abort();
  await expect(prepareBenchmarkReads(file, "short", controller.signal)).rejects.toThrow();
});
it.each([pair.replace("@local/2", "@other/2"), pair.slice(0, pair.indexOf("@local/2"))])("rejects incomplete or mismatched pairs", async data => {
  const file = path.join(root, "input.fastq.gz"); await fs.writeFile(file, gzipSync(data));
  await expect(prepareBenchmarkReads(file, "short")).rejects.toThrow();
});
it("preserves validated long reads without inventing mates", async () => {
  const file = path.join(root, "input.fastq.gz"); await fs.writeFile(file, gzipSync("@long\nACGT\n+\n!!!!\n"));
  expect(await prepareBenchmarkReads(file, "long")).toHaveLength(1);
  expect(() => pairedReadIdentity("@local/2", 1)).toThrow();
});
