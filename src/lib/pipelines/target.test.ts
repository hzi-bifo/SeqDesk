import { describe, expect, it } from "vitest";

import {
  getPipelineSampleWhere,
  getPipelineTargetId,
  getPipelineTargetWhere,
  isOrderTarget,
  isStudyTarget,
  supportsPipelineTarget,
} from "./target";
import type { PipelineDefinition, PipelineTarget } from "./types";

function makeDefinition(supportedScopes: PipelineDefinition["input"]["supportedScopes"]) {
  return {
    input: {
      supportedScopes,
      perSample: {
        reads: true,
        pairedEnd: true,
      },
    },
  } as Pick<PipelineDefinition, "input">;
}

describe("pipeline target helpers", () => {
  it("distinguishes study and order targets", () => {
    const studyTarget: PipelineTarget = { type: "study", studyId: "study-1" };
    const orderTarget: PipelineTarget = { type: "order", orderId: "order-1" };

    expect(isStudyTarget(studyTarget)).toBe(true);
    expect(isOrderTarget(studyTarget)).toBe(false);
    expect(isOrderTarget(orderTarget)).toBe(true);
    expect(isStudyTarget(orderTarget)).toBe(false);
  });

  it("resolves ids and where clauses for study and order targets", () => {
    expect(
      getPipelineTargetId({ type: "study", studyId: "study-1" })
    ).toBe("study-1");
    expect(
      getPipelineTargetId({ type: "order", orderId: "order-1" })
    ).toBe("order-1");

    expect(
      getPipelineTargetWhere({ type: "study", studyId: "study-1" })
    ).toEqual({ studyId: "study-1" });
    expect(
      getPipelineTargetWhere({ type: "order", orderId: "order-1" })
    ).toEqual({ orderId: "order-1" });
  });

  it("adds sample filters only when sample ids are provided", () => {
    expect(
      getPipelineSampleWhere({
        type: "study",
        studyId: "study-1",
        sampleIds: ["sample-1", "sample-2"],
      })
    ).toEqual({
      studyId: "study-1",
      id: { in: ["sample-1", "sample-2"] },
    });

    expect(
      getPipelineSampleWhere({
        type: "order",
        orderId: "order-1",
        sampleIds: [],
      })
    ).toEqual({
      orderId: "order-1",
    });
  });

  it("matches supported scopes for order and study targets", () => {
    const orderTarget: PipelineTarget = { type: "order", orderId: "order-1" };
    const studyTarget: PipelineTarget = { type: "study", studyId: "study-1" };

    expect(supportsPipelineTarget(makeDefinition(["order"]), orderTarget)).toBe(true);
    expect(supportsPipelineTarget(makeDefinition(["study"]), orderTarget)).toBe(false);

    expect(supportsPipelineTarget(makeDefinition(["study"]), studyTarget)).toBe(true);
    expect(supportsPipelineTarget(makeDefinition(["sample"]), studyTarget)).toBe(true);
    expect(supportsPipelineTarget(makeDefinition(["samples"]), studyTarget)).toBe(true);
    expect(supportsPipelineTarget(makeDefinition(["order"]), studyTarget)).toBe(false);
  });
});
