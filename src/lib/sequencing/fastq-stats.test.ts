import { describe, it, expect } from "vitest";
import { promises as fs, existsSync } from "fs";
import { createWriteStream } from "fs";
import { createGzip } from "zlib";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { countFastqStats } from "./fastq-stats";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "fastq_pass");
const EXPECTED_PATH = path.join(__dirname, "__fixtures__", "expected.json");

/**
 * Write a synthetic FASTQ with `reads` records, each `seqLen` bp long. Returns
 * the path. Plain (.fastq) or gzipped (.fastq.gz) based on the suffix.
 */
async function writeSyntheticFastq(
  filePath: string,
  reads: number,
  seqLen: number,
): Promise<void> {
  const seq = "A".repeat(seqLen);
  const qual = "I".repeat(seqLen);
  const lines: string[] = [];
  for (let i = 0; i < reads; i++) {
    lines.push(`@read_${i}`, seq, "+", qual);
  }
  const body = lines.join("\n") + "\n";
  if (filePath.endsWith(".gz")) {
    const src = Readable.from(body);
    const gz = createGzip();
    const out = createWriteStream(filePath);
    await pipeline(src, gz, out);
  } else {
    await fs.writeFile(filePath, body);
  }
}

describe("countFastqStats — synthetic", () => {
  it("counts reads and bases in a plain .fastq", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fastq-stats-"));
    try {
      const p = path.join(dir, "plain.fastq");
      await writeSyntheticFastq(p, 42, 200);
      const stats = await countFastqStats(p);
      expect(stats).not.toBeNull();
      expect(stats!.reads).toBe(42);
      expect(stats!.bases).toBe(42 * 200);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("counts reads and bases in a .fastq.gz", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fastq-stats-"));
    try {
      const p = path.join(dir, "gz.fastq.gz");
      await writeSyntheticFastq(p, 17, 350);
      const stats = await countFastqStats(p);
      expect(stats).not.toBeNull();
      expect(stats!.reads).toBe(17);
      expect(stats!.bases).toBe(17 * 350);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the file is truncated mid-record", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fastq-stats-"));
    try {
      const p = path.join(dir, "truncated.fastq");
      // 3 lines = 0.75 records — sanity check should fail.
      await fs.writeFile(p, "@hdr\nACGT\n+\n");
      const stats = await countFastqStats(p);
      expect(stats).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a missing file", async () => {
    const stats = await countFastqStats("/definitely/does/not/exist.fastq");
    expect(stats).toBeNull();
  });
});

/**
 * Walk a directory and yield every FASTQ file path.
 */
async function* walkFastq(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFastq(full);
    } else if (
      entry.isFile() &&
      (full.endsWith(".fastq") ||
        full.endsWith(".fq") ||
        full.endsWith(".fastq.gz") ||
        full.endsWith(".fq.gz"))
    ) {
      yield full;
    }
  }
}

describe("countFastqStats — real-data fixture", () => {
  const hasFixture = existsSync(FIXTURE_DIR);

  it.runIf(hasFixture)("every FASTQ in __fixtures__/fastq_pass is parseable", async () => {
    const failures: string[] = [];
    for await (const file of walkFastq(FIXTURE_DIR)) {
      const stats = await countFastqStats(file);
      if (!stats) {
        failures.push(file);
      }
    }
    expect(failures, `unparseable FASTQs:\n  ${failures.join("\n  ")}`).toEqual([]);
  });

  it.runIf(hasFixture && existsSync(EXPECTED_PATH))(
    "per-barcode totals match expected.json",
    async () => {
      const expected = JSON.parse(await fs.readFile(EXPECTED_PATH, "utf8")) as Record<
        string,
        { reads: number; bases: number }
      >;
      const got = new Map<string, { reads: number; bases: number }>();
      for await (const file of walkFastq(FIXTURE_DIR)) {
        // Barcode is the parent-of-parent dir under fastq_pass/<barcode>/<file>.
        const barcode = path.basename(path.dirname(file));
        const stats = await countFastqStats(file);
        if (!stats) throw new Error(`failed to parse fixture ${file}`);
        const cur = got.get(barcode) ?? { reads: 0, bases: 0 };
        cur.reads += stats.reads;
        cur.bases += stats.bases;
        got.set(barcode, cur);
      }
      for (const [barcode, exp] of Object.entries(expected)) {
        const actual = got.get(barcode);
        expect(actual, `no fixture data for ${barcode}`).toBeDefined();
        expect(actual!.reads).toBe(exp.reads);
        expect(actual!.bases).toBe(exp.bases);
      }
    },
  );

  it.runIf(!hasFixture)("[fixture missing — see __fixtures__/README.md]", () => {
    // This test is a placeholder so vitest shows the regression suite even when
    // no fixture is present. Drop a real fastq_pass/ tree into __fixtures__/ to
    // activate the real coverage.
    expect(true).toBe(true);
  });
});
