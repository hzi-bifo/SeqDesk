import { describe, expect, it } from "vitest";
import {
  isFastqExtension,
  normalizeBarcode,
  parseBarcodeFromPath,
  parseMinknowFastqPath,
  parseMinknowFilename,
} from "./minion-paths";

describe("normalizeBarcode", () => {
  it("recognises canonical barcodeNN", () => {
    expect(normalizeBarcode("barcode01")).toBe("barcode01");
    expect(normalizeBarcode("Barcode05")).toBe("barcode05");
    expect(normalizeBarcode("barcode001")).toBe("barcode001");
  });
  it("recognises BCNN shorthand", () => {
    expect(normalizeBarcode("BC07")).toBe("barcode07");
  });
  it("returns 'unclassified' for unclassified", () => {
    expect(normalizeBarcode("unclassified")).toBe("unclassified");
  });
  it("returns null for non-barcode names", () => {
    expect(normalizeBarcode("my-sample")).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });
});

describe("parseMinknowFilename", () => {
  it("parses a fully-qualified barcoded filename", () => {
    const r = parseMinknowFilename("FAS00000_pass_barcode01_abc12345_def67890_4.fastq.gz");
    expect(r).toEqual({
      flowCellId: "FAS00000",
      basecallStatus: "pass",
      duplex: false,
      alias: "barcode01",
      shortProtocolRunId: "abc12345",
      shortRunId: "def67890",
      batchNumber: 4,
    });
  });

  it("parses a non-barcoded filename (no alias)", () => {
    const r = parseMinknowFilename("FAS00000_pass_abc12345_def67890_0.fastq.gz");
    expect(r.flowCellId).toBe("FAS00000");
    expect(r.basecallStatus).toBe("pass");
    expect(r.alias).toBeNull();
    expect(r.batchNumber).toBe(0);
  });

  it("recognises duplex marker", () => {
    const r = parseMinknowFilename("FAS00000_pass_duplex_barcode02_abc12345_def67890_1.fastq.gz");
    expect(r.duplex).toBe(true);
    expect(r.alias).toBe("barcode02");
    expect(r.basecallStatus).toBe("pass");
  });

  it("recognises fail and skip status", () => {
    expect(parseMinknowFilename("FAS00000_fail_barcode02_abc12345_def67890_2.fastq.gz").basecallStatus).toBe("fail");
    expect(parseMinknowFilename("FAS00000_skip_abc12345_def67890_3.fastq.gz").basecallStatus).toBe("skip");
  });

  it("returns nulls for unrecognised filenames", () => {
    const r = parseMinknowFilename("random.fastq.gz");
    expect(r.flowCellId).toBeNull();
    expect(r.basecallStatus).toBeNull();
  });
});

describe("parseMinknowFastqPath", () => {
  it("parses a barcoded pass file", () => {
    const r = parseMinknowFastqPath("/data/group/sample/run123/fastq_pass/barcode01/FAS00000_pass_barcode01_abc12345_def67890_0.fastq.gz");
    expect(r).toMatchObject({
      tier: "pass",
      barcode: "barcode01",
      barcodeAlias: null,
      hasBarcodeDir: true,
    });
    expect(r?.filename.flowCellId).toBe("FAS00000");
  });

  it("treats fastq_fail dir as fail tier", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_fail/barcode02/x.fastq.gz");
    expect(r?.tier).toBe("fail");
    expect(r?.barcode).toBe("barcode02");
  });

  it("treats fastq_skip dir as skip tier", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_skip/x.fastq.gz");
    expect(r?.tier).toBe("skip");
    expect(r?.hasBarcodeDir).toBe(false);
  });

  it("recognises unclassified", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_pass/unclassified/x.fastq.gz");
    expect(r?.barcode).toBe("unclassified");
  });

  it("falls back to barcodeAlias when subdir name is not a barcode", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_pass/my-sample-alias/x.fastq.gz");
    expect(r?.barcode).toBeNull();
    expect(r?.barcodeAlias).toBe("my-sample-alias");
    expect(r?.hasBarcodeDir).toBe(true);
  });

  it("recognises non-barcoded layout (file directly under fastq_pass)", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_pass/FAS00000_pass_abc12345_def67890_0.fastq.gz");
    expect(r?.tier).toBe("pass");
    expect(r?.barcode).toBeNull();
    expect(r?.barcodeAlias).toBeNull();
    expect(r?.hasBarcodeDir).toBe(false);
  });

  it("handles BC07 shorthand directories", () => {
    const r = parseMinknowFastqPath("/data/run/fastq_pass/BC07/x.fastq.gz");
    expect(r?.barcode).toBe("barcode07");
  });

  it("returns null for paths with no MinKNOW tier dir", () => {
    expect(parseMinknowFastqPath("/data/random/file.fastq.gz")).toBeNull();
    expect(parseMinknowFastqPath("file.fastq.gz")).toBeNull();
  });

  it("works with data-pooling layout (no run subfolder)", () => {
    // Data pooling can collapse path; still finds the tier dir.
    const r = parseMinknowFastqPath("/data/group/sample/fastq_pass/barcode03/file.fastq.gz");
    expect(r?.tier).toBe("pass");
    expect(r?.barcode).toBe("barcode03");
  });
});

describe("isFastqExtension", () => {
  it("accepts .fastq.gz, .fq.gz, .fastq, .fq", () => {
    expect(isFastqExtension("a.fastq.gz")).toBe(true);
    expect(isFastqExtension("a.fq.gz")).toBe(true);
    expect(isFastqExtension("a.fastq")).toBe(true);
    expect(isFastqExtension("a.fq")).toBe(true);
  });
  it("rejects others", () => {
    expect(isFastqExtension("a.txt")).toBe(false);
    expect(isFastqExtension("a.bam")).toBe(false);
  });
});

describe("parseBarcodeFromPath (legacy wrapper)", () => {
  it("still returns the legacy shape for the common case", () => {
    expect(parseBarcodeFromPath("/data/r/fastq_pass/barcode01/x.fastq.gz")).toEqual({
      barcode: "barcode01",
      pass: true,
    });
  });
  it("uses no_barcode for non-barcoded runs", () => {
    expect(parseBarcodeFromPath("/data/r/fastq_pass/x.fastq.gz")).toEqual({
      barcode: "no_barcode",
      pass: true,
    });
  });
  it("returns null for skip tier (legacy callers ignored those)", () => {
    expect(parseBarcodeFromPath("/data/r/fastq_skip/x.fastq.gz")).toBeNull();
  });
});
