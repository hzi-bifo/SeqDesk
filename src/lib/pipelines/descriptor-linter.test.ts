import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintPipelineDescriptor } from "./descriptor-linter";

let tempDir: string;

async function writeFile(relativePath: string, content: string) {
  const filePath = path.join(tempDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1,
    package: {
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "Demo pipeline",
    },
    files: {
      definition: "definition.json",
      registry: "registry.json",
      samplesheet: "samplesheet.yaml",
      parsers: [],
    },
    inputs: [],
    execution: {
      type: "nextflow",
      pipeline: "./workflow",
      version: "1.0.0",
      profiles: ["conda"],
      defaultParams: {},
      paramMap: {},
    },
    outputs: [
      {
        id: "report",
        scope: "run",
        destination: "run_artifact",
        type: "report",
        discovery: {
          pattern: "results/**/*.html",
        },
      },
    ],
    ...overrides,
  };
}

async function writeValidPackage(manifest = baseManifest()) {
  await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile("definition.json", JSON.stringify({ pipeline: manifest.package.id }));
  await writeFile("registry.json", JSON.stringify({ id: manifest.package.id }));
  await writeFile(
    "samplesheet.yaml",
    "samplesheet:\n  format: csv\n  filename: samplesheet.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: sample.sampleId\n"
  );
  await writeFile("workflow/main.nf", "workflow {}\n");
}

describe("descriptor-linter", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "descriptor-linter-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("accepts a valid descriptor package", async () => {
    await writeValidPackage();

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
  });

  it("reports missing required files and package id mismatches", async () => {
    await writeFile(
      "manifest.json",
      JSON.stringify(baseManifest({ package: { id: "wrong", name: "Wrong", version: "1", description: "Wrong" } }))
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "package-id-mismatch" }),
        expect.objectContaining({ code: "missing-required-file" }),
      ])
    );
  });

  it("enforces staged read candidate result scope and destination", async () => {
    await writeValidPackage(
      baseManifest({
        outputs: [
          {
            id: "candidate",
            scope: "run",
            destination: "sample_reads",
            type: "artifact",
            discovery: {
              pattern: "cleaned/*.fastq.gz",
            },
            result: {
              kind: "sample_read_candidate",
              writebackPolicy: "stage_only",
            },
          },
        ],
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "read-candidate-scope" }),
        expect.objectContaining({ code: "read-candidate-destination" }),
        expect.objectContaining({ code: "read-candidate-review-policy" }),
      ])
    );
  });

  it("enforces the MetaxPath params file mapping", async () => {
    await writeValidPackage(
      baseManifest({
        package: {
          id: "metaxpath",
          name: "MetaxPath",
          version: "1.0.0",
          description: "MetaxPath",
        },
        execution: {
          type: "nextflow",
          pipeline: "./workflow",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
          paramMap: {},
        },
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "metaxpath");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "metaxpath-params-file" }),
      ])
    );
  });
});
