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

  it("marks running pipelines as partial even when a completed run exists", () => {
    expect(
      getOrderPipelineProgressStatuses([
        { pipelineId: "simulate-reads", status: "completed" },
        { pipelineId: "simulate-reads", status: "running" },
      ])
    ).toEqual({
      "simulate-reads": "partial",
    });
  });

  it("marks failed-only pipelines as partial", () => {
    expect(
      getOrderPipelineProgressStatuses([
        { pipelineId: "fastq-checksum", status: "failed" },
      ])
    ).toEqual({
      "fastq-checksum": "partial",
    });
  });

  it("returns an empty status map when there are no runs", () => {
    expect(getOrderPipelineProgressStatuses([])).toEqual({});
  });
});
