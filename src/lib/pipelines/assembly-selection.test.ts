import { describe, expect, it } from "vitest";

import {
  getAvailableAssemblies,
  resolveAssemblySelection,
  type AssemblySelectionAssembly,
  type AssemblySelectionSample,
} from "./assembly-selection";

function makeAssembly(
  id: string,
  options?: Partial<AssemblySelectionAssembly>
): AssemblySelectionAssembly {
  return {
    id,
    assemblyFile: `${id}.fasta`,
    ...options,
  };
}

describe("assembly-selection", () => {
  it("filters assemblies without usable assembly files and sorts by recency", () => {
    const sample: AssemblySelectionSample = {
      assemblies: [
        makeAssembly("a", {
          assemblyFile: " ",
          createdByPipelineRun: { createdAt: "2024-01-02T00:00:00Z" },
        }),
        makeAssembly("b", {
          createdByPipelineRun: { createdAt: "2024-01-01T00:00:00Z" },
        }),
        makeAssembly("c", {
          createdByPipelineRun: { createdAt: new Date("2024-01-03T00:00:00Z") },
        }),
        makeAssembly("d", {
          assemblyFile: null,
        }),
      ],
    };

    const result = getAvailableAssemblies(sample);

    expect(result.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("uses run-presence and id as tiebreakers", () => {
    const sample: AssemblySelectionSample = {
      assemblies: [
        makeAssembly("a", { createdByPipelineRun: { createdAt: null } }),
        makeAssembly("b", { createdByPipelineRunId: "run-b" }),
        makeAssembly("c", { createdByPipelineRun: { createdAt: null } }),
      ],
    };

    const result = getAvailableAssemblies(sample);

    expect(result.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("auto-selects fallback when no preferred assembly is set", () => {
    const sample: AssemblySelectionSample = {
      assemblies: [
        makeAssembly("newest", {
          createdByPipelineRun: { createdAt: "2024-01-03T00:00:00Z" },
        }),
        makeAssembly("older", {
          createdByPipelineRun: { createdAt: "2024-01-01T00:00:00Z" },
        }),
      ],
    };

    const result = resolveAssemblySelection(sample);

    expect(result.assembly?.id).toBe("newest");
    expect(result.fallbackAssembly?.id).toBe("newest");
    expect(result.source).toBe("auto");
    expect(result.preferredMissing).toBe(false);
  });

  it("returns none when no assembly is available", () => {
    const sample: AssemblySelectionSample = {
      assemblies: [
        makeAssembly("no-file", { assemblyFile: "" }),
        makeAssembly("also-no-file", { assemblyFile: null }),
      ],
    };

    const result = resolveAssemblySelection(sample);

    expect(result.assembly).toBeNull();
    expect(result.fallbackAssembly).toBeNull();
    expect(result.source).toBe("none");
    expect(result.preferredMissing).toBe(false);
  });

  it("uses preferred assembly when available", () => {
    const sample: AssemblySelectionSample = {
      preferredAssemblyId: "target",
      assemblies: [
        makeAssembly("fallback", {
          createdByPipelineRun: { createdAt: "2024-01-03T00:00:00Z" },
        }),
        makeAssembly("target", {
          createdByPipelineRun: { createdAt: "2024-01-01T00:00:00Z" },
        }),
      ],
    };

    const result = resolveAssemblySelection(sample);

    expect(result.assembly?.id).toBe("target");
    expect(result.fallbackAssembly?.id).toBe("fallback");
    expect(result.source).toBe("preferred");
    expect(result.preferredMissing).toBe(false);
  });

  it("falls back when preferred assembly is missing unless strict mode is enabled", () => {
    const sample: AssemblySelectionSample = {
      preferredAssemblyId: "missing",
      assemblies: [
        makeAssembly("fallback", {
          createdByPipelineRun: { createdAt: "2024-01-03T00:00:00Z" },
        }),
      ],
    };

    const nonStrict = resolveAssemblySelection(sample);
    const strict = resolveAssemblySelection(sample, { strictPreferred: true });

    expect(nonStrict.assembly?.id).toBe("fallback");
    expect(nonStrict.source).toBe("missing_preferred");
    expect(nonStrict.preferredMissing).toBe(true);

    expect(strict.assembly).toBeNull();
    expect(strict.fallbackAssembly?.id).toBe("fallback");
    expect(strict.source).toBe("missing_preferred");
    expect(strict.preferredMissing).toBe(true);
  });
});
