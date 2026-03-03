import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findStepByProcessFromPackage: vi.fn(),
  getAllPackageIds: vi.fn(),
  getPackageDefinition: vi.fn(),
  getStepsFromPackage: vi.fn(),
  hasPackage: vi.fn(),
  packageToDagData: vi.fn(),
}));

vi.mock("./package-loader", () => ({
  findStepByProcessFromPackage: mocks.findStepByProcessFromPackage,
  getAllPackageIds: mocks.getAllPackageIds,
  getPackageDefinition: mocks.getPackageDefinition,
  getStepsFromPackage: mocks.getStepsFromPackage,
  hasPackage: mocks.hasPackage,
  packageToDagData: mocks.packageToDagData,
}));

import { findStepByProcess, getAvailablePipelineDefinitions, getPipelineDag, getPipelineDefinition, getStepById, getStepsForPipeline, hasPipelineDefinition, extractProcessName } from "./definitions";

const sampleStep = {
  id: "assembly",
  name: "Assembly",
  description: "Assemble reads",
  category: "assembly",
  dependsOn: ["qc"],
};

describe("definitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates DAG resolution to package loader", () => {
    const dag = {
      nodes: [
        {
          id: "n1",
          name: "N1",
          order: 0,
          nodeType: "step" as const,
        },
      ],
      edges: [],
    };
    mocks.packageToDagData.mockReturnValue(dag);

    expect(getPipelineDag("mag")).toBe(dag);
    expect(mocks.packageToDagData).toHaveBeenCalledWith("mag");
  });

  it("returns null from getPipelineDag for unknown pipeline", () => {
    mocks.packageToDagData.mockReturnValue(null);

    expect(getPipelineDag("missing")).toBeNull();
  });

  it("returns typed pipeline definition and falls back to null", () => {
    const definition = {
      pipeline: "mag",
      steps: [],
      version: "1.0.0",
    };
    mocks.getPackageDefinition.mockReturnValueOnce(definition as never);

    expect(getPipelineDefinition("mag")).toEqual(definition);

    mocks.getPackageDefinition.mockReturnValueOnce(null);
    expect(getPipelineDefinition("missing")).toBeNull();
  });

  it("extracts process names with and without sample suffixes", () => {
    expect(extractProcessName("NFCORE_MAG:MAG:FASTQC_RAW (sample-1)")).toBe("FASTQC_RAW");
    expect(extractProcessName("FASTQC")).toBe("FASTQC");
    expect(extractProcessName("a:b:c" )).toBe("c");
  });

  it("delegates process-to-step mapping and step lookup", () => {
    mocks.findStepByProcessFromPackage.mockReturnValue(sampleStep as never);
    mocks.getPackageDefinition.mockReturnValue({ steps: [sampleStep], pipeline: "mag" } as never);
    mocks.getStepsFromPackage.mockReturnValue([sampleStep] as never);

    expect(findStepByProcess("mag", "NFCORE_MAG:MAG:ASSEMBLY")).toBe(sampleStep);
    expect(getStepsForPipeline("mag")).toEqual([sampleStep]);
    expect(getStepById("mag", "assembly")).toEqual(sampleStep);

    expect(getStepById("mag", "missing")).toBeNull();
    expect(mocks.findStepByProcessFromPackage).toHaveBeenCalledWith("mag", "NFCORE_MAG:MAG:ASSEMBLY");
    expect(mocks.getStepsFromPackage).toHaveBeenCalledWith("mag");
  });

  it("proxies available pipeline IDs and existence checks", () => {
    mocks.getAllPackageIds.mockReturnValue(["mag", "submg"]);
    mocks.hasPackage.mockReturnValue(true);

    expect(getAvailablePipelineDefinitions()).toEqual(["mag", "submg"]);
    expect(hasPipelineDefinition("mag")).toBe(true);
  });
});
