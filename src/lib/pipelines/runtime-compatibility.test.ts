import { describe, expect, it } from "vitest";

import { getLocalCondaCompatibilityBlockMessage } from "./runtime-compatibility";

describe("runtime-compatibility", () => {
  const macArmRuntime = {
    os: "darwin",
    arch: "arm64",
    raw: "osx-arm64",
    source: "conda" as const,
  };

  it("blocks macOS ARM local conda for packages without an allow override", () => {
    const result = getLocalCondaCompatibilityBlockMessage({
      manifest: {
        package: {
          id: "mag",
          name: "nf-core/mag",
          version: "1.0.0",
          description: "MAG pipeline",
        },
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      runtimeMode: "conda",
      useSlurm: false,
      runtimePlatform: macArmRuntime,
    });

    expect(result).toContain("nf-core/mag");
    expect(result).toContain("osx-arm64 (conda)");
  });

  it("allows explicitly enabled local utility packages on macOS ARM", () => {
    const result = getLocalCondaCompatibilityBlockMessage({
      manifest: {
        package: {
          id: "simulate-reads",
          name: "Simulate Reads",
          version: "0.1.0",
          description: "Generate dummy reads",
        },
        execution: {
          type: "nextflow",
          pipeline: "./workflow",
          version: "0.1.0",
          profiles: ["conda"],
          defaultParams: {},
          runtime: {
            allowMacOsArmConda: true,
          },
        },
      },
      runtimeMode: "conda",
      useSlurm: false,
      runtimePlatform: macArmRuntime,
    });

    expect(result).toBeNull();
  });

  it("allows macOS ARM when SLURM is enabled", () => {
    const result = getLocalCondaCompatibilityBlockMessage({
      manifest: {
        package: {
          id: "mag",
          name: "nf-core/mag",
          version: "1.0.0",
          description: "MAG pipeline",
        },
        execution: {
          type: "nextflow",
          pipeline: "nf-core/mag",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      },
      runtimeMode: "conda",
      useSlurm: true,
      runtimePlatform: macArmRuntime,
    });

    expect(result).toBeNull();
  });
});
