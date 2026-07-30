import { describe, expect, it } from "vitest";

import {
  buildRuntimeRunCreateBody,
  resolveRuntimeRunConfig,
} from "./lib/pipeline-e2e-config.mjs";

describe("runtime E2E config selection", () => {
  it("omits per-run config when saved config is the only allowed source", () => {
    const config = resolveRuntimeRunConfig({
      defaultConfig: {},
      overrideConfig: {},
      overrideProvided: false,
      savedConfigOnly: true,
    });

    expect(config).toBeUndefined();
    expect(
      buildRuntimeRunCreateBody({
        pipelineId: "seqdesk-store-e2e-fixture",
        orderId: "order-1",
        studyId: undefined,
        config,
        executionMode: "local",
        slurm: undefined,
      })
    ).toEqual({
      pipelineId: "seqdesk-store-e2e-fixture",
      orderId: "order-1",
      executionMode: "local",
    });
  });

  it("fails closed when an explicit config source is present in saved-only mode", () => {
    expect(() =>
      resolveRuntimeRunConfig({
        defaultConfig: {},
        overrideConfig: {},
        overrideProvided: true,
        savedConfigOnly: true,
      })
    ).toThrow(/cannot be combined with --config-json/);
  });

  it("fails closed when harness defaults could mask missing saved config", () => {
    expect(() =>
      resolveRuntimeRunConfig({
        defaultConfig: { fixtureLabel: "fallback" },
        overrideConfig: {},
        overrideProvided: false,
        savedConfigOnly: true,
      })
    ).toThrow(/requires an empty harness default config/);
  });

  it("preserves normal default and explicit override behavior", () => {
    expect(
      resolveRuntimeRunConfig({
        defaultConfig: { reportTitle: "default", strict: true },
        overrideConfig: { reportTitle: "override" },
        overrideProvided: true,
        savedConfigOnly: false,
      })
    ).toEqual({
      reportTitle: "override",
      strict: true,
    });
  });
});
