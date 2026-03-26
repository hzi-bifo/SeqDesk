import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllPackageIds: vi.fn(),
  getPackageDefinition: vi.fn(),
  getStepsFromPackage: vi.fn(),
  findStepByProcessFromPackage: vi.fn(),
  packageToDagData: vi.fn(),
  hasPackage: vi.fn(),
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getAllPackageIds: mocks.getAllPackageIds,
  getPackageDefinition: mocks.getPackageDefinition,
  getStepsFromPackage: mocks.getStepsFromPackage,
  findStepByProcessFromPackage: mocks.findStepByProcessFromPackage,
  packageToDagData: mocks.packageToDagData,
  hasPackage: mocks.hasPackage,
}));

import {
  extractProcessName,
  findStepByProcess,
  getAvailablePipelineDefinitions,
  getPipelineDag,
  getPipelineDefinition,
  getStepById,
  getStepsForPipeline,
  hasPipelineDefinition,
} from "./index";

const sampleStep = {
  id: "assembly",
  name: "Assembly",
  description: "Assemble reads",
  category: "assembly" as const,
  dependsOn: ["qc"],
};

const qcStep = {
  id: "qc",
  name: "Quality Control",
  description: "Run QC",
  category: "qc" as const,
  dependsOn: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractProcessName", () => {
  it("extracts process name from full Nextflow path with sample suffix", () => {
    expect(extractProcessName("NFCORE_MAG:MAG:FASTQC (sample1)")).toBe(
      "FASTQC"
    );
  });

  it("returns simple process name unchanged", () => {
    expect(extractProcessName("FASTQC")).toBe("FASTQC");
  });

  it("extracts process name without sample suffix", () => {
    expect(extractProcessName("NFCORE_MAG:MAG:FASTQC")).toBe("FASTQC");
  });

  it("handles deeply nested process paths", () => {
    expect(
      extractProcessName(
        "NFCORE_MAG:MAG:BINNING_PREP:BOWTIE2_ASSEMBLY_ALIGN (sample1)"
      )
    ).toBe("BOWTIE2_ASSEMBLY_ALIGN");
  });
});

describe("getPipelineDefinition", () => {
  it("returns definition when found", () => {
    const definition = { pipeline: "mag", steps: [sampleStep] };
    mocks.getPackageDefinition.mockReturnValue(definition);

    expect(getPipelineDefinition("mag")).toEqual(definition);
    expect(mocks.getPackageDefinition).toHaveBeenCalledWith("mag");
  });

  it("returns null when not found", () => {
    mocks.getPackageDefinition.mockReturnValue(undefined);

    expect(getPipelineDefinition("nonexistent")).toBeNull();
  });
});

describe("getAvailablePipelineDefinitions", () => {
  it("returns array of pipeline IDs", () => {
    mocks.getAllPackageIds.mockReturnValue(["mag", "taxprofiler"]);

    expect(getAvailablePipelineDefinitions()).toEqual(["mag", "taxprofiler"]);
    expect(mocks.getAllPackageIds).toHaveBeenCalled();
  });
});

describe("hasPipelineDefinition", () => {
  it("returns true when package exists", () => {
    mocks.hasPackage.mockReturnValue(true);

    expect(hasPipelineDefinition("mag")).toBe(true);
    expect(mocks.hasPackage).toHaveBeenCalledWith("mag");
  });

  it("returns false when package does not exist", () => {
    mocks.hasPackage.mockReturnValue(false);

    expect(hasPipelineDefinition("unknown")).toBe(false);
  });
});

describe("getStepsForPipeline", () => {
  it("returns steps from package", () => {
    mocks.getStepsFromPackage.mockReturnValue([qcStep, sampleStep]);

    const result = getStepsForPipeline("mag");
    expect(result).toEqual([qcStep, sampleStep]);
    expect(mocks.getStepsFromPackage).toHaveBeenCalledWith("mag");
  });

  it("returns empty array for unknown pipeline", () => {
    mocks.getStepsFromPackage.mockReturnValue([]);

    expect(getStepsForPipeline("unknown")).toEqual([]);
  });
});

describe("getStepById", () => {
  it("finds step by ID", () => {
    mocks.getPackageDefinition.mockReturnValue({
      pipeline: "mag",
      steps: [qcStep, sampleStep],
    });

    expect(getStepById("mag", "assembly")).toEqual(sampleStep);
  });

  it("returns null for unknown step ID", () => {
    mocks.getPackageDefinition.mockReturnValue({
      pipeline: "mag",
      steps: [qcStep],
    });

    expect(getStepById("mag", "nonexistent")).toBeNull();
  });

  it("returns null when pipeline not found", () => {
    mocks.getPackageDefinition.mockReturnValue(undefined);

    expect(getStepById("unknown", "qc")).toBeNull();
  });
});

describe("findStepByProcess", () => {
  it("delegates to findStepByProcessFromPackage", () => {
    mocks.findStepByProcessFromPackage.mockReturnValue(sampleStep);

    expect(findStepByProcess("mag", "MEGAHIT")).toEqual(sampleStep);
    expect(mocks.findStepByProcessFromPackage).toHaveBeenCalledWith(
      "mag",
      "MEGAHIT"
    );
  });

  it("returns null when no match found", () => {
    mocks.findStepByProcessFromPackage.mockReturnValue(null);

    expect(findStepByProcess("mag", "UNKNOWN_PROCESS")).toBeNull();
  });
});

describe("getPipelineDag", () => {
  it("returns DAG data for pipeline", () => {
    const dagData = {
      nodes: [{ id: "qc", name: "QC", order: 0, nodeType: "step" as const }],
      edges: [],
    };
    mocks.packageToDagData.mockReturnValue(dagData);

    expect(getPipelineDag("mag")).toEqual(dagData);
    expect(mocks.packageToDagData).toHaveBeenCalledWith("mag");
  });

  it("returns null when pipeline has no DAG", () => {
    mocks.packageToDagData.mockReturnValue(null);

    expect(getPipelineDag("unknown")).toBeNull();
  });
});
