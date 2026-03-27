import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllPackages: vi.fn(),
  getAllPackageIds: vi.fn(),
  packageToPipelineDefinition: vi.fn(),
}));

vi.mock("./package-loader", () => ({
  getAllPackages: mocks.getAllPackages,
  getAllPackageIds: mocks.getAllPackageIds,
  packageToPipelineDefinition: mocks.packageToPipelineDefinition,
}));

import {
  PIPELINE_REGISTRY,
  canRunPipeline,
  clearRegistryCache,
  getAllPipelineIds,
  getPipelineDefinition,
} from "./registry";
import type { PipelineDefinition } from "./types";

function makePipelineDefinition(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  return {
    id: "mag",
    name: "MAG",
    description: "MAG pipeline",
    category: "analysis",
    requires: {
      reads: false,
      assemblies: false,
      bins: false,
      checksums: false,
      studyAccession: false,
      sampleMetadata: false,
    },
    outputs: [],
    visibility: {
      showToUser: true,
      userCanStart: true,
    },
    input: {
      supportedScopes: ["study", "samples"],
      perSample: {
        reads: false,
        pairedEnd: false,
        readMode: undefined,
        assemblies: false,
        bins: false,
      },
    },
    samplesheet: {
      format: "csv",
      generator: "gen",
    },
    configSchema: {
      type: "object",
      properties: {},
    },
    defaultConfig: {},
    icon: "beaker",
    ...overrides,
  };
}

function makeStudy(overrides?: Partial<{
  samples: Array<{
    reads: Array<{ file1: string | null; file2: string | null }>;
    assemblies: Array<{ id: string }>;
    bins: Array<{ id: string }>;
  }>;
  studyAccessionId: string | null;
}>): {
  samples: Array<{
    reads: Array<{ file1: string | null; file2: string | null }>;
    assemblies: Array<{ id: string }>;
    bins: Array<{ id: string }>;
  }>;
  studyAccessionId: string | null;
} {
  return {
    samples: [
      {
        reads: [{ file1: "/tmp/r1.fastq.gz", file2: "/tmp/r2.fastq.gz" }],
        assemblies: [{ id: "asm-1" }],
        bins: [{ id: "bin-1" }],
      },
    ],
    studyAccessionId: "PRJ123456",
    ...overrides,
  };
}

describe("registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistryCache();
  });

  it("delegates getPipelineDefinition and getAllPipelineIds to package loader", () => {
    const def = makePipelineDefinition();
    mocks.packageToPipelineDefinition.mockReturnValue(def);
    mocks.getAllPackageIds.mockReturnValue(["mag", "submg"]);

    expect(getPipelineDefinition("mag")).toBe(def);
    expect(getAllPipelineIds()).toEqual(["mag", "submg"]);
    expect(mocks.packageToPipelineDefinition).toHaveBeenCalledWith("mag");
  });

  it("builds and caches PIPELINE_REGISTRY via proxy behavior", () => {
    const magDef = makePipelineDefinition({ id: "mag" });
    const submgDef = makePipelineDefinition({ id: "submg", category: "submission" });

    mocks.getAllPackages.mockReturnValue([{ id: "mag" }, { id: "submg" }]);
    mocks.packageToPipelineDefinition
      .mockReturnValueOnce(magDef)
      .mockReturnValueOnce(submgDef);

    expect(PIPELINE_REGISTRY.mag).toBe(magDef);
    expect(Object.keys(PIPELINE_REGISTRY)).toEqual(["mag", "submg"]);
    expect("mag" in PIPELINE_REGISTRY).toBe(true);

    mocks.getAllPackages.mockReturnValue([{ id: "changed" }]);
    expect(PIPELINE_REGISTRY.mag).toBe(magDef);
    expect(mocks.getAllPackages).toHaveBeenCalledTimes(1);
  });

  it("refreshes cached registry after clearRegistryCache", () => {
    const oldDef = makePipelineDefinition({ id: "mag" });
    const newDef = makePipelineDefinition({ id: "new-mag", name: "New MAG" });

    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(oldDef);
    expect(PIPELINE_REGISTRY.mag).toBe(oldDef);

    clearRegistryCache();
    mocks.getAllPackages.mockReturnValue([{ id: "new-mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(newDef);

    expect(PIPELINE_REGISTRY["new-mag"]).toBe(newDef);
    expect(mocks.getAllPackages).toHaveBeenCalledTimes(2);
  });

  it("returns pipeline-not-found issue when pipeline ID is unknown", () => {
    mocks.getAllPackages.mockReturnValue([]);
    const result = canRunPipeline("missing", makeStudy());

    expect(result).toEqual({
      canRun: false,
      issues: ["Pipeline not found"],
    });
  });

  it("checks min/max samples and study accession requirements", () => {
    const def = makePipelineDefinition({
      input: {
        supportedScopes: ["study"],
        minSamples: 2,
        maxSamples: 3,
        perSample: {
          reads: false,
          pairedEnd: false,
        },
      },
      requires: {
        studyAccession: true,
      },
    });
    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(def);

    const tooFew = canRunPipeline("mag", makeStudy({ samples: [], studyAccessionId: null }));
    expect(tooFew.canRun).toBe(false);
    expect(tooFew.issues).toContain("Requires at least 2 sample(s)");
    expect(tooFew.issues).toContain("Study must have an ENA accession number");

    const tooMany = canRunPipeline(
      "mag",
      makeStudy({
        samples: [
          { reads: [], assemblies: [], bins: [] },
          { reads: [], assemblies: [], bins: [] },
          { reads: [], assemblies: [], bins: [] },
          { reads: [], assemblies: [], bins: [] },
        ],
      })
    );
    expect(tooMany.canRun).toBe(false);
    expect(tooMany.issues).toContain("Maximum 3 sample(s) allowed");
  });

  it("checks per-sample reads, paired-end, assemblies and bins requirements", () => {
    const def = makePipelineDefinition({
      input: {
        supportedScopes: ["study"],
        perSample: {
          reads: true,
          pairedEnd: true,
          assemblies: true,
          bins: true,
        },
      },
    });
    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(def);

    const missingReads = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: null, file2: null }], assemblies: [{ id: "a" }], bins: [{ id: "b" }] }],
      })
    );
    expect(missingReads.issues).toContain("All samples must have reads assigned");

    const missingPairs = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: "/tmp/r1.fastq.gz", file2: null }], assemblies: [{ id: "a" }], bins: [{ id: "b" }] }],
      })
    );
    expect(missingPairs.issues).toContain("All samples must have paired-end reads");

    const missingAsm = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: "/tmp/r1.fastq.gz", file2: "/tmp/r2.fastq.gz" }], assemblies: [], bins: [{ id: "b" }] }],
      })
    );
    expect(missingAsm.issues).toContain("All samples must have assemblies");

    const missingBins = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: "/tmp/r1.fastq.gz", file2: "/tmp/r2.fastq.gz" }], assemblies: [{ id: "a" }], bins: [] }],
      })
    );
    expect(missingBins.issues).toContain("All samples must have bins");
  });

  it("prefers explicit readMode when checking paired-read requirements", () => {
    const def = makePipelineDefinition({
      input: {
        supportedScopes: ["study"],
        perSample: {
          reads: true,
          pairedEnd: false,
          readMode: "paired_only",
        },
      },
    });
    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(def);

    const result = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: "/tmp/r1.fastq.gz", file2: null }], assemblies: [], bins: [] }],
      })
    );

    expect(result.issues).toContain("All samples must have paired-end reads");
  });

  it("checks study-level reads and assemblies requirements", () => {
    const def = makePipelineDefinition({
      requires: {
        reads: true,
        assemblies: true,
      },
      input: {
        supportedScopes: ["study"],
        perSample: {
          reads: false,
          pairedEnd: false,
          assemblies: false,
          bins: false,
        },
      },
    });
    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(def);

    const result = canRunPipeline(
      "mag",
      makeStudy({
        samples: [{ reads: [{ file1: null, file2: null }], assemblies: [], bins: [] }],
      })
    );

    expect(result.canRun).toBe(false);
    expect(result.issues).toContain("Study must have samples with reads");
    expect(result.issues).toContain("Study must have samples with assemblies");
  });

  it("returns canRun=true with no issues when all requirements are met", () => {
    const def = makePipelineDefinition({
      input: {
        supportedScopes: ["study"],
        minSamples: 1,
        maxSamples: 2,
        perSample: {
          reads: true,
          pairedEnd: true,
          assemblies: true,
          bins: true,
        },
      },
      requires: {
        reads: true,
        assemblies: true,
        studyAccession: true,
      },
    });
    mocks.getAllPackages.mockReturnValue([{ id: "mag" }]);
    mocks.packageToPipelineDefinition.mockReturnValue(def);

    const result = canRunPipeline("mag", makeStudy());

    expect(result).toEqual({
      canRun: true,
      issues: [],
    });
  });
});
