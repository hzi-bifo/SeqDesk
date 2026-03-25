import { describe, expect, it } from "vitest";

import {
  formatAvgQuality,
  getFastqcMetricItems,
  getSequencingReportSummary,
} from "./display";
import type { SequencingReadSummary } from "./types";

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

describe("sequencing display helpers", () => {
  it("formats average quality values to one decimal place", () => {
    expect(formatAvgQuality(null)).toBe("-");
    expect(formatAvgQuality(undefined)).toBe("-");
    expect(formatAvgQuality(37)).toBe("37.0");
    expect(formatAvgQuality(37.26)).toBe("37.3");
  });

  it("returns singular and plural report summaries", () => {
    expect(getSequencingReportSummary(0)).toBe("No reports");
    expect(getSequencingReportSummary(1)).toBe("1 report");
    expect(getSequencingReportSummary(4)).toBe("4 reports");
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
