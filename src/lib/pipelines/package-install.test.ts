import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPackageCache, getPackage } from "./package-loader";
import { clearRegistryCache, getPipelineDefinition } from "./registry";
import {
  assertPackageId,
  installPackageDirectory,
  resolveStorePath,
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

  it("rejects mismatched package ids from the payload metadata", () => {
    expect(() =>
      assertPackageId(
        {
          package: {
            id: "other",
          },
        },
        "mag"
      )
    ).toThrow("Package ID mismatch. Expected mag but got other.");
  });

  it("ignores invalid stringified manifests when other payload metadata matches", () => {
    expect(() =>
      assertPackageId(
        {
          id: "mag",
          files: {
            "manifest.json": "{not-json",
          },
        },
        "mag"
      )
    ).not.toThrow();
  });

  it("rejects absolute and traversal store paths", () => {
    expect(() => resolveStorePath(tempDir, "/tmp/outside")).toThrow(
      "Invalid absolute path from store: /tmp/outside"
    );
    expect(() => resolveStorePath(tempDir, "../outside")).toThrow(
      "Invalid path traversal from store: ../outside"
    );
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

  it("writes base64 encoded file arrays from store payloads", async () => {
    const targetDir = path.join(tempDir, "pkg");

    await writePackageFiles(
      targetDir,
      {
        files: [
          {
            path: "manifest.json",
            content: JSON.stringify({
              package: {
                id: "mag",
              },
            }),
          },
          {
            path: "nested/data.txt",
            content: Buffer.from("hello world").toString("base64"),
            encoding: "base64",
          },
        ],
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "nested", "data.txt"), "utf8")).resolves.toBe(
      "hello world"
    );
  });

  it("rejects invalid array file entries from the store", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          files: [{ content: "missing-path" }],
        },
        "mag"
      )
    ).rejects.toThrow("Invalid file entry from store.");
  });

  it("rejects non-string content in file maps", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          files: {
            "manifest.json": JSON.stringify({
              package: {
                id: "mag",
              },
            }),
            "definition.json": 123,
          },
        },
        "mag"
      )
    ).rejects.toThrow("Invalid file content for definition.json");
  });

  it("writes manifest, registry, samplesheet, and parser payloads", async () => {
    const targetDir = path.join(tempDir, "pkg");
    await fs.mkdir(targetDir, { recursive: true });

    await writePackageFiles(
      targetDir,
      {
        manifest: {
          package: {
            id: "mag",
          },
        },
        definition: {
          pipeline: "mag",
        },
        registry: {
          id: "mag",
        },
        samplesheet: "rows: []\n",
        parsers: {
          "parsers/result.js": "export const parse = () => [];\n",
        },
      },
      "mag"
    );

    await expect(fs.readFile(path.join(targetDir, "manifest.json"), "utf8")).resolves.toContain(
      '"id": "mag"'
    );
    await expect(
      fs.readFile(path.join(targetDir, "samplesheet.yaml"), "utf8")
    ).resolves.toBe("rows: []\n");
    await expect(
      fs.readFile(path.join(targetDir, "parsers", "result.js"), "utf8")
    ).resolves.toBe("export const parse = () => [];\n");
  });

  it("rejects unsupported package payload formats", async () => {
    await expect(
      writePackageFiles(
        path.join(tempDir, "pkg"),
        {
          manifest: {
            package: {
              id: "mag",
            },
          },
        },
        "mag"
      )
    ).rejects.toThrow("Unsupported package payload format from store.");
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

  it("returns update and removes the backup after a successful replacement", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    const result = await installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
      await fs.writeFile(path.join(stageDir, "manifest.json"), "new");
    });

    expect(result).toBe("update");
    await expect(fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")).resolves.toBe(
      "new"
    );
    await expect(
      fs.readdir(pipelinesDir).then((entries) => entries.filter((entry) => entry.includes("backup")))
    ).resolves.toEqual([]);
  });

  it("restores the backup when the staged directory cannot be swapped into place", async () => {
    const pipelinesDir = path.join(tempDir, "pipelines");
    const pipelineDir = path.join(pipelinesDir, "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "manifest.json"), "old");

    const actualRename = fs.rename.bind(fs);
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error("swap failed");
      }
      return actualRename(from, to);
    });

    await expect(
      installPackageDirectory(pipelinesDir, "mag", async (stageDir) => {
        await fs.writeFile(path.join(stageDir, "manifest.json"), "new");
      })
    ).rejects.toThrow("swap failed");

    renameSpy.mockRestore();

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
