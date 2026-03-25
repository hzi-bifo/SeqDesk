// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FastqcMetricBadges } from "./FastqcMetricBadges";
import type { SequencingReadSummary } from "@/lib/sequencing/types";

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

describe("FastqcMetricBadges", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders both FastQC quality badges when both reads have values", () => {
    render(
      <FastqcMetricBadges
        read={makeRead({ avgQuality1: 37.2, avgQuality2: 36.9 })}
      />,
    );

    expect(screen.getByText("R1 Q 37.2")).toBeTruthy();
    expect(screen.getByText("R2 Q 36.9")).toBeTruthy();
  });

  it("renders nothing when no FastQC quality values are present", () => {
    const { container } = render(<FastqcMetricBadges read={makeRead()} />);

    expect(container.firstChild).toBeNull();
  });
});
