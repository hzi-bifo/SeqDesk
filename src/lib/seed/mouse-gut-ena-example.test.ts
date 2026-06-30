import { describe, expect, it } from "vitest";

import {
  MOUSE_GUT_RUNS,
  MOUSE_GUT_ORDER_NUMBER,
  MOUSE_GUT_STUDY_ALIAS,
  buildMouseGutManifest,
} from "./mouse-gut-ena-example";
import { MOUSE_GUT_READS, MOUSE_GUT_BASE } from "./templates";

// Pure (network-free) checks on the one piece of logic not inherited from the mag-smoke pattern:
// deriving the eight ENA runs + their deterministic FASTQ URLs from the shared accession map.

describe("mouse-gut PRJDB6165 example dataset", () => {
  it("derives exactly the eight runs from the shared MOUSE_GUT_READS map", () => {
    expect(MOUSE_GUT_RUNS).toHaveLength(8);
    expect(MOUSE_GUT_RUNS).toHaveLength(Object.keys(MOUSE_GUT_READS).length);
    // every run accession + its sample alias come straight from the single source of truth
    for (const run of MOUSE_GUT_RUNS) {
      expect(MOUSE_GUT_READS[run.sampleAlias].run).toBe(run.run);
    }
  });

  it("builds the deterministic ENA FASTQ URLs from the run accession", () => {
    const first = MOUSE_GUT_RUNS.find((r) => r.run === "DRR099973");
    expect(first?.r1).toBe(
      "https://ftp.sra.ebi.ac.uk/vol1/fastq/DRR099/DRR099973/DRR099973_1.fastq.gz",
    );
    expect(first?.r2).toBe(
      "https://ftp.sra.ebi.ac.uk/vol1/fastq/DRR099/DRR099973/DRR099973_2.fastq.gz",
    );
    // R1/R2 always differ and use the six-character accession prefix as the first dir level
    for (const run of MOUSE_GUT_RUNS) {
      expect(run.r1).not.toBe(run.r2);
      expect(run.r1).toContain(`/${run.run.slice(0, 6)}/${run.run}/`);
      expect(run.r1.endsWith("_1.fastq.gz")).toBe(true);
      expect(run.r2.endsWith("_2.fastq.gz")).toBe(true);
    }
  });

  it("produces a manifest with eight paired samples carrying the mouse-gut taxonomy", () => {
    const manifest = buildMouseGutManifest();
    expect(manifest.order.orderNumber).toBe(MOUSE_GUT_ORDER_NUMBER);
    expect(manifest.study.alias).toBe(MOUSE_GUT_STUDY_ALIAS);
    expect(manifest.samples).toHaveLength(8);
    for (const sample of manifest.samples) {
      expect(sample.file1).toMatch(/^reads\/MGB-\d+_R1\.fastq\.gz$/);
      expect(sample.file2).toMatch(/^reads\/MGB-\d+_R2\.fastq\.gz$/);
      expect(sample.file1).not.toBe(sample.file2);
      expect(sample.scientificName).toBe(MOUSE_GUT_BASE.scientificName);
      expect(sample.taxId).toBe(MOUSE_GUT_BASE.taxId);
      // sampleId is the genericized alias so pipeline outputs name files by it
      expect(sample.sampleId).toMatch(/^MGB-\d+$/);
    }
    // sample ids are unique
    const ids = manifest.samples.map((s) => s.sampleId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
