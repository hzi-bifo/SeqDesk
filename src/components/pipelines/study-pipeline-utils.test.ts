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

  it("treats pipelines without read requirements as unrestricted", () => {
    const sample = makeSample({
      reads: [{ file1: null, file2: null }],
    });

    expect(sampleHasRequiredReads(sample, null)).toBe(true);
    expect(getStudySampleReadIssue(sample, null)).toBeNull();
    expect(getStudySelectionEmptyMessage(null)).toBe("No eligible samples available.");
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

  it("returns null when no preferred study read can be found", () => {
    expect(getPreferredStudyRead(makeSample({ reads: [] }))).toBeNull();
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

  it("handles failed and completed run detail fallbacks when no output errors exist", () => {
    expect(
      runHasOutputErrors({
        status: "completed",
        results: { errors: "not-an-array" as never },
      })
    ).toBe(false);

    expect(
      getStudyPipelineRunDetails({
        status: "failed",
        errorTail: "  Process failed with exit status 1  ",
      })
    ).toBe("Process failed with exit status 1");

    expect(
      getStudyPipelineRunDetails({
        status: "completed",
        currentStep: "Completed",
        results: { errors: ["   "] },
      })
    ).toBe("Completed successfully");
  });

  it("surfaces meaningful step text and fallback run status details", () => {
    expect(
      getStudyPipelineRunDetails({
        status: "completed",
        currentStep: "Assembling contigs",
        results: { errors: [] },
      })
    ).toBe("Assembling contigs");

    expect(
      getStudyPipelineRunDetails({
        status: "running",
        currentStep: "  Indexing reads  ",
      })
    ).toBe("Indexing reads");

    expect(getStudyPipelineRunDetails({ status: "queued" })).toBe("Waiting for execution");
    expect(getStudyPipelineRunDetails({ status: "running" })).toBe("Currently running");
    expect(getStudyPipelineRunDetails({ status: "pending" })).toBe("");
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

  it("returns null when no HTML report is available and prefers report artifacts", () => {
    expect(
      getStudyPipelineRunReportPath({
        status: "completed",
        artifacts: [{ name: "summary.txt", path: "/data/summary.txt", type: "data" }],
      })
    ).toBeNull();

    expect(
      getStudyPipelineRunReportPath({
        status: "completed",
        artifacts: [
          {
            name: "sample_multiqc.html",
            path: "/data/sample_multiqc.html",
            sampleId: "sample-1",
            type: "data",
          },
          {
            name: "report.html",
            path: "/data/report.html",
            sampleId: null,
            type: "report",
          },
        ],
      })
    ).toBe("/data/report.html");
  });
});
