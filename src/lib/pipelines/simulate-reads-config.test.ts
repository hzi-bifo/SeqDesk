import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  READ_CLEANING_PIPELINE_ID,
  getSimulateReadsConfigIssues,
  getPipelineRunConfigIssues,
  normalizeSimulateReadsConfig,
} from "./simulate-reads-config";
import { getReadCleaningPathIssues } from "./read-cleaning-path-validation";

const SIMULATE_READS_PIPELINE_ID_FALLBACK = "simulate-reads";

describe("simulate-reads-config", () => {
  it("fills missing values with defaults", () => {
    expect(normalizeSimulateReadsConfig()).toEqual({
      simulationMode: "auto",
      mode: "shortReadPaired",
      readCount: 1000,
      readLength: 150,
      replaceExisting: true,
      qualityProfile: "standard",
      insertMean: 350,
      insertStdDev: 30,
      seed: null,
      templateDir: "",
    });
  });

  it("clamps and coerces numeric values based on long-read mode", () => {
    expect(
      normalizeSimulateReadsConfig({
        mode: "longRead",
        readCount: 999999,
        readLength: "120",
        insertMean: 150,
        insertStdDev: 5000,
        seed: "42",
        replaceExisting: "false",
      }),
    ).toMatchObject({
      mode: "longRead",
      readCount: 5000,
      readLength: 500,
      insertMean: 1020,
      insertStdDev: 520,
      seed: 42,
      replaceExisting: false,
    });
  });

  it("does not invert the insertMean clamp range for long reads", () => {
    const result = normalizeSimulateReadsConfig({
      mode: "longRead",
      readLength: 30000,
      insertMean: 999999,
    });

    // readLength clamps to 30000 -> minInsertMean = 30000*2+20 = 60020.
    // Old code passed max=5000 (< min) so clampInt returned 5000 (> its own max).
    // Fixed code uses max=Math.max(minInsertMean, 5000) so the value never
    // drops below the minimum.
    expect(result.readLength).toBe(30000);
    expect(result.insertMean).toBe(60020);
  });

  it("reports unsupported template plus long-read combinations", () => {
    const config = normalizeSimulateReadsConfig({
      simulationMode: "template",
      mode: "longRead",
    });

    expect(getSimulateReadsConfigIssues(config)).toEqual([
      "Template simulation is not supported for long-read mode. Choose synthetic or auto mode, or switch to a short-read mode.",
    ]);
  });

  it("validates read-cleaning classifier configuration", () => {
    expect(getPipelineRunConfigIssues(READ_CLEANING_PIPELINE_ID, {})).toEqual([
      "Read Cleaning needs a Kraken2 database path when Kraken2 classification is enabled.",
    ]);

    expect(
      getPipelineRunConfigIssues(READ_CLEANING_PIPELINE_ID, {
        classificationKraken2: false,
        classificationBbduk: false,
      }),
    ).toEqual([
      "Read Cleaning needs at least one contaminant classifier enabled.",
    ]);

    expect(
      getPipelineRunConfigIssues(READ_CLEANING_PIPELINE_ID, {
        classificationKraken2: false,
        classificationBbduk: true,
      }),
    ).toEqual([
      "Read Cleaning needs a BBDuk reference FASTA when BBDuk classification is enabled.",
    ]);

    expect(
      getPipelineRunConfigIssues(READ_CLEANING_PIPELINE_ID, {
        classificationKraken2: true,
        kraken2Db: "/refs/kraken2-human",
      }),
    ).toEqual([]);
  });
});

describe("getReadCleaningPathIssues", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "readclean-paths-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns nothing for non read-cleaning pipelines", () => {
    expect(
      getReadCleaningPathIssues(SIMULATE_READS_PIPELINE_ID_FALLBACK, {}, "local"),
    ).toEqual({ issues: [], warnings: [] });
  });

  it("accepts a complete local Kraken2 database directory", () => {
    const dbDir = join(tmp, "k2db");
    mkdirSync(dbDir);
    for (const file of ["hash.k2d", "opts.k2d", "taxo.k2d"]) {
      writeFileSync(join(dbDir, file), "x");
    }

    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationKraken2: true, kraken2Db: dbDir },
      "local",
    );

    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("flags a missing local Kraken2 database path", () => {
    const missing = join(tmp, "does-not-exist");

    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationKraken2: true, kraken2Db: missing },
      "local",
    );

    expect(result.issues).toEqual([
      `Kraken2 database path does not exist or is not readable: ${missing}`,
    ]);
  });

  it("flags a local Kraken2 directory missing the expected index files", () => {
    const dbDir = join(tmp, "k2db-partial");
    mkdirSync(dbDir);
    writeFileSync(join(dbDir, "hash.k2d"), "x");

    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationKraken2: true, kraken2Db: dbDir },
      "local",
    );

    expect(result.issues).toEqual([
      `Kraken2 database at ${dbDir} is missing expected files: opts.k2d, taxo.k2d`,
    ]);
  });

  it("flags a missing local BBDuk reference file", () => {
    const missing = join(tmp, "no-ref.fasta");

    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationBbduk: true, bbdukReference: missing },
      "local",
    );

    expect(result.issues).toEqual([
      `BBDuk reference FASTA does not exist or is not readable: ${missing}`,
    ]);
  });

  it("accepts a local BBDuk reference file", () => {
    const ref = join(tmp, "ref.fasta");
    writeFileSync(ref, ">seq\nACGT\n");

    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationBbduk: true, bbdukReference: ref },
      "local",
    );

    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns (does not block) on absolute compute-node paths in slurm mode", () => {
    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      {
        classificationKraken2: true,
        kraken2Db: "/cluster/refs/kraken2-human",
        classificationBbduk: true,
        bbdukReference: "/cluster/refs/contaminants.fasta",
      },
      "slurm",
    );

    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it("blocks relative paths in slurm mode", () => {
    const result = getReadCleaningPathIssues(
      READ_CLEANING_PIPELINE_ID,
      { classificationKraken2: true, kraken2Db: "refs/kraken2-human" },
      "slurm",
    );

    expect(result.issues).toEqual([
      "Kraken2 database path must be absolute for remote execution: refs/kraken2-human",
    ]);
  });
});
