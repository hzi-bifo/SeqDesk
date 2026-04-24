import { describe, expect, it } from "vitest";

import {
  getSimulateReadsConfigIssues,
  normalizeSimulateReadsConfig,
} from "./simulate-reads-config";

describe("simulate-reads-config", () => {
  it("fills missing values with defaults", () => {
    expect(normalizeSimulateReadsConfig()).toEqual({
      simulationMode: "auto",
      mode: "shortReadPaired",
      readCount: 1000,
      readLength: 150,
      replaceExisting: true,
      qualityProfile: "standard",
      insertMean: 350,
      insertStdDev: 30,
      seed: null,
      templateDir: "",
    });
  });

  it("clamps and coerces numeric values based on long-read mode", () => {
    expect(
      normalizeSimulateReadsConfig({
        mode: "longRead",
        readCount: 999999,
        readLength: "120",
        insertMean: 150,
        insertStdDev: 5000,
        seed: "42",
        replaceExisting: "false",
      }),
    ).toMatchObject({
      mode: "longRead",
      readCount: 5000,
      readLength: 500,
      insertMean: 1020,
      insertStdDev: 520,
      seed: 42,
      replaceExisting: false,
    });
  });

  it("reports unsupported template plus long-read combinations", () => {
    const config = normalizeSimulateReadsConfig({
      simulationMode: "template",
      mode: "longRead",
    });

    expect(getSimulateReadsConfigIssues(config)).toEqual([
      "Template simulation is not supported for long-read mode. Choose synthetic or auto mode, or switch to a short-read mode.",
    ]);
  });
});
