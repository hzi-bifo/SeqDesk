import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  db: {
    study: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
  },
  getPackage: vi.fn(),
  getAllPackages: vi.fn(),
  getPackageScriptPath: vi.fn(),
  resolveAssemblySelection: vi.fn(),
  resolveOrderPlatform: vi.fn(),
  generateSamplesheetFromConfig: vi.fn(),
  runAllParsers: vi.fn(),
  runDiscoverOutputsScript: vi.fn(),
  runSamplesheetScript: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
  getAllPackages: mocks.getAllPackages,
  getPackageScriptPath: mocks.getPackageScriptPath,
}));

vi.mock("./assembly-selection", () => ({
  resolveAssemblySelection: mocks.resolveAssemblySelection,
}));

vi.mock("./order-platform", () => ({
  resolveOrderPlatform: mocks.resolveOrderPlatform,
}));

vi.mock("./samplesheet-generator", () => ({
  generateSamplesheetFromConfig: mocks.generateSamplesheetFromConfig,
}));

vi.mock("./parser-runtime", () => ({
  runAllParsers: mocks.runAllParsers,
}));

vi.mock("./script-runtime", () => ({
  runDiscoverOutputsScript: mocks.runDiscoverOutputsScript,
  runSamplesheetScript: mocks.runSamplesheetScript,
}));

vi.mock("./adapters/types", async () => {
  const actual = await vi.importActual<typeof import("./adapters/types")>(
    "./adapters/types"
  );
  return {
    ...actual,
    getAdapter: mocks.getAdapter,
    registerAdapter: mocks.registerAdapter,
  };
});

import {
  createGenericAdapter,
  registerGenericAdapters,
} from "./generic-adapter";
import type { PackageInput, PackageOutput } from "./package-loader";

function makePackageIdOnly(id: string, inputs: PackageInput[] = [], outputs: PackageOutput[] = []) {
  return {
    id,
    basePath: "/tmp",
    manifest: {
      package: {
        id,
        name: `${id} Pipeline`,
        version: "1.0.0",
        description: `${id} test pipeline`,
      },
      files: {
        definition: "definition.json",
        registry: "registry.json",
        samplesheet: "samplesheet.yaml",
        parsers: [],
      },
      inputs,
      execution: {
        type: "nextflow",
        pipeline: id,
        version: "1.0.0",
        profiles: ["conda"],
        defaultParams: {},
      },
      outputs,
    },
    definition: {
      pipeline: id,
      name: id,
      description: `package ${id}`,
      steps: [],
      inputs: [],
      outputs: [],
    },
    registry: {
      id,
      name: `${id} Pipeline`,
      description: `${id} test package`,
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
        filename: `${id}_samples.csv`,
        generator: "internal",
      },
      configSchema: {
        type: "object",
        properties: {},
      },
      defaultConfig: {},
      icon: "beaker",
    },
    samplesheet: {
      samplesheet: {
        format: "csv",
        filename: "samples.csv",
        rows: {
          scope: "study",
        },
        columns: [],
      },
    },
    parsers: new Map(),
  };
}

function makeTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Math.random().toString(16).slice(2)}`);
}

const baseStudy = {
  studyId: "study-1",
};

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(makeTempDir("seqdesk-gen-adapter-"));
  vi.clearAllMocks();

  mocks.db.study.findUnique.mockResolvedValue(baseStudy);
  mocks.db.sample.findMany.mockResolvedValue([]);
  mocks.generateSamplesheetFromConfig.mockResolvedValue(undefined);
  mocks.runAllParsers.mockResolvedValue(new Map());
  mocks.resolveOrderPlatform.mockReturnValue("Illumina");
  mocks.resolveAssemblySelection.mockReturnValue({
    assembly: null,
    fallbackAssembly: null,
    source: "none",
    preferredMissing: false,
  });
  mocks.getPackage.mockReset();
  mocks.getAllPackages.mockReset();
  mocks.getPackageScriptPath.mockReset();
  mocks.getAdapter.mockReset();
  mocks.registerAdapter.mockReset();
  mocks.runDiscoverOutputsScript.mockReset();
  mocks.runSamplesheetScript.mockReset();
  mocks.getAdapter.mockReturnValue(undefined);
  mocks.getPackageScriptPath.mockReturnValue(null);
});

describe("generic-adapter", () => {
  it("returns null for missing packages", () => {
    mocks.getPackage.mockReturnValue(undefined);

    const adapter = createGenericAdapter("missing");

    expect(adapter).toBeNull();
  });

  it("returns study-not-found from validateInputs", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
        filters: { paired: true, checksums: true },
      },
      {
        id: "platform",
        scope: "order",
        source: "order.platform",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue(null);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(adapter).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(["Study not found"]);
  });

  it("checks paired reads, checksums and platform requirements", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
        filters: { paired: true, checksums: true },
      },
      {
        id: "platform",
        scope: "order",
        source: "order.platform",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [
          {
            file1: "/tmp/SAMPLE-1_R1.fastq.gz",
            file2: "/tmp/SAMPLE-1_R2.fastq.gz",
            checksum1: "abc",
            checksum2: null,
          },
        ],
        assemblies: [],
        bins: [],
        order: {
          platform: null,
          customFields: null,
        },
      },
    ]);
    mocks.resolveOrderPlatform.mockReturnValue(null);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: Read checksums are required");
    expect(result.issues).toContain(
      "Sample SAMPLE-1: Sequencing technology metadata is required"
    );
  });

  it("rejects unsupported platform values for strict map_value transforms", async () => {
    const pkg = makePackageIdOnly("metaxpath", [
      {
        id: "sequencer",
        scope: "order",
        source: "order.platform",
        required: true,
        transform: {
          type: "map_value",
          strict: true,
          mapping: {
            nanopore: "Nanopore",
            pacbio: "PacBio",
          },
        },
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: {
          platform: "Sequel II/IIe",
          customFields: null,
        },
      },
    ]);
    mocks.resolveOrderPlatform.mockReturnValue("Sequel II/IIe");

    const adapter = createGenericAdapter("metaxpath");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      'Sample SAMPLE-1: Unsupported sequencing technology/platform "Sequel II/IIe" for this pipeline (expected mapping to: Nanopore, PacBio)'
    );
  });

  it("rejects order targets when required study-scoped inputs are present", async () => {
    const pkg = makePackageIdOnly("study-bound", [
      {
        id: "study-accession",
        scope: "study",
        source: "study.studyAccessionId",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: {
          platform: "Illumina",
          customFields: null,
        },
      },
    ]);

    const adapter = createGenericAdapter("study-bound");
    const result = await adapter!.validateInputs({ type: "order", orderId: "order-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      "Input study-accession requires study-scoped data (study.studyAccessionId) and cannot run on an order target"
    );
  });

  it("generates a samplesheet when generator returns content", async () => {
    const pkg = makePackageIdOnly("test");
    mocks.getPackage.mockReturnValue(pkg);
    mocks.generateSamplesheetFromConfig.mockResolvedValue({
      content: "sample,foo\nS1,bar",
      sampleCount: 1,
      errors: [],
    });

    const adapter = createGenericAdapter("test");
    const result = await adapter!.generateSamplesheet({
      target: {
        type: "study",
        studyId: "study-1",
        sampleIds: ["sample-1"],
      },
      dataBasePath: "/tmp/data",
    });

    expect(result).toEqual({
      content: "sample,foo\nS1,bar",
      sampleCount: 1,
      errors: [],
    });
    expect(mocks.generateSamplesheetFromConfig).toHaveBeenCalledWith("test", {
      target: {
        type: "study",
        studyId: "study-1",
        sampleIds: ["sample-1"],
      },
      dataBasePath: "/tmp/data",
    });
  });

  it("delegates samplesheet generation to package scripts when configured", async () => {
    const pkg = makePackageIdOnly("read-cleaning");
    mocks.getPackage.mockReturnValue(pkg);
    mocks.getPackageScriptPath.mockReturnValue("/tmp/generate-samplesheet.mjs");
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "S1",
        reads: [
          {
            id: "read-raw",
            file1: "reads/S1_R1.fastq.gz",
            file2: "reads/S1_R2.fastq.gz",
            dataClass: "raw",
            isActive: true,
          },
        ],
        order: {
          id: "order-1",
          platform: "Illumina",
          customFields: null,
        },
      },
    ]);
    mocks.runSamplesheetScript.mockResolvedValue({
      content: "sample,short_reads_fastq_1\nS1,/data/reads/S1_R1.fastq.gz",
      sampleCount: 1,
      errors: [],
    });

    const adapter = createGenericAdapter("read-cleaning");
    const result = await adapter!.generateSamplesheet({
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      dataBasePath: "/data",
      config: { readType: "short" },
    });

    expect(result.sampleCount).toBe(1);
    expect(mocks.runSamplesheetScript).toHaveBeenCalledWith(
      "/tmp/generate-samplesheet.mjs",
      {
        packageId: "read-cleaning",
        target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
        dataBasePath: "/data",
        config: { readType: "short" },
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            reads: [
              {
                id: "read-raw",
                file1: "reads/S1_R1.fastq.gz",
                file2: "reads/S1_R2.fastq.gz",
                dataClass: "raw",
                isActive: true,
              },
            ],
            order: {
              id: "order-1",
              platform: "Illumina",
              customFields: null,
            },
          },
        ],
      }
    );
    expect(mocks.generateSamplesheetFromConfig).not.toHaveBeenCalled();
  });

  it("uses a custom discoverOutputs script when the package provides one", async () => {
    const pkg = makePackageIdOnly("checksum");
    const discovered = {
      files: [
        {
          type: "artifact" as const,
          name: "sample-1.json",
          path: "/tmp/sample-1.json",
          sampleId: "sample-1",
          outputId: "sample_checksums",
        },
      ],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 1,
        reportsFound: 0,
      },
    };

    mocks.getPackage.mockReturnValue(pkg);
    mocks.getPackageScriptPath.mockReturnValue("/tmp/discover-outputs.mjs");
    mocks.runDiscoverOutputsScript.mockResolvedValue(discovered);

    const adapter = createGenericAdapter("checksum");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      target: { type: "order", orderId: "order-1" },
      samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
    });

    expect(result).toEqual(discovered);
    expect(mocks.runDiscoverOutputsScript).toHaveBeenCalledWith(
      "/tmp/discover-outputs.mjs",
      {
        packageId: "checksum",
        runId: "run-1",
        outputDir: tempDir,
        target: { type: "order", orderId: "order-1" },
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      }
    );
    expect(mocks.runAllParsers).not.toHaveBeenCalled();
  });

  it("returns discoverable outputs with fallback patterns and parsed metadata", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "qc",
        scope: "sample",
        destination: "sample_qc",
        discovery: {
          pattern: "qc/does-not-exist/*.txt",
          fallbackPattern: "qc/*.txt",
          matchSampleBy: "filename",
        },
      },
      {
        id: "assembly",
        scope: "sample",
        destination: "sample_assemblies",
        discovery: {
          pattern: "assemblies/*.fa",
          matchSampleBy: "filename",
        },
        parsed: {
          from: "qcparser",
          matchBy: "id",
          map: {
            completeness: "completeness",
          },
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);

    await fs.mkdir(path.join(tempDir, "qc"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "qc", "sample1-QC.txt"), "qc");
    await fs.writeFile(path.join(tempDir, "assemblies", "sample1.asm.fa"), "assembly");

    mocks.runAllParsers.mockResolvedValue(
      new Map([
        [
          "qcparser",
          {
            rows: new Map([
              [
                "sample1.asm.fa",
                {
                  id: "sample1",
                  completeness: 0.97,
                },
              ],
            ]),
            errors: ["parser warning"],
          },
        ],
      ])
    );

    const adapter = createGenericAdapter("test");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      samples: [{ id: "db-s1", sampleId: "sample1" }],
    });

    expect(result.errors).toContain("parser warning");
    expect(result.files).toHaveLength(2);

    const qcFile = result.files.find((f) => f.outputId === "qc");
    const assemblyFile = result.files.find((f) => f.outputId === "assembly");

    expect(qcFile?.sampleId).toBe("db-s1");
    expect(qcFile?.name).toBe("sample1-QC.txt");
    expect(assemblyFile?.metadata).toEqual({ completeness: 0.97 });

    expect(result.summary).toEqual({
      assembliesFound: 1,
      binsFound: 0,
      artifactsFound: 1,
      reportsFound: 0,
    });
  });

  it("discovers manifest outputs whose pattern is a literal path (no wildcards)", async () => {
    // Regression: a fixed-path discovery pattern (e.g. study-demo-report's
    // report/demo-report.html) must be matched. Previously simpleGlob treated the
    // whole literal path as the base dir, found it was a file, and discovered nothing.
    const outputs: PackageOutput[] = [
      {
        id: "html_report",
        scope: "study",
        destination: "study_report",
        type: "report",
        discovery: { pattern: "report/demo-report.html" },
      },
      {
        id: "sample_summary",
        scope: "run",
        destination: "run_artifact",
        type: "artifact",
        discovery: { pattern: "tables/sample-summary.tsv" },
      },
      {
        id: "missing",
        scope: "run",
        destination: "run_artifact",
        discovery: { pattern: "report/not-produced.txt" },
      },
    ];

    const pkg = makePackageIdOnly("study-demo-report", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);
    mocks.runAllParsers.mockResolvedValue(new Map());

    await fs.mkdir(path.join(tempDir, "report"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "tables"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "report", "demo-report.html"), "<html></html>");
    await fs.writeFile(path.join(tempDir, "tables", "sample-summary.tsv"), "a\tb\n");

    const adapter = createGenericAdapter("study-demo-report");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      target: { type: "study", studyId: "study-1" },
      samples: [{ id: "db-s1", sampleId: "sample1" }],
    });

    // The two produced files are discovered; the absent literal path is not.
    expect(result.files.map((f) => f.outputId).sort()).toEqual(["html_report", "sample_summary"]);
    const html = result.files.find((f) => f.outputId === "html_report");
    expect(html?.name).toBe("demo-report.html");
    expect(html?.path).toBe(path.join(tempDir, "report", "demo-report.html"));
  });

  it("attributes outputs to the correct sample for prefix-overlapping ids", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "cleaned",
        scope: "sample",
        destination: "run_artifact",
        discovery: {
          pattern: "cleaned/*_filtered.fastq.gz",
          matchSampleBy: "filename",
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);

    await fs.mkdir(path.join(tempDir, "cleaned"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "cleaned", "S1_filtered.fastq.gz"), "a");
    await fs.writeFile(path.join(tempDir, "cleaned", "S10_filtered.fastq.gz"), "b");

    mocks.runAllParsers.mockResolvedValue(new Map());

    const adapter = createGenericAdapter("test");
    // S1 is iterated before S10 and is a substring of "S10_filtered..." — the
    // boundary-anchored, longest-match logic must still attribute correctly.
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      samples: [
        { id: "db-s1", sampleId: "S1" },
        { id: "db-s10", sampleId: "S10" },
      ],
    });

    const fileS1 = result.files.find((f) => f.name === "S1_filtered.fastq.gz");
    const fileS10 = result.files.find((f) => f.name === "S10_filtered.fastq.gz");

    expect(fileS1?.sampleId).toBe("db-s1");
    expect(fileS1?.sampleName).toBe("S1");
    expect(fileS10?.sampleId).toBe("db-s10");
    expect(fileS10?.sampleName).toBe("S10");
  });

  it("does not match a sample id embedded mid-token without delimiters", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "report",
        scope: "sample",
        destination: "run_artifact",
        discovery: {
          pattern: "out/*.txt",
          matchSampleBy: "filename",
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);

    await fs.mkdir(path.join(tempDir, "out"), { recursive: true });
    // "AB" appears inside "GRABBAG" but not as a delimiter-bounded token.
    await fs.writeFile(path.join(tempDir, "out", "GRABBAG.txt"), "x");

    mocks.runAllParsers.mockResolvedValue(new Map());

    const adapter = createGenericAdapter("test");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      samples: [{ id: "db-ab", sampleId: "AB" }],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].sampleId).toBeUndefined();
  });

  it("registers adapters for packages without existing registrations", () => {
    const pkg = makePackageIdOnly("auto", [], []);
    mocks.getAllPackages.mockReturnValue([pkg]);
    mocks.getPackage.mockReturnValue(pkg);
    mocks.getAdapter.mockReturnValue(undefined);

    registerGenericAdapters();

    expect(mocks.registerAdapter).toHaveBeenCalledTimes(1);
    expect(mocks.registerAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: "auto" })
    );
  });

  it("does not register adapters when already exists", () => {
    const pkg = makePackageIdOnly("auto", [], []);
    mocks.getAllPackages.mockReturnValue([pkg]);
    mocks.getAdapter.mockReturnValue({ pipelineId: "auto" } as never);

    registerGenericAdapters();

    expect(mocks.registerAdapter).not.toHaveBeenCalled();
  });

  it("returns error in samplesheet when no config found", async () => {
    const pkg = makePackageIdOnly("test");
    mocks.getPackage.mockReturnValue(pkg);
    mocks.generateSamplesheetFromConfig.mockResolvedValue(undefined);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.generateSamplesheet({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/tmp/data",
    });

    expect(result.content).toBe("");
    expect(result.sampleCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No samplesheet configuration");
  });

  it("validates no-samples found returns invalid", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("No samples found");
  });

  it("validates sample.reads with no reads assigned", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
        filters: { paired: false },
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: No reads assigned");
  });

  it("validates sample.reads with paired filter but no paired reads", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
        filters: { paired: true },
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [{ file1: "/tmp/R1.fastq.gz", file2: null }],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: No paired-end reads (R1+R2) found");
  });

  it("validates strict read data-class filters", async () => {
    const pkg = makePackageIdOnly("read-cleaning", [
      {
        id: "reads",
        scope: "sample",
        source: "sample.reads",
        required: true,
        filters: { dataClassIn: ["raw", "unknown"] },
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [
          {
            file1: "/tmp/SAMPLE-1_cleaned.fastq.gz",
            file2: null,
            dataClass: "cleaned",
          },
        ],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
      {
        id: "sample-2",
        sampleId: "SAMPLE-2",
        reads: [
          {
            file1: "/tmp/SAMPLE-2_raw.fastq.gz",
            file2: null,
            dataClass: "raw",
          },
        ],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("read-cleaning");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      "Sample SAMPLE-1: No active raw or unknown reads found",
    ]);
  });

  it("validates sample.assemblies requirement", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "assemblies",
        scope: "sample",
        source: "sample.assemblies",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);
    mocks.resolveAssemblySelection.mockReturnValue({
      assembly: null,
      fallbackAssembly: null,
      source: "none",
      preferredMissing: false,
    });

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: Assembly file is required");
  });

  it("validates sample.assemblies with preferred assembly missing", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "assemblies",
        scope: "sample",
        source: "sample.assemblies",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        preferredAssemblyId: "missing-assembly-id",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);
    mocks.resolveAssemblySelection.mockReturnValue({
      assembly: null,
      fallbackAssembly: null,
      source: "none",
      preferredMissing: true,
    });

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("Preferred assembly selection is invalid");
  });

  it("validates sample.bins requirement", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "bins",
        scope: "sample",
        source: "sample.bins",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [{ binFile: null }],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: At least one bin file is required");
  });

  it("validates sample.taxId requirement", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "taxId",
        scope: "sample",
        source: "sample.taxId",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        taxId: "",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: taxId is required");
  });

  it("validates sample.checklistData requirement", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "checklist",
        scope: "sample",
        source: "sample.checklistData",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        checklistData: null,
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      "Sample SAMPLE-1: Checklist data is required and must be valid JSON"
    );
  });

  it("validates study.studyAccessionId requirement", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "study-accession",
        scope: "study",
        source: "study.studyAccessionId",
        required: true,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: null });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Study accession (PRJ*) is required");
  });

  it("handles custom discoverOutputs script errors gracefully", async () => {
    const pkg = makePackageIdOnly("failing");
    mocks.getPackage.mockReturnValue(pkg);
    mocks.getPackageScriptPath.mockReturnValue("/tmp/discover-outputs.mjs");
    mocks.runDiscoverOutputsScript.mockRejectedValue(new Error("Script crashed"));

    const adapter = createGenericAdapter("failing");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      target: { type: "order", orderId: "order-1" },
      samples: [],
    });

    expect(result.files).toHaveLength(0);
    expect(result.errors).toContain("Script crashed");
  });

  it("discovers outputs with different destination types", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "bins",
        scope: "sample",
        destination: "sample_bins",
        discovery: {
          pattern: "bins/*.fa",
          matchSampleBy: "parent_dir",
        },
      },
      {
        id: "report",
        scope: "study",
        destination: "study_report",
        discovery: {
          pattern: "reports/*.html",
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);

    await fs.mkdir(path.join(tempDir, "bins"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "reports"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "bins", "bin1.fa"), "bin");
    await fs.writeFile(path.join(tempDir, "reports", "summary.html"), "report");

    mocks.runAllParsers.mockResolvedValue(new Map());

    const adapter = createGenericAdapter("test");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      samples: [],
    });

    expect(result.files).toHaveLength(2);

    const binFile = result.files.find((f) => f.outputId === "bins");
    const reportFile = result.files.find((f) => f.outputId === "report");

    expect(binFile?.type).toBe("bin");
    expect(reportFile?.type).toBe("report");

    expect(result.summary.binsFound).toBe(1);
    expect(result.summary.reportsFound).toBe(1);
  });

  it("discovers outputs with path-based sample matching", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "artifact",
        scope: "sample",
        destination: "artifact",
        discovery: {
          pattern: "output/**/result.txt",
          matchSampleBy: "path",
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);

    await fs.mkdir(path.join(tempDir, "output", "SAMPLE-1"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "output", "SAMPLE-1", "result.txt"), "data");

    mocks.runAllParsers.mockResolvedValue(new Map());

    const adapter = createGenericAdapter("test");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: tempDir,
      samples: [{ id: "db-s1", sampleId: "SAMPLE-1" }],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].sampleId).toBe("db-s1");
    expect(result.files[0].sampleName).toBe("SAMPLE-1");
  });

  it("returns empty files when output directory does not exist", async () => {
    const outputs: PackageOutput[] = [
      {
        id: "missing",
        scope: "sample",
        destination: "artifact",
        discovery: {
          pattern: "nonexistent/*.txt",
        },
      },
    ];

    const pkg = makePackageIdOnly("test", [], outputs);
    mocks.getPackage.mockReturnValue(pkg);
    mocks.runAllParsers.mockResolvedValue(new Map());

    const adapter = createGenericAdapter("test");
    const result = await adapter!.discoverOutputs({
      runId: "run-1",
      outputDir: path.join(tempDir, "does-not-exist"),
      samples: [],
    });

    expect(result.files).toHaveLength(0);
    expect(result.summary.artifactsFound).toBe(0);
  });

  it("skips non-required inputs during validation", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "optional-reads",
        scope: "sample",
        source: "sample.reads",
        required: false,
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("validates with valid platform mapping passes", async () => {
    const pkg = makePackageIdOnly("test", [
      {
        id: "sequencer",
        scope: "order",
        source: "order.platform",
        required: true,
        transform: {
          type: "map_value",
          strict: true,
          mapping: {
            illumina: "Illumina",
            Illumina: "Illumina",
          },
        },
      },
    ]);

    mocks.getPackage.mockReturnValue(pkg);
    mocks.db.study.findUnique.mockResolvedValue({ studyAccessionId: "PRJ123" });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "SAMPLE-1",
        reads: [],
        assemblies: [],
        bins: [],
        order: { platform: "Illumina", customFields: null },
      },
    ]);
    mocks.resolveOrderPlatform.mockReturnValue("Illumina");

    const adapter = createGenericAdapter("test");
    const result = await adapter!.validateInputs({ type: "study", studyId: "study-1" });

    expect(result.valid).toBe(true);
  });
});
