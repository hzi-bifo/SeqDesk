import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";

import {
  clearPackageCache,
  getAllPackageIds,
  getAllPackages,
  getPackage,
  getPackageDefinition,
  getPackageManifest,
  getPackageParsers,
  getPackageRegistry,
  getPackageSamplesheet,
  hasPackage,
  packageToPipelineDefinition,
} from "./package-loader";

const PIPELINE_ID = "testpipe";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, yaml.dump(data), "utf8");
}

function baseManifest(id: string) {
  return {
    manifestVersion: 1,
    package: {
      id,
      name: `${id} Pipeline`,
      version: "1.0.0",
      description: "Test package",
    },
    files: {
      definition: "definition.json",
      registry: "registry.json",
      samplesheet: "samplesheet.yaml",
      parsers: [],
    },
    targets: {
      supported: ["study"],
    },
    inputs: [],
    execution: {
      type: "nextflow",
      pipeline: id,
      version: "1.0.0",
      profiles: ["conda"],
      defaultParams: {},
    },
    outputs: [],
  };
}

function baseDefinition(id: string) {
  return {
    pipeline: id,
    name: id,
    description: "Test package",
    version: "1.0.0",
    steps: [],
    inputs: [],
    outputs: [],
  };
}

function baseRegistry(id: string) {
  return {
    id,
    name: `${id} Pipeline`,
    description: "Test package",
    category: "analysis",
    version: "1.0.0",
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
      supportedScopes: ["study"],
      minSamples: 1,
      perSample: {
        reads: false,
        pairedEnd: false,
        assemblies: false,
        bins: false,
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
  };
}

async function createManifestPackage(options: {
  id: string;
  targets?: Array<"study" | "order">;
  ui?: {
    sampleResult?: {
      columnLabel: string;
      emptyText?: string;
      layout?: "stack" | "columns";
      values: Array<{
        label?: string;
        path: string;
        whenPathExists?: string;
        format?: "text" | "hash_prefix" | "filename";
        truncate?: number;
        previewable?: boolean;
      }>;
    };
  };
  outputs?: Array<{
    id: string;
    scope: "sample" | "study" | "order" | "run";
    destination: "sample_reads" | "sample_qc" | "sample_metadata" | "sample_assemblies" | "sample_bins" | "sample_annotations" | "study_report" | "order_files" | "order_report" | "run_artifact" | "download_only";
    writeback?: {
      target: "Read";
      mode?: "merge" | "replace";
      fields: Record<string, "file1" | "file2" | "checksum1" | "checksum2" | "readCount1" | "readCount2" | "avgQuality1" | "avgQuality2" | "fastqcReport1" | "fastqcReport2">;
    };
    parsed?: {
      from: string;
      matchBy: string;
      map: Record<string, string>;
    };
    discovery: {
      pattern: string;
      matchSampleBy?: "filename" | "parent_dir" | "path";
    };
  }>;
  parserFiles?: Array<{ file: string; id: string }>;
}) {
  const packageDir = path.join(process.cwd(), "pipelines", options.id);
  await fs.mkdir(packageDir, { recursive: true });

  const outputs = options.outputs ?? [];
  const manifest = {
    ...baseManifest(options.id),
    targets: {
      supported: options.targets ?? ["study"],
    },
    files: {
      ...baseManifest(options.id).files,
      parsers: options.parserFiles?.map((entry) => entry.file) ?? [],
    },
    ui: options.ui,
    outputs,
  };
  await writeJson(path.join(packageDir, "manifest.json"), manifest);
  await writeJson(path.join(packageDir, "definition.json"), baseDefinition(options.id));
  await writeJson(path.join(packageDir, "registry.json"), baseRegistry(options.id));
  await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
    samplesheet: {
      format: "csv",
      filename: `${options.id}_samples.csv`,
      rows: {
        scope: "study",
      },
      columns: [],
    },
  });

  for (const parser of options.parserFiles ?? []) {
    await writeYaml(path.join(packageDir, parser.file), {
      parser: {
        id: parser.id,
        type: "tsv",
        description: "Parser",
        trigger: {
          filePattern: "*.tsv",
        },
        columns: [
          {
            name: "name",
            index: 0,
          },
        ],
      },
    });
  }
}

describe("package-loader", () => {
  let tempDir = "";
  let cwd = "";

  beforeEach(async () => {
    cwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-package-loader-"));
    await fs.mkdir(path.join(tempDir, "pipelines"), { recursive: true });
    process.chdir(tempDir);
    clearPackageCache();
  });

  afterEach(async () => {
    clearPackageCache();
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads a valid package and exposes manifest, registry, definition, and samplesheet", async () => {
    await createManifestPackage({ id: PIPELINE_ID });

    const pkg = getPackage(PIPELINE_ID);
    const manifest = getPackageManifest(PIPELINE_ID);
    const definition = getPackageDefinition(PIPELINE_ID);
    const registry = getPackageRegistry(PIPELINE_ID);
    const samplesheet = getPackageSamplesheet(PIPELINE_ID);
    const definitionFromCompatibility = packageToPipelineDefinition(PIPELINE_ID);

    expect(pkg?.manifest.package.id).toBe(PIPELINE_ID);
    expect(manifest?.package.id).toBe(PIPELINE_ID);
    expect(definition?.pipeline).toBe(PIPELINE_ID);
    expect(registry?.id).toBe(PIPELINE_ID);
    expect(samplesheet?.samplesheet.format).toBe("csv");
    expect(definitionFromCompatibility?.id).toBe(PIPELINE_ID);
    expect(definitionFromCompatibility?.requires.reads).toBe(false);
    expect(definitionFromCompatibility?.input.supportedScopes).toEqual(["study"]);
  });

  it("omits packages with missing manifest parser files", async () => {
    await createManifestPackage({
      id: "badpipe",
      parserFiles: [],
      outputs: [
        {
          id: "sample_qc",
          scope: "sample",
          destination: "sample_qc",
          discovery: { pattern: "qc-*.txt" },
          parsed: {
            from: "missing-parser",
            matchBy: "sample",
            map: { qc: "quality" },
          },
        },
      ],
    });

    const pkg = getPackage("badpipe");

    expect(pkg).toBeUndefined();
    expect(getAllPackageIds()).toEqual([]);
    expect(getAllPackages().length).toBe(0);
  });

  it("omits packages with parser ID mismatch", async () => {
    await createManifestPackage({
      id: "bad-id-pipe",
      parserFiles: [
        {
          file: "parsers/available.yaml",
          id: "actual-parser",
        },
      ],
      outputs: [
        {
          id: "sample_qc",
          scope: "sample",
          destination: "sample_qc",
          discovery: { pattern: "qc-*.txt" },
          parsed: {
            from: "missing-id",
            matchBy: "sample",
            map: { qc: "quality" },
          },
        },
      ],
    });

    const pkg = getPackage("bad-id-pipe");

    expect(pkg).toBeUndefined();
    expect(getAllPackageIds()).toEqual([]);
  });

  it("does not load directories without a manifest", async () => {
    await fs.mkdir(path.join(process.cwd(), "pipelines", "nomanifest"), { recursive: true });

    expect(getAllPackageIds()).toEqual([]);
    expect(hasPackage("nomanifest")).toBe(false);
    expect(getPackage("nomanifest")).toBeUndefined();
  });

  it("loads empty parser maps when no parsers are configured", async () => {
    await createManifestPackage({ id: "noparser" });

    const parsers = getPackageParsers("noparser");

    expect(parsers.size).toBe(0);
    expect(getPackageParsers("missing")).toEqual(new Map());
  });

  it("passes manifest-defined sample result previews into compatibility definitions", async () => {
    await createManifestPackage({
      id: "resultpipe",
      ui: {
        sampleResult: {
          columnLabel: "Checksums",
          emptyText: "Not computed",
          layout: "columns",
          values: [
            {
              label: "R1",
              path: "read.checksum1",
              whenPathExists: "read.file1",
              format: "hash_prefix",
              truncate: 8,
            },
            {
              label: "R2",
              path: "read.checksum2",
              whenPathExists: "read.file2",
              format: "hash_prefix",
              truncate: 8,
            },
          ],
        },
      },
    });

    const definition = packageToPipelineDefinition("resultpipe");

    expect(definition?.sampleResult).toEqual({
      columnLabel: "Checksums",
      emptyText: "Not computed",
      layout: "columns",
      values: [
        {
          label: "R1",
          path: "read.checksum1",
          whenPathExists: "read.file1",
          format: "hash_prefix",
          truncate: 8,
        },
        {
          label: "R2",
          path: "read.checksum2",
          whenPathExists: "read.file2",
          format: "hash_prefix",
          truncate: 8,
        },
      ],
    });
  });

  it("derives compatibility scopes from manifest targets", async () => {
    await createManifestPackage({
      id: "orderpipe",
      targets: ["order"],
    });

    const definition = packageToPipelineDefinition("orderpipe");

    expect(definition?.input.supportedScopes).toEqual(["order"]);
  });

  it("omits packages with invalid Read writeback destinations", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "badwriteback");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), {
      ...baseManifest("badwriteback"),
      outputs: [
        {
          id: "summary",
          scope: "run",
          destination: "run_artifact",
          discovery: { pattern: "*.txt" },
          writeback: {
            target: "Read",
            fields: {
              checksum1: "checksum1",
            },
          },
        },
      ],
    });
    await writeJson(path.join(packageDir, "definition.json"), baseDefinition("badwriteback"));
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("badwriteback"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: {
        format: "csv",
        filename: "badwriteback.csv",
        rows: { scope: "study" },
        columns: [],
      },
    });

    expect(getPackage("badwriteback")).toBeUndefined();
  });
});
