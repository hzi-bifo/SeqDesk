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
  resolveAssemblySelection: vi.fn(),
  resolveOrderPlatform: vi.fn(),
  generateSamplesheetFromConfig: vi.fn(),
  runAllParsers: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
  getAllPackages: mocks.getAllPackages,
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
  mocks.getAdapter.mockReset();
  mocks.registerAdapter.mockReset();
  mocks.getAdapter.mockReturnValue(undefined);
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
    const result = await adapter!.validateInputs("study-1");

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
    const result = await adapter!.validateInputs("study-1");

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Sample SAMPLE-1: Read checksums are required");
    expect(result.issues).toContain(
      "Sample SAMPLE-1: Sequencing platform is required (set Order platform or Sequencing Technologies selection)"
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
    const result = await adapter!.validateInputs("study-1");

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      'Sample SAMPLE-1: Unsupported sequencing platform "Sequel II/IIe" for this pipeline (expected mapping to: Nanopore, PacBio)'
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
      studyId: "study-1",
      dataBasePath: "/tmp/data",
      sampleIds: ["sample-1"],
    });

    expect(result).toEqual({
      content: "sample,foo\nS1,bar",
      sampleCount: 1,
      errors: [],
    });
    expect(mocks.generateSamplesheetFromConfig).toHaveBeenCalledWith("test", {
      studyId: "study-1",
      sampleIds: ["sample-1"],
      dataBasePath: "/tmp/data",
    });
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
});
