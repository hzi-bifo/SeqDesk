import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPackageCache, getPackage } from "./package-loader";
import { clearRegistryCache, getPipelineDefinition } from "./registry";
import {
  assertPackageId,
  installPackageDirectory,
  writePackageFiles,
} from "./package-install";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "package-install-"));
});

afterEach(async () => {
  clearPackageCache();
  clearRegistryCache();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("package install helpers", () => {
  it("accepts package id from stringified manifest payloads", () => {
    expect(() =>
      assertPackageId(
        {
          files: {
            "manifest.json": JSON.stringify({
              package: {
                id: "mag",
              },
            }),
          },
        },
        "mag"
      )
    ).not.toThrow();
  });

  it("writes package files from a files map payload", async () => {
    const targetDir = path.join(tempDir, "pkg");
    await writePackageFiles(
      targetDir,
      {
        files: {
          "manifest.json": JSON.stringify({
            package: {
              id: "mag",
            },
          }),
          "definition.json": "{}",
        },
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "definition.json"), "utf8")).resolves.toBe(
      "{}"
    );
  });

  it("restores the previous install when replacement swap fails", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await fs.writeFile(path.join(stageDir, "manifest.json"), "new");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")).resolves.toBe(
      "old"
    );
  });

  it("installs a store payload that package-loader and registry can expose", async () => {
    const previousCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const pipelinesDir = path.join(tempDir, "pipelines");
      const payload = {
        files: {
          "manifest.json": JSON.stringify({
            manifestVersion: 1,
            package: {
              id: "mag",
              name: "nf-core/mag",
              version: "3.0.0",
              description: "Metagenome assembly and binning",
            },
            files: {
              definition: "definition.json",
              registry: "registry.json",
              samplesheet: "samplesheet.yaml",
            },
            inputs: [],
            execution: {
              type: "nextflow",
              pipeline: "nf-core/mag",
              version: "3.0.0",
              profiles: ["conda"],
              defaultParams: {},
              monitoring: {
                weblog: {
                  enabled: true,
                },
              },
              completionDetection: {
                primary: "weblog",
              },
              slurmConfig: {
                headJobResources: {
                  cpus: 2,
                },
              },
            },
            outputs: [],
          }),
          "definition.json": JSON.stringify({
            pipeline: "mag",
            name: "nf-core/mag",
            description: "Metagenome assembly and binning",
            version: "3.0.0",
            steps: [],
            inputs: [],
            outputs: [],
          }),
          "registry.json": JSON.stringify({
            id: "mag",
            name: "MAG Pipeline",
            description: "Metagenome assembly and binning",
            category: "metagenomics",
            version: "3.0.0",
            requires: {
              reads: true,
              assemblies: false,
              bins: false,
              checksums: false,
              studyAccession: false,
              sampleMetadata: false,
            },
            outputs: [],
            visibility: {
              showToUser: true,
              userCanStart: false,
            },
            input: {
              supportedScopes: ["study"],
              minSamples: 1,
              perSample: {
                reads: true,
                pairedEnd: true,
              },
            },
            samplesheet: {
              format: "csv",
              generator: "samplesheet.yaml",
            },
            configSchema: {
              type: "object",
              properties: {},
            },
            defaultConfig: {},
            icon: "dna",
          }),
          "samplesheet.yaml": "samplesheet:\n  format: csv\n  filename: mag.csv\n  rows:\n    scope: study\n  columns: []\n",
        },
      };

      await installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await writePackageFiles(stageDir, payload, "mag");
      });

      clearPackageCache();
      clearRegistryCache();

      const pkg = getPackage("mag");
      const registryDefinition = getPipelineDefinition("mag");

      expect(pkg?.manifest.package.id).toBe("mag");
      expect(registryDefinition?.id).toBe("mag");
      expect(registryDefinition?.name).toBe("MAG Pipeline");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
