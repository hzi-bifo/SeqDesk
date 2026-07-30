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

async function writeValidPackage(
  manifest = baseManifest(),
  definition: Record<string, unknown> = {}
) {
  const packageId = manifest.package.id;
  await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    "definition.json",
    JSON.stringify({
      pipeline: packageId,
      name: `${packageId} pipeline`,
      description: "Test pipeline",
      version: "1.0.0",
      steps: [],
      inputs: [],
      outputs: [],
      ...definition,
    })
  );
  await writeFile(
    "registry.json",
    JSON.stringify({
      id: packageId,
      name: `${packageId} pipeline`,
      description: "Test pipeline",
      category: "analysis",
      version: "1.0.0",
      requires: {},
      outputs: [],
      visibility: {
        showToUser: true,
        userCanStart: true,
      },
      input: {
        supportedScopes: ["study"],
        perSample: {
          reads: false,
          pairedEnd: false,
        },
      },
      samplesheet: {
        format: "csv",
        generator: "internal",
      },
      configSchema: {
        type: "object",
        properties: {},
      },
      defaultConfig: {},
      icon: "beaker",
    })
  );
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

  it.each(["../outside-workflow", "C:\\outside-workflow"])(
    "rejects local execution path outside the package directory: %s",
    async (pipeline) => {
      await writeValidPackage(
        baseManifest({
          execution: {
            type: "nextflow",
            pipeline,
            version: "1.0.0",
            profiles: ["conda"],
            defaultParams: {},
          },
        })
      );

      const result = await lintPipelineDescriptor(tempDir, "demo");

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "execution-pipeline-path" }),
        ])
      );
    }
  );

  it("rejects a missing local workflow before installation", async () => {
    await writeValidPackage();
    await fs.rm(path.join(tempDir, "workflow"), { recursive: true });

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "local-workflow-missing" }),
      ])
    );
  });

  it("does not let an unsupported custom runner hide a missing workflow", async () => {
    await writeValidPackage(
      baseManifest({
        execution: {
          type: "nextflow",
          runner: "custom",
          pipeline: "./missing-custom-runner",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "local-workflow-missing" }),
      ])
    );
  });

  it("keeps the built-in submg custom runner installable without a workflow target", async () => {
    await writeValidPackage(
      baseManifest({
        package: {
          id: "submg",
          name: "submg",
          version: "1.0.0",
          description: "Built-in custom runner",
        },
        execution: {
          type: "nextflow",
          runner: "custom",
          pipeline: "./submg",
          version: "1.0.0",
          profiles: ["conda"],
          defaultParams: {},
        },
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "submg");

    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
  });

  it("rejects duplicate parser IDs before installation", async () => {
    const manifest = baseManifest({
      files: {
        definition: "definition.json",
        registry: "registry.json",
        samplesheet: "samplesheet.yaml",
        parsers: ["parsers/first.yaml", "parsers/second.yaml"],
      },
    });
    await writeValidPackage(manifest);
    const parser =
      "parser:\n  id: duplicate\n  type: tsv\n  description: Duplicate parser\n  trigger:\n    filePattern: '*.tsv'\n  columns:\n    - name: sample\n      index: 0\n";
    await writeFile("parsers/first.yaml", parser);
    await writeFile("parsers/second.yaml", parser);

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-parser-id" }),
      ])
    );
  });

  it("rejects parser column contracts that would be ignored at runtime", async () => {
    const manifest = baseManifest({
      files: {
        definition: "definition.json",
        registry: "registry.json",
        samplesheet: "samplesheet.yaml",
        parsers: ["parsers/metrics.yaml"],
      },
      outputs: [
        {
          id: "metrics",
          scope: "sample",
          destination: "sample_metadata",
          type: "qc",
          discovery: { pattern: "metrics.tsv" },
          parsed: {
            from: "metrics",
            matchBy: "missing_sample",
            map: { quality: "missing_quality" },
          },
        },
      ],
    });
    await writeValidPackage(manifest);
    await writeFile(
      "parsers/metrics.yaml",
      "parser:\n  id: metrics\n  type: tsv\n  description: Metrics parser\n  trigger:\n    filePattern: metrics.tsv\n  columns:\n    - name: sample\n      index: 0\n    - name: sample\n      index: 1\n"
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-parser-column" }),
        expect.objectContaining({ code: "unknown-parser-match-column" }),
        expect.objectContaining({ code: "unknown-parser-map-column" }),
      ])
    );
  });

  it("requires a sample matching strategy for required sample outputs", async () => {
    await writeValidPackage(
      baseManifest({
        outputs: [
          {
            id: "sample-report",
            scope: "sample",
            destination: "sample_qc",
            discovery: { pattern: "reports/*.html" },
          },
        ],
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "sample-output-match-strategy" }),
      ])
    );
  });

  it("requires the registry per-sample flags used by the package loader", async () => {
    await writeValidPackage();
    const registryPath = path.join(tempDir, "registry.json");
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
    delete registry.input.perSample.pairedEnd;
    await fs.writeFile(registryPath, JSON.stringify(registry));

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "registry-shape" }),
      ])
    );
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

  it("rejects outputs that reference an unavailable parser", async () => {
    await writeValidPackage(
      baseManifest({
        outputs: [
          {
            id: "quality",
            scope: "sample",
            destination: "sample_qc",
            type: "qc",
            discovery: {
              pattern: "quality.tsv",
            },
            parsed: {
              from: "missing-parser",
              matchBy: "sample",
              map: {
                quality: "quality",
              },
            },
          },
        ],
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-parser", level: "error" }),
      ])
    );
  });

  it("rejects parser descriptors that would crash the parser runtime", async () => {
    await writeValidPackage(
      baseManifest({
        files: {
          definition: "definition.json",
          registry: "registry.json",
          samplesheet: "samplesheet.yaml",
          parsers: ["parsers/incomplete.yaml"],
        },
      })
    );
    await writeFile(
      "parsers/incomplete.yaml",
      "parser:\n  id: incomplete\n  type: tsv\n"
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "parser-shape", level: "error" }),
      ])
    );
  });

  it("rejects malformed samplesheet columns before installation", async () => {
    await writeValidPackage();
    await writeFile(
      "samplesheet.yaml",
      "samplesheet:\n  format: csv\n  filename: samples.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: 42\n"
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "samplesheet-shape", level: "error" }),
      ])
    );
  });

  it("rejects Read writeback outside sample scope", async () => {
    await writeValidPackage(
      baseManifest({
        outputs: [
          {
            id: "reads",
            scope: "study",
            destination: "sample_reads",
            type: "artifact",
            discovery: {
              pattern: "reads/*.fastq.gz",
            },
            writeback: {
              target: "Read",
              fields: {
                file1: "file1",
              },
            },
          },
        ],
      })
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "read-writeback-scope" }),
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

  it("reports manifest outputs that reference missing definition steps", async () => {
    await writeValidPackage(
      baseManifest({
        outputs: [
          {
            id: "summary",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            fromStep: "summary",
            discovery: {
              pattern: "summary.tsv",
            },
          },
        ],
      }),
      {
        pipeline: "demo",
        steps: [
          {
            id: "classification",
            name: "Classification",
            description: "Classify reads",
            category: "annotation",
            dependsOn: [],
            processMatchers: ["KRAKEN2"],
          },
        ],
      }
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "output-from-step-missing" }),
      ])
    );
  });

  it("reports definition outputs that reference missing definition steps", async () => {
    await writeValidPackage(
      baseManifest(),
      {
        pipeline: "demo",
        steps: [
          {
            id: "qc",
            name: "QC",
            description: "Quality control",
            category: "qc",
            dependsOn: [],
            processMatchers: ["FASTQC"],
          },
        ],
        outputs: [
          {
            id: "report",
            name: "Report",
            fromStep: "missing",
          },
        ],
      }
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "definition-output-from-step-missing" }),
      ])
    );
  });

  it("warns when definition steps cannot map Nextflow process traces", async () => {
    await writeValidPackage(
      baseManifest(),
      {
        pipeline: "demo",
        steps: [
          {
            id: "simulate_reads",
            name: "Simulate reads",
            description: "Generate test reads",
            category: "preprocessing",
            dependsOn: [],
          },
        ],
      }
    );

    const result = await lintPipelineDescriptor(tempDir, "demo");

    expect(result.valid).toBe(true);
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "step-process-matchers", level: "warning" }),
      ])
    );
  });
});
