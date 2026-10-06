import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { fillMethods } from "./pipeline-methods";
import { RECORD_HINTS } from "./pipeline-record";
import { samplesWithoutResultWords } from "./builders/pipeline-table";

const values = (samples: number | null) => ({ pipeline: "FastQC", version: "0.12", samples, params: {}, reference: null, outputs: {} });

describe("sentence wording", () => {
  it("writes one sample as singular and keeps plurals", () => {
    const template = "Read quality was checked with {pipeline} {version} ({samples} samples).";
    expect(fillMethods(template, values(1)).text).toBe("Read quality was checked with FastQC 0.12 (1 sample).");
    expect(fillMethods(template, values(11)).text).toContain("(11 samples)");
    expect(fillMethods(template, values(42)).text).toContain("(42 samples)");
  });

  it("does not mention MultiQC in the FastQC record", () => {
    expect(RECORD_HINTS.fastqc.methods).not.toMatch(/multiqc/i);
    expect(RECORD_HINTS.fastqc.citations?.map((citation) => citation.short)).toEqual(["Andrews 2010"]);
  });

  it("counts missing results among the run's own samples only", () => {
    const scope = Array.from({ length: 42 }, (_, i) => `s${i}`);
    // A 1-sample run with its result: nothing is missing, however big the scope.
    expect(samplesWithoutResultWords(scope, new Set(["s0"]), [{ sampleId: null, inputSampleIds: ["s0"] }])).toBeNull();
    expect(samplesWithoutResultWords(scope, new Set(["s0"]), [{ sampleId: null, inputSampleIds: ["s0", "s1"] }])).toBe("1 sample has no usable result in this dataset.");
    expect(samplesWithoutResultWords(scope, new Set(["s0"]), [{ sampleId: null, inputSampleIds: ["s0", "s1", "s2"] }])).toBe("2 samples have no usable result in this dataset.");
    // Runs that name no samples fall back to the scope.
    expect(samplesWithoutResultWords(["a", "b"], new Set(["a"]), [])).toBe("1 sample has no usable result in this dataset.");
  });
});
