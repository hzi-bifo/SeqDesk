import { describe, expect, it } from "vitest";

import {
  normalizePipelinePerSampleInput,
  pipelineRequiresPairedReads,
  resolvePipelineReadMode,
} from "./read-mode";

describe("read-mode", () => {
  it("defaults legacy pairedEnd=false pipelines to single_or_paired", () => {
    expect(resolvePipelineReadMode({ reads: true, pairedEnd: false })).toBe("single_or_paired");
    expect(pipelineRequiresPairedReads({ reads: true, pairedEnd: false })).toBe(false);
  });

  it("defaults legacy pairedEnd=true pipelines to paired_only", () => {
    expect(resolvePipelineReadMode({ reads: true, pairedEnd: true })).toBe("paired_only");
    expect(pipelineRequiresPairedReads({ reads: true, pairedEnd: true })).toBe(true);
  });

  it("prefers explicit readMode over legacy pairedEnd flags", () => {
    expect(
      resolvePipelineReadMode({
        reads: true,
        pairedEnd: true,
        readMode: "single_or_paired",
      })
    ).toBe("single_or_paired");
  });

  it("normalizes compatibility fields from explicit readMode", () => {
    expect(
      normalizePipelinePerSampleInput({
        reads: true,
        pairedEnd: false,
        readMode: "paired_only",
      })
    ).toEqual({
      reads: true,
      pairedEnd: true,
      readMode: "paired_only",
    });
  });
});
