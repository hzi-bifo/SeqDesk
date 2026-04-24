import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { gunzipSync, gzipSync } from "zlib";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("./generate-reads.mjs", import.meta.url));

function buildFastq(sampleId: string, mate: "1" | "2", sequences: string[]): Buffer {
  const lines: string[] = [];
  for (const [index, sequence] of sequences.entries()) {
    lines.push(
      `@TEMPLATE:${sampleId}:${index + 1} ${mate}:N:0:${sampleId}`,
      sequence,
      "+",
      "I".repeat(sequence.length),
    );
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

async function runGenerator(
  workdir: string,
  args: string[],
): Promise<{ manifest: Record<string, unknown>; summary: string; read1: Buffer; read2: Buffer | null }> {
  const readsDir = path.join(workdir, "reads");
  const manifestPath = path.join(workdir, "manifest.json");
  const summaryPath = path.join(workdir, "summary.tsv");

  await execFileAsync(process.execPath, [
    scriptPath,
    "--sample-id",
    "SAMPLE_A",
    "--order-id",
    "ORDER_1",
    "--reads-dir",
    readsDir,
    "--manifest-path",
    manifestPath,
    "--summary-path",
    summaryPath,
    ...args,
  ]);

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const summary = await fs.readFile(summaryPath, "utf8");
  const read1 = await fs.readFile(path.join(readsDir, "SAMPLE_A_R1.fastq.gz"));
  const read2Path = path.join(readsDir, "SAMPLE_A_R2.fastq.gz");
  const read2 = await fs.readFile(read2Path).catch(() => null);

  return { manifest, summary, read1, read2 };
}

describe("generate-reads.mjs", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("produces deterministic seeded synthetic output and records provenance fields", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-sim-reads-"));
    const runOneDir = path.join(tempDir, "run-1");
    const runTwoDir = path.join(tempDir, "run-2");
    await fs.mkdir(runOneDir, { recursive: true });
    await fs.mkdir(runTwoDir, { recursive: true });

    const runOne = await runGenerator(runOneDir, [
      "--simulation-mode",
      "synthetic",
      "--mode",
      "shortReadPaired",
      "--read-count",
      "4",
      "--read-length",
      "90",
      "--quality-profile",
      "highAccuracy",
      "--insert-mean",
      "420",
      "--insert-std-dev",
      "25",
      "--seed",
      "77",
    ]);
    const runTwo = await runGenerator(runTwoDir, [
      "--simulation-mode",
      "synthetic",
      "--mode",
      "shortReadPaired",
      "--read-count",
      "4",
      "--read-length",
      "90",
      "--quality-profile",
      "highAccuracy",
      "--insert-mean",
      "420",
      "--insert-std-dev",
      "25",
      "--seed",
      "77",
    ]);

    expect(runOne.manifest).toMatchObject({
      simulationModeRequested: "synthetic",
      simulationModeUsed: "synthetic",
      qualityProfile: "highAccuracy",
      insertMean: 420,
      insertStdDev: 25,
      seed: 77,
      readCount1: 4,
      readCount2: 4,
      readLength: 90,
    });
    expect(runOne.read1.equals(runTwo.read1)).toBe(true);
    expect(runOne.read2?.equals(runTwo.read2 as Buffer)).toBe(true);
    expect(runOne.summary).toContain("simulation_mode_used");
    expect(runOne.summary).toContain("highAccuracy");
  });

  it("replays template FASTQ pairs and preserves their compressed bytes", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-sim-template-"));
    const templateDir = path.join(tempDir, "templates");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(templateDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    const templateRead1 = gzipSync(buildFastq("TPL", "1", ["ACGTAC", "TTGGCC"]));
    const templateRead2 = gzipSync(buildFastq("TPL", "2", ["GTACGT", "GGCCAA"]));
    await fs.writeFile(path.join(templateDir, "template_1_1.fastq.gz"), templateRead1);
    await fs.writeFile(path.join(templateDir, "template_1_2.fastq.gz"), templateRead2);

    const run = await runGenerator(runDir, [
      "--simulation-mode",
      "template",
      "--mode",
      "shortReadPaired",
      "--template-dir",
      templateDir,
    ]);

    expect(run.manifest).toMatchObject({
      simulationModeRequested: "template",
      simulationModeUsed: "template",
      templateLabel: "template_1",
      templateDir,
      readCount1: 2,
      readCount2: 2,
      readLength: 6,
    });
    expect(run.read1.equals(templateRead1)).toBe(true);
    expect(run.read2?.equals(templateRead2)).toBe(true);
    expect(gunzipSync(run.read1).toString("utf8")).toContain("@TEMPLATE:TPL:1");
  });

  it("fails fast when template mode is requested for long-read simulation", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-sim-invalid-"));

    await expect(
      runGenerator(tempDir, [
        "--simulation-mode",
        "template",
        "--mode",
        "longRead",
      ]),
    ).rejects.toThrow(/Template simulation is not supported for long-read mode/);
  });
});
