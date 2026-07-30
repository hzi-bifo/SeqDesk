import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatHalfEvenBinary64,
  formatSeqkit28RoundedBinary64,
} from "./lib/decimal-rounding.mjs";
import {
  FastqValidationError,
  computeFastqGroundTruth,
  parseFastqcDataGroundTruth,
  resolveFastqcMeanSequenceQualityForEncoding,
} from "./lib/fastq-ground-truth.mjs";

const temporaryRoots: string[] = [];

function createTemporaryRoot() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "seqdesk-fastq-ground-truth-"),
  );
  temporaryRoots.push(root);
  return root;
}

function writeFixture(
  name: string,
  content: string | Buffer,
): string {
  const target = path.join(createTemporaryRoot(), name);
  fs.writeFileSync(target, content);
  return target;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("FASTQ ground-truth analyzer", () => {
  it("keeps SeqKit 2.8 pre-rounding separate from binary64 fixed formatting", () => {
    const averageLengthBoundary = 23 / 20;
    expect(averageLengthBoundary).toBe(1.15);
    expect(formatHalfEvenBinary64(averageLengthBoundary, 1)).toBe("1.1");
    expect(
      formatSeqkit28RoundedBinary64(averageLengthBoundary, 1),
    ).toBe("1.2");

    const percentageBoundary = (23 / 160) * 100;
    expect(percentageBoundary).toBe(14.374999999999998);
    expect(formatHalfEvenBinary64(percentageBoundary, 2)).toBe("14.37");
    expect(
      formatSeqkit28RoundedBinary64(percentageBoundary, 2),
    ).toBe("14.38");
  });

  it("streams exact counts, length distribution, N50, and both quality means", async () => {
    const fastqPath = writeFixture(
      "reads.fastq",
      [
        "@read-1",
        "AC",
        "+",
        "!!",
        "@read-2 metadata",
        "ACGT",
        "+read-2",
        "IIII",
        "@read-3",
        "ACGTAC",
        "+",
        "555555",
        "",
      ].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);

    expect(stats).toEqual({
      readCount: 3,
      totalBases: 12,
      minReadLength: 2,
      maxReadLength: 6,
      meanReadLength: 4,
      medianReadLength: 4,
      n50: 6,
      meanBaseQuality: 280 / 12,
      meanPerReadQuality: 20,
      meanErrorProbabilityQuality:
        -10 * Math.log10((2 + 4e-4 + 6e-2) / 12),
      meanPerReadErrorProbabilityQuality: 20,
      fastqcMeanSequenceQuality: 20,
      fastqcMeanSequenceQualityByOffset: {
        33: 20,
        64: null,
      },
      nanomathMeanReadQuality:
        -10 * Math.log10((1 + 10 ** -4 + 10 ** -2) / 3),
      q20Percent: (10 / 12) * 100,
      q30Percent: (4 / 12) * 100,
      gcBasePercent: 50,
      meanPerReadGcPercent: 50,
      seqkitMeanPerReadGcPercent: 50,
      seqkitPerReadGcBinary64Total: 150,
      seqkitPerReadGcHundredthsTotal: 15000,
      seqkitGcReadCount: 3,
      nanomathN50: 4,
    });
  });

  it("detects gzip by magic bytes and handles CRLF plus an even median", async () => {
    const plain = [
      "@r1",
      "A",
      "+",
      "\"",
      "@r2",
      "AAA",
      "+",
      "\"\"\"",
      "@r3",
      "AAAAA",
      "+",
      "\"\"\"\"\"",
      "@r4",
      "AAAAAAA",
      "+",
      "\"\"\"\"\"\"\"",
    ].join("\r\n");
    const fastqPath = writeFixture(
      "compressed-without-gz-extension.data",
      zlib.gzipSync(plain),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats).toMatchObject({
      readCount: 4,
      totalBases: 16,
      minReadLength: 1,
      maxReadLength: 7,
      meanReadLength: 4,
      medianReadLength: 4,
      n50: 5,
      meanBaseQuality: 1,
      meanPerReadQuality: 1,
      meanErrorProbabilityQuality: 1,
      fastqcMeanSequenceQuality: 1,
      q20Percent: 0,
      q30Percent: 0,
      gcBasePercent: 0,
      meanPerReadGcPercent: 0,
      seqkitMeanPerReadGcPercent: 0,
      seqkitPerReadGcBinary64Total: 0,
      seqkitPerReadGcHundredthsTotal: 0,
      nanomathN50: 5,
    });
    expect(stats.meanPerReadErrorProbabilityQuality).toBeCloseTo(1, 12);
    const nanomathIntegerQualities = [1, 3, 5, 7].map((length) =>
      Math.trunc(
        Math.fround(
          -10 *
            Math.log10(
              Array.from({ length }, () => 10 ** (-1 / 10)).reduce(
                (sum, value) => sum + value,
                0,
              ) / length,
            ),
        ),
      ),
    );
    expect(stats.nanomathMeanReadQuality).toBeCloseTo(
      -10 *
        Math.log10(
          nanomathIntegerQualities.reduce(
            (sum, quality) => sum + 10 ** (-quality / 10),
            0,
          ) / nanomathIntegerQualities.length,
        ),
      12,
    );
    expect(stats.fastqcMeanSequenceQualityByOffset).toEqual({
      33: 1,
      64: null,
    });
  });

  it("matches SeqKit's error-probability quality and base-level Q percentages", async () => {
    const fastqPath = writeFixture(
      "seqkit-quality.fastq",
      [
        "@r1",
        "GC",
        "+",
        "I5", // Q40, Q20
        "@r2",
        "aa",
        "+",
        "+?", // Q10, Q30
        "",
      ].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    const expectedErrorProbability =
      (10 ** -4 + 10 ** -2 + 10 ** -1 + 10 ** -3) / 4;

    expect(stats.meanErrorProbabilityQuality).toBeCloseTo(
      -10 * Math.log10(expectedErrorProbability),
      12,
    );
    expect(stats.meanPerReadErrorProbabilityQuality).toBeCloseTo(
      (-10 * Math.log10((10 ** -4 + 10 ** -2) / 2) +
        -10 * Math.log10((10 ** -1 + 10 ** -3) / 2)) /
        2,
      12,
    );
    expect(stats.fastqcMeanSequenceQuality).toBe(25);
    expect(stats.nanomathMeanReadQuality).toBeCloseTo(
      -10 * Math.log10((10 ** -2.2 + 10 ** -1.2) / 2),
      12,
    );
    expect(stats.q20Percent).toBe(75);
    expect(stats.q30Percent).toBe(50);
    expect(stats.gcBasePercent).toBe(50);
    expect(stats.meanPerReadGcPercent).toBe(50);
    expect(stats.seqkitMeanPerReadGcPercent).toBe(50);
  });

  it("models SeqKit's per-read two-decimal GC values before averaging", async () => {
    const fastqPath = writeFixture(
      "seqkit-gc.fastq",
      [
        "@r1",
        "GAA",
        "+",
        "III",
        "@r2",
        "CAAAAAA",
        "+",
        "IIIIIII",
        "",
      ].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats.meanPerReadGcPercent).toBeCloseTo(
      (100 / 3 + 100 / 7) / 2,
      12,
    );
    expect(stats.seqkitMeanPerReadGcPercent).toBe(
      (33.33 + 14.29) / 2,
    );
    expect(stats.seqkitGcReadCount).toBe(2);
  });

  it("uses SeqKit's half-even rounding for each per-read GC value", async () => {
    const oneInThirtyTwoPath = writeFixture(
      "seqkit-gc-half-even.fastq",
      [
        "@half-even",
        `${"G"}${"A".repeat(31)}`,
        "+",
        "I".repeat(32),
        "",
      ].join("\n"),
    );
    const oneInFourThousandPath = writeFixture(
      "seqkit-gc-binary64-half-even.fastq",
      [
        "@binary64-boundary",
        `${"G"}${"A".repeat(3999)}`,
        "+",
        "I".repeat(4000),
        "",
      ].join("\n"),
    );

    const oneInThirtyTwo = await computeFastqGroundTruth(
      oneInThirtyTwoPath,
    );
    expect(oneInThirtyTwo.seqkitPerReadGcHundredthsTotal).toBe(312);
    expect(oneInThirtyTwo.seqkitPerReadGcBinary64Total).toBe(3.12);
    expect(oneInThirtyTwo.seqkitMeanPerReadGcPercent).toBe(3.12);

    const oneInFourThousand = await computeFastqGroundTruth(
      oneInFourThousandPath,
    );
    expect(oneInFourThousand.seqkitPerReadGcHundredthsTotal).toBe(3);
    expect(oneInFourThousand.seqkitPerReadGcBinary64Total).toBe(0.03);
    expect(oneInFourThousand.seqkitMeanPerReadGcPercent).toBe(0.03);
  });

  it("models SeqKit fx2tab's separate G and C binary64 divisions", async () => {
    const sequence = `G${"C".repeat(16)}${"N".repeat(143)}`;
    const fastqPath = writeFixture(
      "seqkit-gc-operation-order.fastq",
      ["@read", sequence, "+", "I".repeat(sequence.length), ""].join(
        "\n",
      ),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(sequence).toHaveLength(160);
    expect((1 / 160 + 16 / 160) * 100).toBe(10.625000000000002);
    expect(((1 + 16) / 160) * 100).toBe(10.625);
    expect(stats.meanPerReadGcPercent).toBe(10.625);
    expect(stats.seqkitPerReadGcBinary64Total).toBe(10.63);
    expect(stats.seqkitPerReadGcHundredthsTotal).toBe(1063);
    expect(stats.seqkitMeanPerReadGcPercent).toBe(10.63);
  });

  it("models pinned SeqKit 2.8 with ambiguous bases in the denominator", async () => {
    const mixedPath = writeFixture(
      "seqkit-mixed-gc.fastq",
      [
        "@canonical",
        "GN",
        "+",
        "II",
        "@ambiguous",
        "NN",
        "+",
        "II",
        "",
      ].join("\n"),
    );
    const allAmbiguousPath = writeFixture(
      "seqkit-all-ambiguous.fastq",
      ["@ambiguous", "NN", "+", "II", ""].join("\n"),
    );

    const mixed = await computeFastqGroundTruth(mixedPath);
    expect(mixed.meanPerReadGcPercent).toBe(25);
    expect(mixed.seqkitMeanPerReadGcPercent).toBe(25);
    expect(mixed.seqkitGcReadCount).toBe(2);

    const allAmbiguous = await computeFastqGroundTruth(allAmbiguousPath);
    expect(allAmbiguous.seqkitMeanPerReadGcPercent).toBe(0);
    expect(allAmbiguous.seqkitGcReadCount).toBe(1);
  });

  it("models NanoMath's ascending cumulative N50 boundary", async () => {
    const fastqPath = writeFixture(
      "nanomath-n50.fastq",
      [
        "@r1",
        "AA",
        "+",
        "II",
        "@r2",
        "AA",
        "+",
        "II",
        "@r3",
        "AAAA",
        "+",
        "IIII",
        "",
      ].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats.n50).toBe(4);
    expect(stats.nanomathN50).toBe(2);
  });

  it("models NanoGet float32 rounding before NanoMath truncates read quality", async () => {
    const readLength = 6264;
    const fastqPath = writeFixture(
      "nanoget-float32-quality.fastq",
      [
        "@float32-boundary",
        "A".repeat(readLength),
        "+",
        `${"!".repeat(2773)}${"#".repeat(3491)}`,
        "",
      ].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats.meanPerReadErrorProbabilityQuality).toBeGreaterThan(
      0.9999999,
    );
    expect(stats.meanPerReadErrorProbabilityQuality).toBeLessThan(1);
    expect(Math.trunc(stats.meanPerReadErrorProbabilityQuality)).toBe(0);
    expect(
      Math.trunc(Math.fround(stats.meanPerReadErrorProbabilityQuality)),
    ).toBe(1);
    expect(stats.nanomathMeanReadQuality).toBeCloseTo(1, 12);
  });

  it("keeps FastQC offset-33 and offset-64 integer bins independent", async () => {
    const fastqPath = writeFixture(
      "high-only.fastq",
      ["@r1", "AAAA", "+", "IIII", ""].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats.fastqcMeanSequenceQuality).toBe(40);
    expect(stats.fastqcMeanSequenceQualityByOffset).toEqual({
      33: 40,
      64: 9,
    });
    expect(
      resolveFastqcMeanSequenceQualityForEncoding(
        stats,
        "Sanger / Illumina 1.9",
      ),
    ).toBe(40);
    expect(
      resolveFastqcMeanSequenceQualityForEncoding(
        stats,
        "Illumina 1.3",
      ),
    ).toBe(9);
    expect(
      resolveFastqcMeanSequenceQualityForEncoding(
        stats,
        "Illumina 1.5",
      ),
    ).toBe(9);
  });

  it("rejects offset-64 selection when raw quality characters are below ASCII 64", async () => {
    const fastqPath = writeFixture(
      "low-quality.fastq",
      ["@r1", "AA", "+", "!I", ""].join("\n"),
    );

    const stats = await computeFastqGroundTruth(fastqPath);
    expect(stats.fastqcMeanSequenceQualityByOffset[64]).toBeNull();
    expect(() =>
      resolveFastqcMeanSequenceQualityForEncoding(
        stats,
        "Illumina 1.3",
      ),
    ).toThrow(/outside the valid ASCII range.*offset 64/);
    expect(() =>
      resolveFastqcMeanSequenceQualityForEncoding(
        stats,
        "Solexa",
      ),
    ).toThrow(/Unsupported FastQC Encoding "Solexa"/);
  });

  it("rejects empty plain and gzip files", async () => {
    const emptyPlain = writeFixture("empty.fastq", "");
    const emptyGzip = writeFixture(
      "empty.fastq.gz",
      zlib.gzipSync(""),
    );

    await expect(computeFastqGroundTruth(emptyPlain)).rejects.toThrow(
      /contains no records/,
    );
    await expect(computeFastqGroundTruth(emptyGzip)).rejects.toThrow(
      /contains no records/,
    );
  });

  it.each([
    {
      label: "a missing header marker",
      content: "read-1\nAC\n+\n!!\n",
      error: /header must start with "@"/,
    },
    {
      label: "an empty sequence",
      content: "@read-1\n\n+\n\n",
      error: /sequence must not be empty/,
    },
    {
      label: "a missing plus marker",
      content: "@read-1\nAC\nseparator\n!!\n",
      error: /separator must start with "\+"/,
    },
    {
      label: "unequal sequence and quality lengths",
      content: "@read-1\nACG\n+\n!!\n",
      error: /sequence and quality lengths differ \(3 !== 2\)/,
    },
    {
      label: "a non-Phred+33 quality byte",
      content: "@read-1\nA\n+\n \n",
      error: /quality contains a non-Phred\+33/,
    },
    {
      label: "an inter-record blank line",
      content: "@read-1\nA\n+\n!\n\n",
      error: /truncated record 2 has 1 of 4 required lines/,
    },
  ])("fails closed for $label", async ({ content, error }) => {
    const fastqPath = writeFixture("malformed.fastq", content);

    const result = computeFastqGroundTruth(fastqPath);
    await expect(result).rejects.toBeInstanceOf(FastqValidationError);
    await expect(result).rejects.toThrow(error);
  });

  it("rejects every truncated-record length", async () => {
    for (const [lineCount, content] of [
      [1, "@read-1\n"],
      [2, "@read-1\nAC\n"],
      [3, "@read-1\nAC\n+\n"],
    ] as const) {
      const fastqPath = writeFixture(
        `truncated-${lineCount}.fastq`,
        content,
      );
      await expect(computeFastqGroundTruth(fastqPath)).rejects.toThrow(
        new RegExp(`truncated record 1 has ${lineCount} of 4 required lines`),
      );
    }
  });

  it("rejects a truncated gzip stream instead of returning partial stats", async () => {
    const compressed = zlib.gzipSync("@read-1\nACGT\n+\nIIII\n");
    const fastqPath = writeFixture(
      "truncated.fastq.gz",
      compressed.subarray(0, compressed.length - 4),
    );

    await expect(computeFastqGroundTruth(fastqPath)).rejects.toThrow(
      /Could not decode FASTQ.*unexpected end of file/i,
    );
  });

  it("rejects invalid paths with a contextual validation error", async () => {
    await expect(
      computeFastqGroundTruth(
        path.join(createTemporaryRoot(), "does-not-exist.fastq"),
      ),
    ).rejects.toThrow(/Could not open FASTQ.*ENOENT/);
    await expect(computeFastqGroundTruth("")).rejects.toThrow(TypeError);
  });

  it("strictly parses FastQC sequence-count and quality evidence", () => {
    const data = [
      "##FastQC\t0.12.1",
      ">>Basic Statistics\tpass",
      "#Measure\tValue",
      "Filename\tS1_R1.fastq.gz",
      "Total Sequences\t10",
      "Encoding\tSanger / Illumina 1.9",
      ">>END_MODULE",
      ">>Per sequence quality scores\tpass",
      "#Quality\tCount",
      "34\t2.0",
      "35\t0.0",
      "36\t8.0",
      ">>END_MODULE",
      "",
    ].join("\n");

    expect(parseFastqcDataGroundTruth(data)).toEqual({
      filename: "S1_R1.fastq.gz",
      totalSequences: 10,
      encoding: "Sanger / Illumina 1.9",
      qualityOffset: 33,
      meanSequenceQualityNumerator: 356,
      meanSequenceQualityDenominator: 10,
      meanSequenceQuality: 35.6,
    });
  });

  it.each([
    ["Sanger / Illumina 1.9", 33, 40],
    ["Illumina 1.3", 64, 9],
    ["Illumina 1.5", 64, 9],
  ] as const)(
    "parses the supported FastQC Encoding %s as offset %i",
    (encoding, qualityOffset, qualityBin) => {
      const data = [
        ">>Basic Statistics\tpass",
        "Filename\thigh-only.fastq",
        "Total Sequences\t1",
        `Encoding\t${encoding}`,
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        `${qualityBin}\t1`,
        ">>END_MODULE",
      ].join("\n");

      expect(parseFastqcDataGroundTruth(data)).toMatchObject({
        encoding,
        qualityOffset,
        meanSequenceQuality: qualityBin,
      });
    },
  );

  it.each([
    {
      label: "missing Basic Statistics",
      data: [
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /exactly one Basic Statistics/,
    },
    {
      label: "duplicate Total Sequences",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Total Sequences\t1",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /duplicate Total Sequences/,
    },
    {
      label: "mismatched quality counts",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t2",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /do not match Total Sequences/,
    },
    {
      label: "fractional quality count",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t0.5",
        ">>END_MODULE",
      ].join("\n"),
      error: /invalid quality or count/,
    },
    {
      label: "fractional quality bin",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34.5\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /invalid quality or count/,
    },
    {
      label: "duplicate quality bin",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t2",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /duplicate quality bin/,
    },
    {
      label: "missing Encoding",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /missing Encoding/,
    },
    {
      label: "duplicate Encoding",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Encoding\tSanger / Illumina 1.9",
        "Encoding\tSanger / Illumina 1.9",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /duplicate Encoding/,
    },
    {
      label: "unknown Encoding",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Encoding\tSolexa",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "34\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /Unsupported FastQC Encoding "Solexa"/,
    },
    {
      label: "an offset-64 bin above printable ASCII",
      data: [
        ">>Basic Statistics\tpass",
        "Filename\tS1.fastq.gz",
        "Total Sequences\t1",
        "Encoding\tIllumina 1.3",
        ">>END_MODULE",
        ">>Per sequence quality scores\tpass",
        "63\t1",
        ">>END_MODULE",
      ].join("\n"),
      error: /bin 63 is outside the valid range.*0-62/,
    },
  ])("rejects FastQC evidence with $label", ({ data, error }) => {
    expect(() => parseFastqcDataGroundTruth(data)).toThrow(error);
  });
});
