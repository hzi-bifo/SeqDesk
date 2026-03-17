import { describe, expect, it } from "vitest";

import { getSampleResultPreview } from "./sample-result";
import type { SequencingSampleRow } from "@/lib/sequencing/types";

function makeSample(overrides: Partial<SequencingSampleRow> = {}): SequencingSampleRow {
  return {
    id: "sample-1",
    sampleId: "S-1",
    sampleAlias: null,
    sampleTitle: null,
    facilityStatus: "WAITING",
    facilityStatusUpdatedAt: null,
    updatedAt: new Date().toISOString(),
    read: {
      id: "read-1",
      file1: "reads/sample_R1.fastq.gz",
      file2: "reads/sample_R2.fastq.gz",
      checksum1: "abcdef1234567890",
      checksum2: "fedcba0987654321",
      readCount1: 1200,
      readCount2: 1200,
      fastqcReport1: null,
      fastqcReport2: null,
    },
    integrityStatus: "complete",
    hasReads: true,
    sequencingRun: null,
    artifactCount: 0,
    qcArtifactCount: 0,
    latestArtifactStage: null,
    artifacts: [],
    ...overrides,
  };
}

describe("getSampleResultPreview", () => {
  it("formats paired checksum previews with hash_prefix", () => {
    const preview = getSampleResultPreview(makeSample(), {
      columnLabel: "Checksums",
      emptyText: "Not computed",
      values: [
        {
          label: "R1",
          path: "read.checksum1",
          whenPathExists: "read.file1",
          format: "hash_prefix",
          truncate: 8,
        },
        {
          label: "R2",
          path: "read.checksum2",
          whenPathExists: "read.file2",
          format: "hash_prefix",
          truncate: 8,
        },
      ],
    });

    expect(preview).toEqual({
      columnLabel: "Checksums",
      emptyText: "Not computed",
      items: [
        { label: "R1", value: "abcdef12..." },
        { label: "R2", value: "fedcba09..." },
      ],
    });
  });

  it("hides optional paired fields for single-end samples", () => {
    const preview = getSampleResultPreview(
      makeSample({
        read: {
          id: "read-1",
          file1: "reads/sample.fastq.gz",
          file2: null,
          checksum1: "abcdef1234567890",
          checksum2: null,
          readCount1: 1200,
          readCount2: null,
          fastqcReport1: null,
          fastqcReport2: null,
        },
      }),
      {
        columnLabel: "Checksums",
        values: [
          {
            label: "R1",
            path: "read.checksum1",
            whenPathExists: "read.file1",
            format: "hash_prefix",
          },
          {
            label: "R2",
            path: "read.checksum2",
            whenPathExists: "read.file2",
            format: "hash_prefix",
          },
        ],
      },
    );

    expect(preview?.items).toEqual([{ label: "R1", value: "abcdef12..." }]);
  });

  it("returns the configured empty text when no values are available", () => {
    const preview = getSampleResultPreview(
      makeSample({
        read: {
          id: "read-1",
          file1: null,
          file2: null,
          checksum1: null,
          checksum2: null,
          readCount1: null,
          readCount2: null,
          fastqcReport1: null,
          fastqcReport2: null,
        },
      }),
      {
        columnLabel: "Checksums",
        emptyText: "Not computed",
        values: [
          {
            label: "R1",
            path: "read.checksum1",
            whenPathExists: "read.file1",
            format: "hash_prefix",
          },
        ],
      },
    );

    expect(preview).toEqual({
      columnLabel: "Checksums",
      emptyText: "Not computed",
      items: [],
    });
  });
});
