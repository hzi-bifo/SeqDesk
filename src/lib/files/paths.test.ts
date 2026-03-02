import { describe, it, expect } from "vitest";
import {
  ensureWithinBase,
  toRelativePath,
  safeJoin,
  hasAllowedExtension,
  extractSampleIdentifier,
  isRead1File,
  isRead2File,
  getPairedFilePath,
} from "./paths";

describe("ensureWithinBase", () => {
  it("returns resolved path for valid child path", () => {
    const result = ensureWithinBase("/data", "samples/file.fastq.gz");
    expect(result).toBe("/data/samples/file.fastq.gz");
  });

  it("throws on path traversal with ..", () => {
    expect(() => ensureWithinBase("/data", "../etc/passwd")).toThrow(
      "Path traversal detected"
    );
  });

  it("allows the base path itself", () => {
    const result = ensureWithinBase("/data", ".");
    expect(result).toBe("/data");
  });

  it("throws when resolved path escapes base", () => {
    expect(() => ensureWithinBase("/data/samples", "../../etc")).toThrow();
  });
});

describe("toRelativePath", () => {
  it("converts absolute child path to relative", () => {
    expect(toRelativePath("/data", "/data/samples/file.fq")).toBe(
      "samples/file.fq"
    );
  });

  it("throws for path outside base", () => {
    expect(() => toRelativePath("/data", "/other/file.fq")).toThrow(
      "not under base path"
    );
  });

  it("returns empty string for base path itself", () => {
    expect(toRelativePath("/data", "/data")).toBe("");
  });
});

describe("safeJoin", () => {
  it("joins relative path safely", () => {
    expect(safeJoin("/data", "samples/file.fq.gz")).toBe(
      "/data/samples/file.fq.gz"
    );
  });

  it("throws on absolute paths", () => {
    expect(() => safeJoin("/data", "/etc/passwd")).toThrow(
      "Absolute paths not allowed"
    );
  });

  it("throws on paths with ..", () => {
    expect(() => safeJoin("/data", "samples/../../../etc")).toThrow(
      "Path traversal not allowed"
    );
  });
});

describe("hasAllowedExtension", () => {
  it("returns true for matching extension", () => {
    expect(
      hasAllowedExtension("sample.fastq.gz", [".fastq.gz", ".fq.gz"])
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasAllowedExtension("sample.FASTQ.GZ", [".fastq.gz"])).toBe(true);
  });

  it("returns false for non-matching extension", () => {
    expect(hasAllowedExtension("sample.bam", [".fastq.gz", ".fq.gz"])).toBe(
      false
    );
  });

  it("matches .fq.gz extension", () => {
    expect(hasAllowedExtension("sample.fq.gz", [".fq.gz"])).toBe(true);
  });

  it("returns false for empty allowed list", () => {
    expect(hasAllowedExtension("sample.fastq.gz", [])).toBe(false);
  });
});

describe("extractSampleIdentifier", () => {
  it("extracts identifier from standard Illumina filename", () => {
    expect(
      extractSampleIdentifier("SAMPLE001_S1_L001_R1_001.fastq.gz")
    ).toBe("SAMPLE001");
  });

  it("handles simple _R1/_R2 naming", () => {
    expect(extractSampleIdentifier("mysample_R1.fastq.gz")).toBe("mysample");
    expect(extractSampleIdentifier("mysample_R2.fq.gz")).toBe("mysample");
  });

  it("handles dot-separated read IDs", () => {
    expect(extractSampleIdentifier("mysample.R1.fastq")).toBe("mysample");
  });

  it("handles _1/_2 naming convention", () => {
    expect(extractSampleIdentifier("sample_1.fq.gz")).toBe("sample");
    expect(extractSampleIdentifier("sample_2.fq.gz")).toBe("sample");
  });

  it("returns full name when no read pattern matches", () => {
    expect(extractSampleIdentifier("singlefile.fastq.gz")).toBe("singlefile");
  });

  it("removes lane info _L001", () => {
    expect(extractSampleIdentifier("SAMPLE_L001_R1.fastq.gz")).toBe("SAMPLE");
  });

  it("removes sample number _S1", () => {
    expect(extractSampleIdentifier("SAMPLE_S12_L001_R1_001.fastq.gz")).toBe(
      "SAMPLE"
    );
  });
});

describe("isRead1File", () => {
  it("identifies _R1 files", () => {
    expect(isRead1File("sample_R1.fastq.gz")).toBe(true);
  });

  it("identifies .R1 files", () => {
    expect(isRead1File("sample.R1.fq.gz")).toBe(true);
  });

  it("identifies _1 files", () => {
    expect(isRead1File("sample_1.fastq.gz")).toBe(true);
  });

  it("returns false for R2 files", () => {
    expect(isRead1File("sample_R2.fastq.gz")).toBe(false);
  });

  it("returns false for non-read files", () => {
    expect(isRead1File("sample.fastq.gz")).toBe(false);
  });
});

describe("isRead2File", () => {
  it("identifies _R2 files", () => {
    expect(isRead2File("sample_R2.fastq.gz")).toBe(true);
  });

  it("identifies .R2 files", () => {
    expect(isRead2File("sample.R2.fq.gz")).toBe(true);
  });

  it("identifies _2 files", () => {
    expect(isRead2File("sample_2.fastq.gz")).toBe(true);
  });

  it("returns false for R1 files", () => {
    expect(isRead2File("sample_R1.fastq.gz")).toBe(false);
  });

  it("returns false for non-read files", () => {
    expect(isRead2File("sample.fastq.gz")).toBe(false);
  });
});

describe("getPairedFilePath", () => {
  it("returns R2 path from R1 input", () => {
    expect(getPairedFilePath("/data/sample_R1.fastq.gz")).toBe(
      "/data/sample_R2.fastq.gz"
    );
  });

  it("returns R1 path from R2 input", () => {
    expect(getPairedFilePath("/data/sample_R2.fastq.gz")).toBe(
      "/data/sample_R1.fastq.gz"
    );
  });

  it("handles dot-separated read IDs", () => {
    expect(getPairedFilePath("/data/sample.R1.fastq.gz")).toBe(
      "/data/sample.R2.fastq.gz"
    );
  });

  it("returns null for non-paired file", () => {
    expect(getPairedFilePath("/data/sample.fastq.gz")).toBeNull();
  });
});
