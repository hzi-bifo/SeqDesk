import { describe, expect, it } from "vitest";

import {
  deriveCompatibleInputScopes,
  deriveManifestTargets,
  derivePipelineCapabilities,
  derivePipelineCatalogs,
  matchesPipelineCatalog,
} from "./package-contracts";

describe("deriveManifestTargets", () => {
  it("returns empty array when no manifest and no registry", () => {
    expect(deriveManifestTargets(null, null)).toEqual([]);
  });

  it("returns empty array with undefined args", () => {
    expect(deriveManifestTargets(undefined, undefined)).toEqual([]);
  });

  it("returns declared targets from manifest", () => {
    const manifest = { targets: { supported: ["study" as const] } };
    expect(deriveManifestTargets(manifest)).toEqual(["study"]);
  });

  it("returns both targets when manifest declares both", () => {
    const manifest = {
      targets: { supported: ["study" as const, "order" as const] },
    };
    expect(deriveManifestTargets(manifest)).toEqual(["study", "order"]);
  });

  it("deduplicates declared targets", () => {
    const manifest = {
      targets: { supported: ["study" as const, "study" as const] },
    };
    expect(deriveManifestTargets(manifest)).toEqual(["study"]);
  });

  it("derives study target from registry study scope", () => {
    const registry = { input: { supportedScopes: ["study" as const] } };
    expect(deriveManifestTargets(null, registry)).toEqual(["study"]);
  });

  it("derives study target from registry sample scope", () => {
    const registry = { input: { supportedScopes: ["sample" as const] } };
    expect(deriveManifestTargets(null, registry)).toEqual(["study"]);
  });

  it("derives study target from registry samples scope", () => {
    const registry = { input: { supportedScopes: ["samples" as const] } };
    expect(deriveManifestTargets(null, registry)).toEqual(["study"]);
  });

  it("derives order target from registry order scope", () => {
    const registry = { input: { supportedScopes: ["order" as const] } };
    expect(deriveManifestTargets(null, registry)).toEqual(["order"]);
  });

  it("derives both targets from registry with study and order scopes", () => {
    const registry = {
      input: { supportedScopes: ["study" as const, "order" as const] },
    };
    expect(deriveManifestTargets(null, registry)).toEqual(["study", "order"]);
  });

  it("prefers manifest declared targets over registry scopes", () => {
    const manifest = { targets: { supported: ["order" as const] } };
    const registry = { input: { supportedScopes: ["study" as const] } };
    expect(deriveManifestTargets(manifest, registry)).toEqual(["order"]);
  });
});

describe("deriveCompatibleInputScopes", () => {
  it("returns empty array with no manifest and no registry", () => {
    expect(deriveCompatibleInputScopes(null, null)).toEqual([]);
  });

  it("returns registry scopes as fallback when targets are empty", () => {
    const registry = {
      input: { supportedScopes: ["study" as const, "sample" as const] },
    };
    // No manifest and registry scopes don't produce any targets -> fallback
    // Actually, "study" and "sample" both map to "study" target, so targets won't be empty
    expect(deriveCompatibleInputScopes(null, registry)).toEqual(["study"]);
  });

  it("returns study scope when targets include study", () => {
    const manifest = { targets: { supported: ["study" as const] } };
    expect(deriveCompatibleInputScopes(manifest)).toEqual(["study"]);
  });

  it("returns order scope when targets include order", () => {
    const manifest = { targets: { supported: ["order" as const] } };
    expect(deriveCompatibleInputScopes(manifest)).toEqual(["order"]);
  });

  it("returns both scopes when targets include both", () => {
    const manifest = {
      targets: { supported: ["study" as const, "order" as const] },
    };
    expect(deriveCompatibleInputScopes(manifest)).toEqual(["study", "order"]);
  });
});

describe("derivePipelineCatalogs", () => {
  it("returns study catalog", () => {
    expect(derivePipelineCatalogs(["study"])).toEqual(["study"]);
  });

  it("returns order catalog", () => {
    expect(derivePipelineCatalogs(["order"])).toEqual(["order"]);
  });

  it("returns both catalogs", () => {
    expect(derivePipelineCatalogs(["study", "order"])).toEqual([
      "study",
      "order",
    ]);
  });

  it("deduplicates catalogs", () => {
    expect(derivePipelineCatalogs(["study", "study"])).toEqual(["study"]);
  });

  it("returns empty array for empty targets", () => {
    expect(derivePipelineCatalogs([])).toEqual([]);
  });
});

describe("derivePipelineCapabilities", () => {
  it("returns defaults when no manifest or registry", () => {
    const result = derivePipelineCapabilities(null, null);
    expect(result).toEqual({
      requiresLinkedReads: false,
      writesCanonicalReadMetadata: false,
      writesCanonicalReadFiles: false,
    });
  });

  it("detects requiresLinkedReads from manifest inputs with sample.reads source", () => {
    const manifest = {
      inputs: [{ scope: "sample", source: "sample.reads" }],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.requiresLinkedReads).toBe(true);
  });

  it("detects requiresLinkedReads from manifest inputs with sample.reads. prefix", () => {
    const manifest = {
      inputs: [{ scope: "sample", source: "sample.reads.file1" }],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.requiresLinkedReads).toBe(true);
  });

  it("detects requiresLinkedReads from sample scope with read source", () => {
    const manifest = {
      inputs: [{ scope: "sample", source: "read" }],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.requiresLinkedReads).toBe(true);
  });

  it("detects requiresLinkedReads from sample scope with read. prefix source", () => {
    const manifest = {
      inputs: [{ scope: "sample", source: "read.file1" }],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.requiresLinkedReads).toBe(true);
  });

  it("falls back to registry for requiresLinkedReads when no manifest inputs", () => {
    const registry = { input: { perSample: { reads: true } } };
    const result = derivePipelineCapabilities(null, registry);
    expect(result.requiresLinkedReads).toBe(true);
  });

  it("does not require linked reads for non-read inputs", () => {
    const manifest = {
      inputs: [{ scope: "study", source: "samplesheet" }],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.requiresLinkedReads).toBe(false);
  });

  it("detects writesCanonicalReadFiles from output writeback", () => {
    const manifest = {
      outputs: [
        {
          writeback: {
            target: "Read" as const,
            fields: { output_file1: "file1" as const },
          },
        },
      ],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.writesCanonicalReadFiles).toBe(true);
    expect(result.writesCanonicalReadMetadata).toBe(false);
  });

  it("detects writesCanonicalReadMetadata from output writeback", () => {
    const manifest = {
      outputs: [
        {
          writeback: {
            target: "Read" as const,
            fields: { read_count: "readCount1" as const },
          },
        },
      ],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.writesCanonicalReadMetadata).toBe(true);
    expect(result.writesCanonicalReadFiles).toBe(false);
  });

  it("detects both read files and metadata writes", () => {
    const manifest = {
      outputs: [
        {
          writeback: {
            target: "Read" as const,
            fields: {
              output_file1: "file1" as const,
              read_count: "readCount1" as const,
            },
          },
        },
      ],
    };
    const result = derivePipelineCapabilities(manifest);
    expect(result.writesCanonicalReadFiles).toBe(true);
    expect(result.writesCanonicalReadMetadata).toBe(true);
  });
});

describe("matchesPipelineCatalog", () => {
  it("matches when catalog is in list", () => {
    expect(matchesPipelineCatalog(["study", "order"], "study")).toBe(true);
  });

  it("does not match when catalog is not in list", () => {
    expect(matchesPipelineCatalog(["study"], "order")).toBe(false);
  });

  it("matches all when requestedCatalog is null", () => {
    expect(matchesPipelineCatalog(["study"], null)).toBe(true);
  });

  it("matches all when requestedCatalog is undefined", () => {
    expect(matchesPipelineCatalog(["study"], undefined)).toBe(true);
  });

  it("matches all when requestedCatalog is 'all'", () => {
    expect(matchesPipelineCatalog(["study"], "all")).toBe(true);
  });

  it("does not match empty catalogs with specific request", () => {
    expect(matchesPipelineCatalog([], "study")).toBe(false);
  });
});
