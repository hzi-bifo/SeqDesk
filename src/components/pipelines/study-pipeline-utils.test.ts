import { describe, expect, it } from "vitest";

import {
  getEligibleStudySampleIds,
  getPreferredStudyRead,
  getStudyPipelineRunDetails,
  getStudyPipelineRunReportPath,
  getStudySampleReadIssue,
  getStudySelectionEmptyMessage,
  runHasOutputErrors,
  sampleHasRequiredReads,
  type StudyPipelineLike,
  type StudySampleLike,
} from "./study-pipeline-utils";

function makeSample(overrides: Partial<StudySampleLike> = {}): StudySampleLike {
  return {
    id: "sample-1",
    sampleId: "S-1",
    reads: [
      {
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
      },
    ],
    ...overrides,
  };
}

describe("study-pipeline-utils", () => {
  it("accepts single-end samples when paired reads are not required", () => {
    const sample = makeSample({
      reads: [{ file1: "reads/sample.fastq.gz", file2: null }],
    });
    const pipeline: StudyPipelineLike = {
      input: {
        perSample: {
          reads: true,
          pairedEnd: false,
        },
      },
    };

    expect(sampleHasRequiredReads(sample, pipeline)).toBe(true);
    expect(getStudySampleReadIssue(sample, pipeline)).toBeNull();
    expect(getStudySelectionEmptyMessage(pipeline)).toBe("No samples with reads available.");
  });

  it("flags single-end samples when paired reads are required", () => {
    const sample = makeSample({
      reads: [{ file1: "reads/sample.fastq.gz", file2: null }],
    });
    const pipeline: StudyPipelineLike = {
      input: {
        perSample: {
          reads: true,
          pairedEnd: true,
        },
      },
    };

    expect(sampleHasRequiredReads(sample, pipeline)).toBe(false);
    expect(getStudySampleReadIssue(sample, pipeline)).toBe("Missing R2 file");
    expect(getStudySelectionEmptyMessage(pipeline)).toBe("No samples with paired reads available.");
  });

  it("prefers explicit readMode over legacy pairedEnd flags", () => {
    const sample = makeSample({
      reads: [{ file1: "reads/sample.fastq.gz", file2: null }],
    });
    const pipeline: StudyPipelineLike = {
      input: {
        perSample: {
          reads: true,
          pairedEnd: false,
          readMode: "paired_only",
        },
      },
    };

    expect(sampleHasRequiredReads(sample, pipeline)).toBe(false);
    expect(getStudySampleReadIssue(sample, pipeline)).toBe("Missing R2 file");
  });

  it("derives eligible study sample ids from the pipeline input requirements", () => {
    const samples = [
      makeSample({ id: "paired", sampleId: "PAIRED" }),
      makeSample({
        id: "single",
        sampleId: "SINGLE",
        reads: [{ file1: "reads/single.fastq.gz", file2: null }],
      }),
      makeSample({
        id: "empty",
        sampleId: "EMPTY",
        reads: [{ file1: null, file2: null }],
      }),
    ];

    expect(
      getEligibleStudySampleIds(samples, {
        input: { perSample: { reads: true, pairedEnd: false } },
      })
    ).toEqual(new Set(["paired", "single"]));

    expect(
      getEligibleStudySampleIds(samples, {
        input: { perSample: { reads: true, pairedEnd: true } },
      })
    ).toEqual(new Set(["paired"]));
  });

  it("prefers paired reads for display but falls back to single-end input", () => {
    expect(getPreferredStudyRead(makeSample())?.file2).toBe("reads/sample_R2.fastq.gz");
    expect(
      getPreferredStudyRead(
        makeSample({
          reads: [{ file1: "reads/sample.fastq.gz", file2: null }],
        })
      )
    ).toEqual({
      file1: "reads/sample.fastq.gz",
      file2: null,
    });
  });

  it("surfaces output-processing errors on completed runs", () => {
    const run = {
      status: "completed",
      currentStep: "Completed",
      results: {
        errors: ["Reads QC summary file was not produced"],
      },
    };

    expect(runHasOutputErrors(run)).toBe(true);
    expect(getStudyPipelineRunDetails(run)).toBe("Reads QC summary file was not produced");
  });

  it("prefers a run-scoped HTML artifact for the report link", () => {
    const run = {
      status: "completed",
      artifacts: [
        {
          name: "sample_R1_fastqc.html",
          path: "/data/sample_R1_fastqc.html",
          sampleId: "sample-1",
          type: "data",
        },
        {
          name: "reads-qc-report.html",
          path: "/data/reads-qc-report.html",
          sampleId: null,
          type: "data",
        },
      ],
    };

    expect(getStudyPipelineRunReportPath(run)).toBe("/data/reads-qc-report.html");
  });
});
