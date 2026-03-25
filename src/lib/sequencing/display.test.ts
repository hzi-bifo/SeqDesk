import { describe, expect, it } from "vitest";

import {
  formatAvgQuality,
  getFastqcMetricItems,
  getSequencingReportCount,
  getSequencingReportStageLabel,
  getSequencingReportSummary,
  hasSequencingReports,
} from "./display";
import type { SequencingReadSummary, SequencingSampleRow } from "./types";

function makeRead(
  overrides: Partial<SequencingReadSummary> = {},
): SequencingReadSummary {
  return {
    id: "read-1",
    file1: "reads/sample_R1.fastq.gz",
    file2: "reads/sample_R2.fastq.gz",
    checksum1: null,
    checksum2: null,
    readCount1: null,
    readCount2: null,
    avgQuality1: null,
    avgQuality2: null,
    fileSize1: null,
    fileSize2: null,
    fastqcReport1: null,
    fastqcReport2: null,
    pipelineRunId: null,
    pipelineRunNumber: null,
    pipelineSources: null,
    filesMissing: false,
    ...overrides,
  };
}

function makeSample(
  overrides: Partial<SequencingSampleRow> = {},
): SequencingSampleRow {
  return {
    id: "sample-1",
    sampleId: "S-1",
    sampleAlias: null,
    sampleTitle: null,
    facilityStatus: "SEQUENCED",
    facilityStatusUpdatedAt: null,
    updatedAt: new Date().toISOString(),
    read: makeRead(),
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

describe("sequencing display helpers", () => {
  it("formats average quality values to one decimal place", () => {
    expect(formatAvgQuality(null)).toBe("-");
    expect(formatAvgQuality(undefined)).toBe("-");
    expect(formatAvgQuality(37)).toBe("37.0");
    expect(formatAvgQuality(37.26)).toBe("37.3");
  });

  it("returns singular and plural report summaries", () => {
    expect(getSequencingReportSummary(makeSample({ read: makeRead({ fastqcReport1: null, fastqcReport2: null }) }))).toBe("No reports");
    expect(
      getSequencingReportSummary(
        makeSample({
          read: makeRead({
            fastqcReport1: "/data/fastqc/sample_R1_fastqc.html",
            fastqcReport2: null,
          }),
        }),
      ),
    ).toBe("1 report");
    expect(
      getSequencingReportSummary(
        makeSample({
          read: makeRead({
            fastqcReport1: "/data/fastqc/sample_R1_fastqc.html",
            fastqcReport2: "/data/fastqc/sample_R2_fastqc.html",
          }),
          artifacts: [
            {
              id: "artifact-1",
              orderId: "order-1",
              sampleId: "sample-1",
              sequencingRunId: null,
              stage: "qc",
              artifactType: "multiqc_report",
              source: "upload",
              visibility: "facility",
              path: "/data/qc/multiqc.html",
              originalName: "multiqc.html",
              size: null,
              checksum: null,
              mimeType: "text/html",
              metadata: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    ).toBe("3 reports");
  });

  it("counts read-backed FastQC reports as sequencing reports", () => {
    const sample = makeSample({
      read: makeRead({
        fastqcReport1: "/data/fastqc/sample_R1_fastqc.html",
        fastqcReport2: "/data/fastqc/sample_R2_fastqc.html",
      }),
    });

    expect(getSequencingReportCount(sample)).toBe(2);
    expect(hasSequencingReports(sample)).toBe(true);
    expect(getSequencingReportStageLabel(sample)).toBe("FastQC");
  });

  it("returns FastQC metric items for populated read qualities", () => {
    expect(
      getFastqcMetricItems(
        makeRead({
          avgQuality1: 37.2,
          avgQuality2: 36.9,
        }),
      ),
    ).toEqual([
      { label: "R1 Q", value: 37.2 },
      { label: "R2 Q", value: 36.9 },
    ]);
  });

  it("filters out missing FastQC quality values", () => {
    expect(
      getFastqcMetricItems(
        makeRead({
          avgQuality1: 38.1,
          avgQuality2: null,
        }),
      ),
    ).toEqual([{ label: "R1 Q", value: 38.1 }]);

    expect(getFastqcMetricItems(makeRead())).toEqual([]);
    expect(getFastqcMetricItems(null)).toEqual([]);
  });
});
