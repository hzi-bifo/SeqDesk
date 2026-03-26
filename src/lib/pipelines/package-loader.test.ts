import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";

import {
  clearPackageCache,
  getAllPackageIds,
  getAllPackages,
  getAllPipelineDefinitionsFromPackages,
  getPackage,
  getPackageDefinition,
  getPackageManifest,
  getPackageParsers,
  getPackageRegistry,
  getPackageSamplesheet,
  getPackageScriptPath,
  getParser,
  getStepsFromPackage,
  hasPackage,
  findStepByProcessFromPackage,
  packageToDagData,
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

  it("returns undefined for non-existent package in convenience getters", async () => {
    expect(getPackageManifest("nope")).toBeUndefined();
    expect(getPackageDefinition("nope")).toBeUndefined();
    expect(getPackageRegistry("nope")).toBeUndefined();
    expect(getPackageSamplesheet("nope")).toBeNull();
    expect(getPackageScriptPath("nope", "samplesheet")).toBeNull();
    expect(getParser("nope", "p1")).toBeUndefined();
    expect(packageToPipelineDefinition("nope")).toBeUndefined();
    expect(packageToDagData("nope")).toBeNull();
    expect(findStepByProcessFromPackage("nope", "FOO")).toBeNull();
    expect(getStepsFromPackage("nope")).toEqual([]);
  });

  it("returns all pipeline definitions from packages", async () => {
    await createManifestPackage({ id: "pipe-a" });
    await createManifestPackage({ id: "pipe-b" });

    const defs = getAllPipelineDefinitionsFromPackages();

    expect(Object.keys(defs)).toContain("pipe-a");
    expect(Object.keys(defs)).toContain("pipe-b");
    expect(defs["pipe-a"].id).toBe("pipe-a");
    expect(defs["pipe-b"].id).toBe("pipe-b");
  });

  it("sorts packages by registry sortOrder then name", async () => {
    const packageDirB = path.join(process.cwd(), "pipelines", "beta");
    await fs.mkdir(packageDirB, { recursive: true });
    await writeJson(path.join(packageDirB, "manifest.json"), baseManifest("beta"));
    await writeJson(path.join(packageDirB, "definition.json"), baseDefinition("beta"));
    await writeJson(path.join(packageDirB, "registry.json"), { ...baseRegistry("beta"), sortOrder: 2, name: "Beta" });
    await writeYaml(path.join(packageDirB, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "beta.csv", rows: { scope: "study" }, columns: [] },
    });

    const packageDirA = path.join(process.cwd(), "pipelines", "alpha");
    await fs.mkdir(packageDirA, { recursive: true });
    await writeJson(path.join(packageDirA, "manifest.json"), baseManifest("alpha"));
    await writeJson(path.join(packageDirA, "definition.json"), baseDefinition("alpha"));
    await writeJson(path.join(packageDirA, "registry.json"), { ...baseRegistry("alpha"), sortOrder: 1, name: "Alpha" });
    await writeYaml(path.join(packageDirA, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "alpha.csv", rows: { scope: "study" }, columns: [] },
    });

    const ids = getAllPackageIds();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("converts package with steps to DAG data", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "dagpipe");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), baseManifest("dagpipe"));
    await writeJson(path.join(packageDir, "definition.json"), {
      ...baseDefinition("dagpipe"),
      inputs: [{ id: "reads", name: "Reads", fileTypes: ["fastq"] }],
      steps: [
        { id: "qc", name: "QC", description: "Quality control", category: "qc", dependsOn: [], processMatchers: ["FASTQC"], tools: ["fastqc"], outputs: ["qc_report"] },
        { id: "trim", name: "Trim", description: "Trimming", category: "preprocessing", dependsOn: ["qc"], processMatchers: ["TRIMGALORE"] },
      ],
      outputs: [
        { id: "report", name: "QC Report", description: "Quality report", fromStep: "qc", fileTypes: ["html"] },
      ],
    });
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("dagpipe"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "dagpipe.csv", rows: { scope: "study" }, columns: [] },
    });

    const dag = packageToDagData("dagpipe");

    expect(dag).not.toBeNull();
    expect(dag!.pipeline.name).toBe("dagpipe");
    // 1 input node + 2 step nodes + 1 output node = 4
    const inputNodes = dag!.nodes.filter((n) => n.nodeType === "input");
    const stepNodes = dag!.nodes.filter((n) => n.nodeType === "step");
    const outputNodes = dag!.nodes.filter((n) => n.nodeType === "output");
    expect(inputNodes.length).toBe(1);
    expect(stepNodes.length).toBe(2);
    expect(outputNodes.length).toBe(1);

    // Edges: input->qc (root step), qc->trim, qc->output
    expect(dag!.edges.length).toBe(3);
    expect(dag!.edges.some((e) => e.from === "input_reads" && e.to === "qc")).toBe(true);
    expect(dag!.edges.some((e) => e.from === "qc" && e.to === "trim")).toBe(true);
    expect(dag!.edges.some((e) => e.from === "qc" && e.to === "output_report")).toBe(true);
  });

  it("finds step by Nextflow process name from package", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "findstep");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), baseManifest("findstep"));
    await writeJson(path.join(packageDir, "definition.json"), {
      ...baseDefinition("findstep"),
      steps: [
        { id: "qc", name: "QC", description: "QC", category: "qc", dependsOn: [], processMatchers: ["FASTQC"] },
        { id: "trim", name: "Trim", description: "Trim", category: "prep", dependsOn: ["qc"], processMatchers: ["TRIMGALORE", "CUTADAPT"] },
      ],
    });
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("findstep"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "findstep.csv", rows: { scope: "study" }, columns: [] },
    });

    expect(findStepByProcessFromPackage("findstep", "NFCORE_MAG:MAG:FASTQC (sample1)")?.id).toBe("qc");
    expect(findStepByProcessFromPackage("findstep", "TRIMGALORE")?.id).toBe("trim");
    expect(findStepByProcessFromPackage("findstep", "NFCORE:CUTADAPT")?.id).toBe("trim");
    expect(findStepByProcessFromPackage("findstep", "UNKNOWN_PROCESS")).toBeNull();
  });

  it("returns steps sorted by dependency order", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "sortsteps");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), baseManifest("sortsteps"));
    await writeJson(path.join(packageDir, "definition.json"), {
      ...baseDefinition("sortsteps"),
      steps: [
        { id: "c", name: "C", description: "C", category: "x", dependsOn: ["b"] },
        { id: "a", name: "A", description: "A", category: "x", dependsOn: [] },
        { id: "b", name: "B", description: "B", category: "x", dependsOn: ["a"] },
      ],
    });
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("sortsteps"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "sortsteps.csv", rows: { scope: "study" }, columns: [] },
    });

    const steps = getStepsFromPackage("sortsteps");

    expect(steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("loads parsers and retrieves them by ID", async () => {
    await createManifestPackage({
      id: "parserpipe",
      parserFiles: [
        { file: "parsers/quast.yaml", id: "quast" },
        { file: "parsers/checkm.yaml", id: "checkm" },
      ],
    });

    const allParsers = getPackageParsers("parserpipe");
    expect(allParsers.size).toBe(2);

    const quast = getParser("parserpipe", "quast");
    expect(quast?.parser.id).toBe("quast");

    const checkm = getParser("parserpipe", "checkm");
    expect(checkm?.parser.id).toBe("checkm");

    expect(getParser("parserpipe", "missing")).toBeUndefined();
  });

  it("omits packages where definition is missing", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "nodef");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), {
      ...baseManifest("nodef"),
      files: {
        ...baseManifest("nodef").files,
        definition: "missing-definition.json",
      },
    });
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("nodef"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "nodef.csv", rows: { scope: "study" }, columns: [] },
    });

    expect(getPackage("nodef")).toBeUndefined();
  });

  it("omits packages where registry is missing", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "noreg");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), {
      ...baseManifest("noreg"),
      files: {
        ...baseManifest("noreg").files,
        registry: "missing-registry.json",
      },
    });
    await writeJson(path.join(packageDir, "definition.json"), baseDefinition("noreg"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "noreg.csv", rows: { scope: "study" }, columns: [] },
    });

    expect(getPackage("noreg")).toBeUndefined();
  });

  it("loads script path from package with scripts configured", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "scriptpipe");
    await fs.mkdir(packageDir, { recursive: true });

    const manifest = {
      ...baseManifest("scriptpipe"),
      files: {
        ...baseManifest("scriptpipe").files,
        scripts: {
          samplesheet: "scripts/gen-samplesheet.ts",
        },
      },
    };
    await writeJson(path.join(packageDir, "manifest.json"), manifest);
    await writeJson(path.join(packageDir, "definition.json"), baseDefinition("scriptpipe"));
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("scriptpipe"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "scriptpipe.csv", rows: { scope: "study" }, columns: [] },
    });
    // Create the script file so validation passes
    await fs.mkdir(path.join(packageDir, "scripts"), { recursive: true });
    await fs.writeFile(path.join(packageDir, "scripts", "gen-samplesheet.ts"), "export default {};", "utf8");

    const scriptPath = getPackageScriptPath("scriptpipe", "samplesheet");
    expect(scriptPath).toContain("scripts/gen-samplesheet.ts");
  });

  it("omits packages with Read writeback and non-sample scope", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "badscope");
    await fs.mkdir(packageDir, { recursive: true });

    await writeJson(path.join(packageDir, "manifest.json"), {
      ...baseManifest("badscope"),
      outputs: [
        {
          id: "reads",
          scope: "study",
          destination: "sample_reads",
          discovery: { pattern: "*.fastq" },
          writeback: {
            target: "Read",
            fields: { checksum1: "checksum1" },
          },
        },
      ],
    });
    await writeJson(path.join(packageDir, "definition.json"), baseDefinition("badscope"));
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("badscope"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "badscope.csv", rows: { scope: "study" }, columns: [] },
    });

    expect(getPackage("badscope")).toBeUndefined();
  });

  it("omits packages with missing script files", async () => {
    const packageDir = path.join(process.cwd(), "pipelines", "missingscript");
    await fs.mkdir(packageDir, { recursive: true });

    const manifest = {
      ...baseManifest("missingscript"),
      files: {
        ...baseManifest("missingscript").files,
        scripts: {
          samplesheet: "scripts/does-not-exist.ts",
        },
      },
    };
    await writeJson(path.join(packageDir, "manifest.json"), manifest);
    await writeJson(path.join(packageDir, "definition.json"), baseDefinition("missingscript"));
    await writeJson(path.join(packageDir, "registry.json"), baseRegistry("missingscript"));
    await writeYaml(path.join(packageDir, "samplesheet.yaml"), {
      samplesheet: { format: "csv", filename: "missingscript.csv", rows: { scope: "study" }, columns: [] },
    });

    expect(getPackage("missingscript")).toBeUndefined();
  });

  it("returns null for getPackageScriptPath when package has no scripts", async () => {
    await createManifestPackage({ id: "noscripts" });

    expect(getPackageScriptPath("noscripts", "samplesheet")).toBeNull();
    expect(getPackageScriptPath("noscripts", "discoverOutputs")).toBeNull();
  });
});
