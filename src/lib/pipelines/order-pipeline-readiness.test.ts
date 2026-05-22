import { describe, expect, it } from "vitest";
import { getOrderPipelineSampleReadiness } from "./order-pipeline-readiness";

function pipeline(reads: boolean, pairedEnd = false, pipelineId?: string) {
  return {
    pipelineId,
    input: {
      perSample: {
        reads,
        pairedEnd,
      },
    },
  };
}

describe("getOrderPipelineSampleReadiness", () => {
  it("marks samples ready for pipelines that do not require reads", () => {
    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(false),
        sample: {
          read: {
            file1: "old_R1.fastq.gz",
            file2: "old_R2.fastq.gz",
            filesMissing: true,
          },
        },
      })
    ).toEqual({ ready: true });
  });

  it("blocks read-consuming pipelines when reads are missing", () => {
    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(true),
        sample: { read: null },
      })
    ).toEqual({ ready: false, reason: "Missing reads" });
  });

  it("blocks paired-read pipelines when R2 is missing", () => {
    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(true, true),
        sample: { read: { file1: "sample_R1.fastq.gz" } },
      })
    ).toEqual({ ready: false, reason: "Missing R2 file" });
  });

  it("blocks read-consuming pipelines when linked files are stale", () => {
    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(true),
        sample: {
          read: {
            file1: "sample_R1.fastq.gz",
            file2: "sample_R2.fastq.gz",
            filesMissing: true,
          },
        },
      })
    ).toEqual({ ready: false, reason: "Files missing" });
  });

  it("only marks raw or unknown reads ready for read cleaning", () => {
    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(true, false, "read-cleaning"),
        sample: {
          read: {
            file1: "sample_R1.fastq.gz",
            dataClass: "cleaned",
          },
        },
      })
    ).toEqual({ ready: false, reason: "Needs raw or unknown reads" });

    expect(
      getOrderPipelineSampleReadiness({
        pipeline: pipeline(true, false, "read-cleaning"),
        sample: {
          read: {
            file1: "sample_R1.fastq.gz",
            dataClass: "raw",
          },
        },
      })
    ).toEqual({ ready: true });
  });
});
