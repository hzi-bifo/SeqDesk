import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverTemplatePairs,
  loadTemplateReads,
  resolveSimulationSource,
} from "./generate-reads.mjs";

const tempDirs: string[] = [];

async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-generate-reads-"));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeFastqGz(filePath: string, sequences: string[]) {
  const lines = sequences.flatMap((sequence, index) => [
    `@TPL:${index + 1}`,
    sequence,
    "+",
    "I".repeat(sequence.length),
  ]);
  await fs.writeFile(filePath, gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8")));
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      fs.rm(tempDir, { recursive: true, force: true }),
    ),
  );
});

describe("simulate-reads generate-reads template discovery", () => {
  it("accepts common gzipped Illumina R1/R2 template names", async () => {
    const templateDir = await createTempDir();
    const alphaR1 = path.join(templateDir, "alpha_R1_001.fastq.gz");
    const alphaR2 = path.join(templateDir, "alpha_R2_001.fastq.gz");
    const r1Only = path.join(templateDir, "r1_only_R1_001.fastq.gz");

    await writeFastqGz(alphaR1, ["ACGTAC"]);
    await writeFastqGz(alphaR2, ["GTACGT"]);
    await writeFastqGz(r1Only, ["AAAAAA"]);

    await expect(discoverTemplatePairs(templateDir, "shortReadPaired")).resolves.toEqual([
      {
        label: "alpha",
        read1Path: alphaR1,
        read2Path: alphaR2,
      },
    ]);

    await expect(discoverTemplatePairs(templateDir, "shortReadSingle")).resolves.toEqual([
      {
        label: "alpha",
        read1Path: alphaR1,
        read2Path: alphaR2,
      },
      {
        label: "r1_only",
        read1Path: r1Only,
        read2Path: null,
      },
    ]);
  });

  it("replays R1-only templates for single-end mode", async () => {
    const templateDir = await createTempDir();
    const singleR1 = path.join(templateDir, "single_R1_001.fastq.gz");
    await writeFastqGz(singleR1, ["ACGTAC", "TTGGCC"]);

    const source = await resolveSimulationSource({
      simulationMode: "template",
      mode: "shortReadSingle",
      templateDir,
      dataBasePath: "",
    });

    expect(source.modeUsed).toBe("template");
    expect(source.templatePair).toHaveLength(1);

    const generated = await loadTemplateReads({
      templatePair: source.templatePair[0],
      mode: "shortReadSingle",
      sampleId: "SINGLE_A",
    });

    expect(generated.read1).toEqual(await fs.readFile(singleR1));
    expect(generated.read2).toBeNull();
    expect(generated.readCount1).toBe(2);
    expect(generated.readCount2).toBeNull();
    expect(generated.readLengthObserved).toBe(6);
    expect(generated.templateLabel).toBe("single");
  });
});
