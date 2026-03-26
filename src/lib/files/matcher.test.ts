import { describe, it, expect } from "vitest";
import {
  matchPairedEndFiles,
  validateFilePair,
  findFilesForSample,
  findFilesForSamples,
} from "./matcher";
import type { FileInfo } from "./scanner";

function makeFile(filename: string, relativePath?: string): FileInfo {
  return {
    absolutePath: `/data/${relativePath || filename}`,
    relativePath: relativePath || filename,
    filename,
    size: 1000,
    modifiedAt: new Date("2024-01-01"),
  };
}

describe("matchPairedEndFiles", () => {
  it("pairs R1 and R2 files with same identifier", () => {
    const files = [
      makeFile("SAMPLE001_R1.fastq.gz"),
      makeFile("SAMPLE001_R2.fastq.gz"),
    ];
    const result = matchPairedEndFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0].isPaired).toBe(true);
    expect(result[0].identifier).toBe("SAMPLE001");
  });

  it("handles unpaired R1 file", () => {
    const files = [makeFile("SAMPLE001_R1.fastq.gz")];
    const result = matchPairedEndFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0].isPaired).toBe(false);
    expect(result[0].read1.filename).toBe("SAMPLE001_R1.fastq.gz");
    expect(result[0].read2).toBeNull();
  });

  it("groups multiple samples correctly", () => {
    const files = [
      makeFile("A_R1.fastq.gz"),
      makeFile("A_R2.fastq.gz"),
      makeFile("B_R1.fastq.gz"),
      makeFile("B_R2.fastq.gz"),
    ];
    const result = matchPairedEndFiles(files);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.isPaired)).toBe(true);
  });

  it("returns results sorted by identifier", () => {
    const files = [
      makeFile("Z_R1.fastq.gz"),
      makeFile("A_R1.fastq.gz"),
      makeFile("M_R1.fastq.gz"),
    ];
    const result = matchPairedEndFiles(files);
    expect(result.map((r) => r.identifier)).toEqual(["A", "M", "Z"]);
  });

  it("returns empty array for no files", () => {
    expect(matchPairedEndFiles([])).toEqual([]);
  });

  it("treats non-read files as R1 (single-end)", () => {
    const files = [makeFile("sample.fastq.gz")];
    const result = matchPairedEndFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0].isPaired).toBe(false);
    expect(result[0].read1.filename).toBe("sample.fastq.gz");
  });
});

describe("validateFilePair", () => {
  it("returns valid for proper R1+R2 pair", () => {
    const result = validateFilePair(
      "/data/s_R1.fq.gz",
      "/data/s_R2.fq.gz",
      false
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags read2 file that looks like a read 1 assignment", () => {
    const result = validateFilePair(
      "/data/s_R1.fq.gz",
      "/data/s_R1.fq.gz",
      true
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.includes("Read 2 file appears to be a Read 1"))).toBe(
      true
    );
  });

  it("returns error when neither file provided", () => {
    const result = validateFilePair(null, null, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one file must be specified");
  });

  it("returns error when R2 provided without R1", () => {
    const result = validateFilePair(null, "/data/s_R2.fq.gz", true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Read 2 cannot be assigned without Read 1"
    );
  });

  it("warns when R1 filename looks like R2", () => {
    const result = validateFilePair("/data/s_R2.fq.gz", null, true);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("appears to be a Read 2 file"))
    ).toBe(true);
  });

  it("returns error for single-end when not allowed", () => {
    const result = validateFilePair("/data/s_R1.fq.gz", null, false);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Single-end"))
    ).toBe(true);
  });

  it("returns valid for single-end when allowed", () => {
    const result = validateFilePair("/data/s_R1.fq.gz", null, true);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("findFilesForSample", () => {
  it("finds exact match by sampleId", () => {
    const files = [
      makeFile("SAMPLE001_R1.fastq.gz"),
      makeFile("SAMPLE001_R2.fastq.gz"),
    ];
    const result = findFilesForSample({ sampleId: "SAMPLE001" }, files);
    expect(result.status).toBe("exact");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.read1).not.toBeNull();
    expect(result.read2).not.toBeNull();
    expect(result.matchedBy).toBe("sampleId");
  });

  it("returns none when no files match", () => {
    const files = [makeFile("OTHER_R1.fastq.gz")];
    const result = findFilesForSample({ sampleId: "NONEXISTENT" }, files);
    expect(result.status).toBe("none");
    expect(result.confidence).toBe(0);
  });

  it("returns none for empty file list", () => {
    const result = findFilesForSample({ sampleId: "SAMPLE001" }, []);
    expect(result.status).toBe("none");
  });

  it("matches using sampleAlias as fallback", () => {
    const files = [
      makeFile("MYALIAS_R1.fastq.gz"),
      makeFile("MYALIAS_R2.fastq.gz"),
    ];
    const result = findFilesForSample(
      { sampleId: "S1", sampleAlias: "MYALIAS" },
      files
    );
    expect(result.status).toBe("exact");
    expect(result.matchedBy).toBe("sampleAlias");
  });

  it("returns partial for weak matches when confidence is below exact threshold", () => {
    const files = [makeFile("A-VERYLONGID-READ1_R1.fastq.gz")];

    const result = findFilesForSample(
      { sampleId: "A" },
      files,
      true
    );

    expect(result.status).toBe("partial");
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.read1?.filename).toBe("A-VERYLONGID-READ1_R1.fastq.gz");
    expect(result.alternatives).toHaveLength(1);
  });

  it("returns ambiguous when multiple high-confidence matches are found", () => {
    const files = [
      makeFile("SAMPLE_ALPHA_R1.fastq.gz"),
      makeFile("SAMPLE_BETA_R1.fastq.gz"),
    ];

    const result = findFilesForSample(
      { sampleId: "SAMPLE" },
      files
    );

    expect(result.status).toBe("ambiguous");
    expect(result.read1).toBeNull();
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives.map((entry) => entry.identifier).sort()).toEqual([
      "SAMPLE_ALPHA",
      "SAMPLE_BETA",
    ]);
  });

  it("matches multiple samples in one pass", () => {
    const files = [
      makeFile("SAMPLE_ALPHA_R1.fastq.gz"),
      makeFile("SAMPLE_BETA_R1.fastq.gz"),
    ];

    const results = findFilesForSamples(
      [
        { sampleId: "SAMPLE_ALPHA" },
        { sampleId: "SAMPLE_BETA" },
      ],
      files
    );

    expect(results.get("SAMPLE_ALPHA")?.status).toBe("exact");
    expect(results.get("SAMPLE_BETA")?.status).toBe("exact");
  });

  it("drops orphan R2 without R1", () => {
    const files = [makeFile("SAMPLE001_R2.fastq.gz")];
    const result = matchPairedEndFiles(files);
    // Orphan R2 is dropped because only pairs with read1 are returned
    expect(result).toHaveLength(0);
  });

  it("handles findFilesForSamples with mixed results", () => {
    const files = [
      makeFile("ALPHA_R1.fastq.gz"),
      makeFile("ALPHA_R2.fastq.gz"),
    ];

    const results = findFilesForSamples(
      [
        { sampleId: "ALPHA" },
        { sampleId: "MISSING_SAMPLE" },
      ],
      files
    );

    expect(results.get("ALPHA")?.status).toBe("exact");
    expect(results.get("MISSING_SAMPLE")?.status).toBe("none");
  });

  it("matches by sampleAlias when sampleId does not match", () => {
    const files = [
      makeFile("ALIAS123_R1.fastq.gz"),
      makeFile("ALIAS123_R2.fastq.gz"),
    ];

    const result = findFilesForSample(
      { sampleId: "DOESNOTMATCH", sampleAlias: "ALIAS123" },
      files
    );

    expect(result.status).toBe("exact");
    expect(result.read1?.filename).toBe("ALIAS123_R1.fastq.gz");
    expect(result.read2?.filename).toBe("ALIAS123_R2.fastq.gz");
  });

  it("returns none when no files match", () => {
    const files = [makeFile("UNRELATED_R1.fastq.gz")];

    const result = findFilesForSample(
      { sampleId: "COMPLETELY_DIFFERENT" },
      files
    );

    expect(result.status).toBe("none");
    expect(result.read1).toBeNull();
    expect(result.read2).toBeNull();
  });
});
