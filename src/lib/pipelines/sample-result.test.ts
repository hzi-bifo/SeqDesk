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
      fileSize1: null,
      fileSize2: null,
      pipelineRunId: null,
      pipelineRunNumber: null,
      pipelineSources: null,
      filesMissing: false,
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
          fileSize1: null,
          fileSize2: null,
          pipelineRunId: null,
          pipelineRunNumber: null,
          pipelineSources: null,
          filesMissing: false,
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

  it("formats filename values by extracting the basename", () => {
    const preview = getSampleResultPreview(
      makeSample({
        read: {
          id: "read-1",
          file1: "reads/sample_R1.fastq.gz",
          file2: "reads/sample_R2.fastq.gz",
          checksum1: null,
          checksum2: null,
          readCount1: null,
          readCount2: null,
          fastqcReport1: "/data/fastqc_reports/sample_R1_fastqc.html",
          fastqcReport2: "/data/fastqc_reports/sample_R2_fastqc.html",
          fileSize1: null,
          fileSize2: null,
          pipelineRunId: null,
          pipelineRunNumber: null,
          pipelineSources: null,
          filesMissing: false,
        },
      }),
      {
        columnLabel: "QC Reports",
        emptyText: "Not generated",
        values: [
          {
            label: "R1",
            path: "read.fastqcReport1",
            whenPathExists: "read.file1",
            format: "filename",
          },
          {
            label: "R2",
            path: "read.fastqcReport2",
            whenPathExists: "read.file2",
            format: "filename",
          },
        ],
      },
    );

    expect(preview).toEqual({
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      items: [
        { label: "R1", value: "sample_R1_fastqc.html" },
        { label: "R2", value: "sample_R2_fastqc.html" },
      ],
    });
  });

  it("shows empty text for FastQC when reports are not yet generated", () => {
    const preview = getSampleResultPreview(makeSample(), {
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      values: [
        {
          label: "R1",
          path: "read.fastqcReport1",
          whenPathExists: "read.file1",
          format: "filename",
        },
        {
          label: "R2",
          path: "read.fastqcReport2",
          whenPathExists: "read.file2",
          format: "filename",
        },
      ],
    });

    expect(preview).toEqual({
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      items: [],
    });
  });

  it("returns checksums as Not computed when read exists but checksums are empty", () => {
    const sample = makeSample({
      read: {
        id: "read-1",
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        checksum1: null,
        checksum2: null,
        readCount1: null,
        readCount2: null,
        fastqcReport1: null,
        fastqcReport2: null,
        fileSize1: null,
        fileSize2: null,
        pipelineRunId: "run-1",
        pipelineRunNumber: "SIMULATE-READS-001",
        pipelineSources: { "simulate-reads": "run-1" },
        filesMissing: false,
      },
    });
    const preview = getSampleResultPreview(sample, {
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

    // Read exists with files but checksums are null → items empty → shows "Not computed"
    expect(preview).toEqual({
      columnLabel: "Checksums",
      emptyText: "Not computed",
      items: [],
    });
  });

  it("returns FastQC reports for sample with pipelineSources tracking", () => {
    const sample = makeSample({
      read: {
        id: "read-1",
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        checksum1: "abc123",
        checksum2: "def456",
        readCount1: 1000,
        readCount2: 1000,
        fastqcReport1: "/data/reports/sample_R1_fastqc.html",
        fastqcReport2: "/data/reports/sample_R2_fastqc.html",
        fileSize1: null,
        fileSize2: null,
        pipelineRunId: "run-1",
        pipelineRunNumber: "SIMULATE-READS-001",
        pipelineSources: {
          "simulate-reads": "run-1",
          "fastq-checksum": "ck-run-1",
          "fastqc": "qc-run-1",
        },
        filesMissing: false,
      },
    });
    const preview = getSampleResultPreview(sample, {
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      values: [
        {
          label: "R1",
          path: "read.fastqcReport1",
          whenPathExists: "read.file1",
          format: "filename",
        },
        {
          label: "R2",
          path: "read.fastqcReport2",
          whenPathExists: "read.file2",
          format: "filename",
        },
      ],
    });

    expect(preview).toEqual({
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      items: [
        { label: "R1", value: "sample_R1_fastqc.html" },
        { label: "R2", value: "sample_R2_fastqc.html" },
      ],
    });
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
          fileSize1: null,
          fileSize2: null,
          pipelineRunId: null,
          pipelineRunNumber: null,
          pipelineSources: null,
          filesMissing: false,
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

  it("includes previewPath for previewable items", () => {
    const sample = makeSample({
      read: {
        id: "read-1",
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        checksum1: null,
        checksum2: null,
        readCount1: null,
        readCount2: null,
        fastqcReport1: "/data/reports/sample_R1_fastqc.html",
        fastqcReport2: "/data/reports/sample_R2_fastqc.html",
        fileSize1: null,
        fileSize2: null,
        pipelineRunId: null,
        pipelineRunNumber: null,
        pipelineSources: null,
        filesMissing: false,
      },
    });
    const preview = getSampleResultPreview(sample, {
      columnLabel: "QC Reports",
      emptyText: "Not generated",
      values: [
        {
          label: "R1",
          path: "read.fastqcReport1",
          whenPathExists: "read.file1",
          format: "filename",
          previewable: true,
        },
        {
          label: "R2",
          path: "read.fastqcReport2",
          whenPathExists: "read.file2",
          format: "filename",
          previewable: true,
        },
      ],
    });

    expect(preview?.items).toEqual([
      { label: "R1", value: "sample_R1_fastqc.html", previewPath: "/data/reports/sample_R1_fastqc.html" },
      { label: "R2", value: "sample_R2_fastqc.html", previewPath: "/data/reports/sample_R2_fastqc.html" },
    ]);
  });

  it("does not include previewPath when previewable is not set", () => {
    const sample = makeSample({
      read: {
        id: "read-1",
        file1: "reads/sample_R1.fastq.gz",
        file2: null,
        checksum1: null,
        checksum2: null,
        readCount1: null,
        readCount2: null,
        fastqcReport1: "/data/reports/sample_R1_fastqc.html",
        fastqcReport2: null,
        fileSize1: null,
        fileSize2: null,
        pipelineRunId: null,
        pipelineRunNumber: null,
        pipelineSources: null,
        filesMissing: false,
      },
    });
    const preview = getSampleResultPreview(sample, {
      columnLabel: "QC Reports",
      values: [
        {
          label: "R1",
          path: "read.fastqcReport1",
          whenPathExists: "read.file1",
          format: "filename",
        },
      ],
    });

    expect(preview?.items).toEqual([
      { label: "R1", value: "sample_R1_fastqc.html" },
    ]);
  });
});
