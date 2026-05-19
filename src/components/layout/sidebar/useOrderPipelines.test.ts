import { describe, expect, it } from "vitest";
import { getOrderPipelineProgressStatuses } from "./useOrderPipelines";

describe("getOrderPipelineProgressStatuses", () => {
  it("marks pipelines with completed runs as complete", () => {
    expect(
      getOrderPipelineProgressStatuses([
        { pipelineId: "simulate-reads", status: "completed" },
      ])
    ).toEqual({
      "simulate-reads": "complete",
    });
  });

  it("marks active pipelines as active even when a completed run exists", () => {
    expect(
      getOrderPipelineProgressStatuses([
        { pipelineId: "simulate-reads", status: "completed" },
        { pipelineId: "simulate-reads", status: "running" },
      ])
    ).toEqual({
      "simulate-reads": "active",
    });
  });

  it("marks failed-only pipelines as failed", () => {
    expect(
      getOrderPipelineProgressStatuses([
        { pipelineId: "fastq-checksum", status: "failed" },
      ])
    ).toEqual({
      "fastq-checksum": "failed",
    });
  });

  it("uses the latest finished run when no run is active", () => {
    expect(
      getOrderPipelineProgressStatuses([
        {
          pipelineId: "fastq-checksum",
          status: "completed",
          createdAt: "2026-05-18T12:00:00.000Z",
        },
        {
          pipelineId: "fastq-checksum",
          status: "failed",
          createdAt: "2026-05-19T12:00:00.000Z",
        },
      ])
    ).toEqual({
      "fastq-checksum": "failed",
    });
  });

  it("returns an empty status map when there are no runs", () => {
    expect(getOrderPipelineProgressStatuses([])).toEqual({});
  });
});
