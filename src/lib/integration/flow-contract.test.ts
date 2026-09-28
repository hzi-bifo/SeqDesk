import { describe, expect, it } from "vitest";
import { FLOW_CAPABILITIES, flowError, parseValueRef, requestIdOf, runRef, valueRef } from "./flow-contract";
import { exploreIntegrationCapabilities } from "./explore";

describe("Flow contract", () => {
  it("builds errors with the code's status and extra fields", () => {
    const error = flowError("revision_conflict", "The recipe changed.", { current: { recipeRevision: 8 } });
    expect(error.status).toBe(409);
    expect(error.code).toBe("revision_conflict");
    expect(error.extra).toEqual({ current: { recipeRevision: 8 } });
    expect(flowError("binding_lost", "x").status).toBe(422);
  });
  it("round-trips value references", () => {
    expect(runRef("r1")).toBe("labdesk://run/r1");
    const ref = valueRef("run_1", "step1", "n_called");
    expect(ref).toBe("labdesk://value/run_1/step1/n_called");
    expect(parseValueRef(ref)).toEqual({ runId: "run_1", analysisId: "step1", key: "n_called" });
    expect(parseValueRef("labdesk://run/x")).toBeNull();
  });
  it("validates request ids", () => {
    expect(requestIdOf(undefined)).toBeUndefined();
    expect(requestIdOf("flow_abcdefghijklmnop")).toBe("flow_abcdefghijklmnop");
    expect(() => requestIdOf("nope")).toThrow();
  });
  it("advertises only known capabilities", () => {
    const advertised = exploreIntegrationCapabilities({ eventsConfigured: false });
    expect(advertised).toContain("explore.flows");
    for (const capability of advertised.filter((entry) => !["explore.files", "explore.datasets", "explore.reports", "explore.flows", "explore.large-tables"].includes(entry))) {
      expect(FLOW_CAPABILITIES).toContain(capability);
    }
    expect(advertised).not.toContain("explore.events");
    expect(exploreIntegrationCapabilities({ eventsConfigured: true })).toContain("explore.events");
  });
});
