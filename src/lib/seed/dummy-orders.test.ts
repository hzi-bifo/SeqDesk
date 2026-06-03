import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSimulatedFastq } from "@/lib/simulation/fastq";

import {
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_WGS,
} from "./templates";
import {
  buildDummySeedDataset,
  DEFAULT_SYNTHETIC_READ_COUNT,
  DEFAULT_SYNTHETIC_READ_LENGTH,
  resolveSyntheticReadSize,
  type DummyOrderSpecWithLink,
} from "./dummy-orders";

function build(
  overrides: Partial<Parameters<typeof buildDummySeedDataset>[0]> = {}
) {
  return buildDummySeedDataset({
    ownerUserId: "user-1",
    dataBasePath: "/tmp/seqdesk",
    primaryPlatform: PLATFORM_ILLUMINA_NOVASEQ_WGS,
    ...overrides,
  });
}

const findOrder = (
  orders: DummyOrderSpecWithLink[],
  status: string,
  suffix: string
) => orders.find((o) => o.status === status && o.orderNumber.endsWith(suffix));

describe("dummy order seed dataset", () => {
  it("stores sequencing technology selections instead of legacy order platform values", () => {
    const dataset = build();

    expect(dataset.orders[0]).toMatchObject({
      platform: null,
      sequencingTechSelection: {
        technologyId: "illumina-novaseq",
        technologyName: "NovaSeq 6000/X",
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["single", "paired"],
      },
    });
  });

  it("captures long-read technology metadata for ONT dummy datasets", () => {
    const dataset = build({ primaryPlatform: PLATFORM_ONT_MINION_WGS });

    expect(dataset.orders[0].sequencingTechSelection).toMatchObject({
      technologyId: "ont-minion",
      platformFamily: "oxford-nanopore",
      readLengthClass: "long",
      supportedReadLayouts: ["single"],
    });
    expect(dataset.orders[0].platform).toBeNull();
  });

  it("generates on-disk reads for the DRAFT order's samples", () => {
    const dataset = build();
    const draftOrder = dataset.orders.find((o) => o.status === "DRAFT");

    expect(draftOrder).toBeDefined();
    expect(draftOrder!.samples.length).toBeGreaterThanOrEqual(2);
    for (const sample of draftOrder!.samples) {
      expect(sample.reads.length).toBeGreaterThan(0);
      // Every draft read file must be in the on-disk generation set.
      for (const read of sample.reads) {
        expect(
          dataset.sampleFastqTargets.some(
            (t) => t.file1Relative === read.file1Relative
          )
        ).toBe(true);
      }
    }
  });

  it("includes a single-end long-read order with no R2 files", () => {
    // Even though the primary platform is paired-end Illumina, the dedicated long-read
    // order must be single-end so single-end pipeline paths get exercised.
    const dataset = build();
    const longReadOrder = findOrder(dataset.orders, "SUBMITTED", "-003");

    expect(longReadOrder).toBeDefined();
    expect(longReadOrder!.sequencingTechSelection.platformFamily).toBe(
      "oxford-nanopore"
    );
    const reads = longReadOrder!.samples.flatMap((s) => s.reads);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.file2Relative).toBeNull();
    }
    // Their on-disk targets must be single-end too.
    const longReadFiles = new Set(reads.map((r) => r.file1Relative));
    for (const target of dataset.sampleFastqTargets) {
      if (longReadFiles.has(target.file1Relative)) {
        expect(target.pairedEnd).toBe(false);
        expect(target.file2Relative).toBeNull();
      }
    }
  });

  it("adds a study-scoped dataset whose samples carry on-disk reads", () => {
    const dataset = build();

    expect(dataset.studyScoped.title).not.toBe(dataset.study.title);
    const studyOrder = dataset.orders.find((o) => o.studyLink === "study");
    expect(studyOrder).toBeDefined();
    expect(studyOrder!.samples.length).toBeGreaterThanOrEqual(2);
    for (const sample of studyOrder!.samples) {
      expect(sample.reads.length).toBeGreaterThan(0);
      for (const read of sample.reads) {
        expect(
          dataset.sampleFastqTargets.some(
            (t) => t.file1Relative === read.file1Relative
          )
        ).toBe(true);
      }
    }
    // Exactly one order links to the primary study, one to the study-scoped study.
    expect(
      dataset.orders.filter((o) => o.studyLink === "primary").length
    ).toBe(1);
    expect(
      dataset.orders.filter((o) => o.studyLink === "study").length
    ).toBe(1);
  });

  it("produces dataClass-varied reads including raw + cleaned and an inactive superseded read", () => {
    const dataset = build();
    const allReads = dataset.orders.flatMap((o) =>
      o.samples.flatMap((s) => s.reads)
    );

    expect(allReads.some((r) => r.dataClass === "raw")).toBe(true);
    expect(allReads.some((r) => r.dataClass === "cleaned")).toBe(true);
    // At least one sample exposes an active "cleaned" read alongside an inactive
    // "raw" read (dataClass variety), honoring the one-active-read-per-sample
    // invariant enforced by the Read_one_active_per_sample partial unique index.
    const sampleWithVariety = dataset.orders
      .flatMap((o) => o.samples)
      .find(
        (s) =>
          s.reads.some((r) => r.dataClass === "cleaned" && r.isActive) &&
          s.reads.some((r) => r.dataClass === "raw" && !r.isActive)
      );
    expect(sampleWithVariety).toBeDefined();
    // And there is an inactive (superseded) read for the read-cleaning promotion path.
    expect(allReads.some((r) => !r.isActive)).toBe(true);
    // Invariant: a sample may have at most one active read (DB partial unique index).
    for (const sample of dataset.orders.flatMap((o) => o.samples)) {
      const activeCount = sample.reads.filter((r) => r.isActive).length;
      expect(activeCount).toBeLessThanOrEqual(1);
    }
    // Every read carries a valid dataClassSource provenance marker.
    for (const read of allReads) {
      expect(typeof read.dataClassSource).toBe("string");
      expect(read.dataClassSource.length).toBeGreaterThan(0);
    }
  });

  it("uses deterministic, unique sampleIndex seeds for distinct FASTQ files", () => {
    const dataset = build();
    const indices = dataset.sampleFastqTargets.map((t) => t.sampleIndex);
    expect(new Set(indices).size).toBe(indices.length);

    // Determinism: same options produce identical file targets.
    const again = build();
    expect(again.sampleFastqTargets).toEqual(dataset.sampleFastqTargets);
  });

  it("does not generate the same on-disk file twice", () => {
    const dataset = build();
    const files = dataset.sampleFastqTargets.map((t) => t.file1Relative);
    expect(new Set(files).size).toBe(files.length);
  });

  it("defaults synthetic read size to the historical hard-coded values", () => {
    const dataset = build();
    expect(dataset.syntheticReadCount).toBe(DEFAULT_SYNTHETIC_READ_COUNT);
    expect(dataset.syntheticReadLength).toBe(DEFAULT_SYNTHETIC_READ_LENGTH);
  });

  it("honours explicit synthetic read size options", () => {
    const dataset = build({
      syntheticReadCount: 5000,
      syntheticReadLength: 250,
    });
    expect(dataset.syntheticReadCount).toBe(5000);
    expect(dataset.syntheticReadLength).toBe(250);
  });

  it("drives the synthetic generator with the configured size (the run-seed wiring)", () => {
    const dataset = build({
      syntheticReadCount: 42,
      syntheticReadLength: 80,
    });
    const target = dataset.sampleFastqTargets[0];
    const reads = buildSimulatedFastq({
      sampleId: target.sampleId,
      sampleIndex: target.sampleIndex,
      readCount: dataset.syntheticReadCount,
      readLength: dataset.syntheticReadLength,
      pairedEnd: target.pairedEnd,
    });
    // 4 FASTQ lines per read.
    const read1Lines = reads.read1.toString("utf-8").trim().split("\n");
    expect(read1Lines.length).toBe(42 * 4);
    expect(read1Lines[1].length).toBe(80);
  });
});

describe("resolveSyntheticReadSize", () => {
  it("returns defaults when nothing is provided", () => {
    const result = resolveSyntheticReadSize({ env: {} });
    expect(result).toEqual({
      readCount: DEFAULT_SYNTHETIC_READ_COUNT,
      readLength: DEFAULT_SYNTHETIC_READ_LENGTH,
    });
  });

  it("reads SEQDESK_SEED_READ_COUNT / SEQDESK_SEED_READ_LENGTH env vars", () => {
    const result = resolveSyntheticReadSize({
      env: {
        SEQDESK_SEED_READ_COUNT: "20000",
        SEQDESK_SEED_READ_LENGTH: "300",
      },
    });
    expect(result).toEqual({ readCount: 20000, readLength: 300 });
  });

  it("prefers explicit options over env vars", () => {
    const result = resolveSyntheticReadSize({
      syntheticReadCount: 1234,
      syntheticReadLength: 99,
      env: {
        SEQDESK_SEED_READ_COUNT: "20000",
        SEQDESK_SEED_READ_LENGTH: "300",
      },
    });
    expect(result).toEqual({ readCount: 1234, readLength: 99 });
  });

  it("ignores invalid / non-positive values and falls back", () => {
    const result = resolveSyntheticReadSize({
      syntheticReadCount: -5,
      env: {
        SEQDESK_SEED_READ_LENGTH: "not-a-number",
      },
    });
    expect(result).toEqual({
      readCount: DEFAULT_SYNTHETIC_READ_COUNT,
      readLength: DEFAULT_SYNTHETIC_READ_LENGTH,
    });
  });

  it("floors fractional values", () => {
    const result = resolveSyntheticReadSize({
      syntheticReadCount: 1000.9,
      syntheticReadLength: 150.7,
      env: {},
    });
    expect(result).toEqual({ readCount: 1000, readLength: 150 });
  });
});

describe("resolveSyntheticReadSize via process.env", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.SEQDESK_SEED_READ_COUNT;
    delete process.env.SEQDESK_SEED_READ_LENGTH;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("falls back to process.env when no env override is passed", () => {
    process.env.SEQDESK_SEED_READ_COUNT = "777";
    process.env.SEQDESK_SEED_READ_LENGTH = "88";
    const result = resolveSyntheticReadSize();
    expect(result).toEqual({ readCount: 777, readLength: 88 });
  });
});
