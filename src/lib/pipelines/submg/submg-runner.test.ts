import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    pipelineArtifact: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    sample: {
      update: vi.fn(),
    },
    read: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    assembly: {
      update: vi.fn(),
    },
    bin: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { prepareSubmgRun, processSubmgRunResults } from "./submg-runner";

let tempDir: string;

describe("submg runner", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-submg-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prepares a submg run with metadata and launch script when inputs are complete", async () => {
    const executionSettings = {
      useSlurm: false,
      slurmQueue: "cpu",
      slurmCores: 4,
      slurmMemory: "16GB",
      slurmTimeLimit: 2,
      runtimeMode: "conda" as const,
      condaPath: "/opt/conda",
      condaEnv: "submg",
      pipelineRunDir: tempDir,
      dataBasePath: tempDir,
      nextflowProfile: "standard",
    };

    const dataBaseDir = path.join(tempDir, "db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "bins"), { recursive: true });

    const read1 = path.join("reads", "sample-1_R1.fastq.gz");
    const read2 = path.join("reads", "sample-1_R2.fastq.gz");
    const assemblyPath = path.join("assemblies", "sample-1_assembly.fasta.gz");
    const binPath = path.join("bins", "sample-1.bin.fa");
    await fs.writeFile(path.join(dataBaseDir, read1), "r1");
    await fs.writeFile(path.join(dataBaseDir, read2), "r2");
    await fs.writeFile(path.join(dataBaseDir, assemblyPath), ">asm\nATCG");
    await fs.writeFile(path.join(dataBaseDir, binPath), ">bin\nATCG");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          sampleAlias: "S1",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Bacteria",
          preferredAssemblyId: null,
          checklistData: JSON.stringify({
            "collection date": "2026-02-01",
            "geographic location (country and/or sea)": "Europe",
            coverage: 10,
          }),
          reads: [
            {
              id: "read-1",
              file1: read1,
              file2: read2,
              checksum1: "md5r1",
              checksum2: "md5r2",
            },
          ],
          assemblies: [
            {
              id: "asm-1",
              assemblyName: "sample-1_assembly",
              assemblyFile: assemblyPath,
              createdByPipelineRunId: "pipeline-run-asm",
              createdByPipelineRun: {
                id: "pipeline-run-asm",
                runNumber: "MAG-2026-001",
                createdAt: new Date("2026-02-01T00:00:00.000Z"),
              },
            },
          ],
          bins: [
            {
              id: "bin-1",
              binFile: binPath,
              completeness: 90,
              contamination: 1.5,
            },
          ],
          order: {
            platform: "Illumina",
            customFields: null,
            instrumentModel: "NovaSeq",
            librarySource: "METAGENOMIC",
            librarySelection: "RANDOM",
            libraryStrategy: "WGS",
          },
        },
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings,
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.runFolder).toContain(path.join(tempDir, "SUBMG-"));
    expect(result.runNumber).toMatch(/SUBMG-\d{8}-\d{3}/);
    expect(result.scriptPath).toBeDefined();

    const script = await fs.readFile(result.scriptPath!, "utf8");
    expect(script).toContain('"$SUBMG_BIN" submit');
    expect(script).toContain("export ENA_TEST_MODE=false");
    // The SBATCH header is built from sanitized SLURM settings; valid values
    // pass through unchanged (the sanitizers reject metacharacters/newlines,
    // matching the generic/mag executors).
    expect(script).toContain("#SBATCH -p cpu");
    expect(script).toContain("#SBATCH --mem='16GB'");

    const metadata = JSON.parse(
      await fs.readFile(path.join(result.runFolder!, "submg-metadata.json"), "utf8")
    );
    expect(metadata.entries).toHaveLength(1);
    expect(metadata.entries[0]).toMatchObject({
      sampleId: "sample-1",
      sampleCode: "SAMPLE-1",
    });

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        runNumber: result.runNumber,
        runFolder: result.runFolder,
      }),
    });
  });

  it("fails fast when ENA credentials are missing", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: null,
      enaPassword: null,
      enaTestMode: false,
    });

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "ENA credentials are not configured. Set Webin username/password in Admin > Data Upload > ENA."
    );
  });

  it("fails when the ENA test registration is expired", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      testRegisteredAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      samples: [],
    });

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("may be expired");
  });

  it("maps run artifact reports back to sample/read/assembly/bin records", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-001");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "assembly_fasta"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "bins"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR123\nexperiment accession submission: EXP123"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5r1"/><checksum="md5r2"/>run accession submission: ERR123 experiment accession submission: EXP123</report>'
    );
    await fs.writeFile(
      path.join(loggingDir, "assembly_fasta", "webin-cli.report"),
      "analysis accession submission: ERZASM123"
    );
    await fs.writeFile(
      path.join(loggingDir, "bins", "bin_to_preliminary_accession.tsv"),
      "sample-1.bin.fa\tERZBIN123"
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblies: [{ id: "asm-1" }],
            bins: [{ id: "bin-1", binFile: "bin-1.bin.fa" }],
          },
        ],
      },
    });
    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.assembly.update.mockResolvedValue({});
    mocks.db.bin.update.mockResolvedValue({});
    mocks.db.bin.findFirst.mockResolvedValue({ id: "bin-1" });
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-1" });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          runId: "run-1",
          studyId: "study-1",
          generatedAt: "2026-03-03T12:00:00.000Z",
          entries: [
            {
              index: 0,
              sampleId: "sample-1",
              sampleCode: "SAMPLE-1",
              sampleTitle: "Sample 1",
              yamlPath: path.join(runFolder, "sample.yml"),
              readIds: ["read-1"],
              reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
              assemblyId: "asm-1",
              assemblyFile: "/tmp/assembly.fa",
              bins: [{ id: "bin-1", name: "sample-1", path: "/tmp/sample-1.bin.fa" }],
            },
          ],
        },
        null,
        2
      )
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.samplesUpdated).toBe(1);
    expect(result.readsUpdated).toBe(1);
    expect(result.assembliesUpdated).toBe(1);
    expect(result.binsUpdated).toBe(1);
    expect(result.artifactsCreated).toBe(2);
    expect(result.warnings).toEqual([]);

    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        sampleAccessionNumber: "SAMPLE0001",
        biosampleNumber: "ERS0001",
      },
    });
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        runAccessionNumber: "ERR123",
        experimentAccessionNumber: "EXP123",
      },
    });
    expect(mocks.db.assembly.update).toHaveBeenCalledWith({
      where: { id: "asm-1" },
      data: { assemblyAccession: "ERZASM123" },
    });
    expect(mocks.db.bin.update).toHaveBeenCalledWith({
      where: { id: "bin-1" },
      data: { binAccession: "ERZBIN123" },
    });
  });

  it("warns when a bin accession cannot be mapped or cannot be persisted", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-002");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "assembly_fasta"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "bins"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR124\nexperiment accession submission: EXP124"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5r1"/><checksum="md5r2"/>'
    );
    await fs.writeFile(
      path.join(loggingDir, "assembly_fasta", "webin-cli.report"),
      "analysis accession submission: ERZASM124"
    );
    await fs.writeFile(
      path.join(loggingDir, "bins", "bin_to_preliminary_accession.tsv"),
      ["missing.bin.fa\tERZMISS", "sample-1.bin.fa\tERZBIN124"].join("\n")
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblies: [{ id: "asm-1" }],
            bins: [{ id: "bin-1", binFile: "sample-1.bin.fa" }],
          },
        ],
      },
    });

    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.assembly.update.mockResolvedValue({});
    mocks.db.bin.findFirst.mockResolvedValue(null);
    mocks.db.bin.update
      .mockRejectedValue(new Error("database unavailable"));
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          runId: "run-1",
          studyId: "study-1",
          generatedAt: "2026-03-03T12:00:00.000Z",
          entries: [
            {
              index: 0,
              sampleId: "sample-1",
              sampleCode: "SAMPLE-1",
              sampleTitle: "Sample 1",
              yamlPath: path.join(runFolder, "sample.yml"),
              readIds: ["read-1"],
              reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
              assemblyId: "asm-1",
              assemblyFile: "/tmp/assembly.fa",
              bins: [{ id: "bin-1", name: "sample-1.bin", path: "/tmp/sample-1.bin.fa" }],
            },
          ],
        },
        null,
        2
      )
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.samplesUpdated).toBe(1);
    expect(result.readsUpdated).toBe(1);
    expect(result.assembliesUpdated).toBe(1);
    expect(result.binsUpdated).toBe(0);
    expect(result.warnings).toEqual([
      "Could not map bin 'missing.bin.fa' to bin record",
      "Failed to update bin bin-1: database unavailable",
    ]);
  });

  it("warns when read and assembly updates fail", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-003");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "assembly_fasta"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR125\nexperiment accession submission: EXP125"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5r1"/><checksum="md5r2"/>'
    );
    await fs.writeFile(
      path.join(loggingDir, "assembly_fasta", "webin-cli.report"),
      "analysis accession submission: ERZASM125"
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblies: [{ id: "asm-1" }],
            bins: [],
          },
        ],
      },
    });

    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.read.update.mockRejectedValue(new Error("read unavailable"));
    mocks.db.assembly.update.mockRejectedValue(new Error("assembly unavailable"));
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          runId: "run-1",
          studyId: "study-1",
          generatedAt: "2026-03-03T12:00:00.000Z",
          entries: [
            {
              index: 0,
              sampleId: "sample-1",
              sampleCode: "SAMPLE-1",
              sampleTitle: "Sample 1",
              yamlPath: path.join(runFolder, "sample.yml"),
              readIds: ["read-1"],
              reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
              assemblyId: "asm-1",
              assemblyFile: "/tmp/assembly.fa",
              bins: [],
            },
          ],
        },
        null,
        2
      )
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.samplesUpdated).toBe(1);
    expect(result.readsUpdated).toBe(0);
    expect(result.assembliesUpdated).toBe(0);
    expect(result.binsUpdated).toBe(0);
    expect(result.artifactsCreated).toBe(2);
    expect(result.warnings).toEqual([
      "Failed to update read read-1: read unavailable",
      "Failed to update assembly asm-1: assembly unavailable",
    ]);
  });

  it("returns error when pipeline run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const result = await prepareSubmgRun({
      runId: "missing",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Pipeline run not found");
  });

  it("returns error when study is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });
    mocks.db.study.findUnique.mockResolvedValue(null);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "missing",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Study not found");
  });

  it("returns error when study is missing ENA accession", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: null,
      samples: [],
    });

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("missing ENA accession");
  });

  it("fails when ENA test mode is on but study has no test registration", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123",
      testRegisteredAt: null,
      samples: [],
    });

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("no ENA Test registration timestamp");
  });

  it("returns error when no samples are selected", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: JSON.stringify(["nonexistent-sample"]),
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123",
      samples: [
        { id: "sample-1", sampleId: "S1" },
      ],
    });

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: false,
        pipelineRunDir: tempDir,
        dataBasePath: tempDir,
      },
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("No samples selected for SubMG submission");
  });

  it("returns errors when processSubmgRunResults finds no run", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const result = await processSubmgRunResults("missing");

    expect(result.errors).toContain("Run not found");
    expect(result.samplesUpdated).toBe(0);
  });

  it("returns errors when processSubmgRunResults finds run without runFolder", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: null,
      study: { samples: [] },
    });

    const result = await processSubmgRunResults("run-1");

    expect(result.errors).toContain("Run has no runFolder");
  });

  it("warns when metadata JSON is malformed", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-010");
    await fs.mkdir(runFolder, { recursive: true });
    await fs.writeFile(path.join(runFolder, "submg-metadata.json"), "not-valid-json");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [] },
    });

    const result = await processSubmgRunResults("run-1");

    expect(result.warnings).toContain("Failed to parse submg-metadata.json");
  });

  it("warns when a sample alias cannot be mapped", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-011");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "UNKNOWN-ALIAS\tSAMPLE999\tERS999"].join("\n")
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [] },
    });

    // Metadata file with no entries so no mapping can succeed
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.warnings.some((w: string) => w.includes("Could not map sample alias"))).toBe(true);
    expect(result.samplesUpdated).toBe(0);
  });

  it("warns when a read report cannot be mapped to a read record", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-004");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "assembly_fasta"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR126\nexperiment accession submission: EXP126"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5unknown"/><checksum="md5other"/>'
    );
    await fs.writeFile(
      path.join(loggingDir, "assembly_fasta", "webin-cli.report"),
      "analysis accession submission: ERZASM126"
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblies: [{ id: "asm-1" }],
            bins: [],
          },
        ],
      },
    });
    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.read.findFirst.mockResolvedValue(null);
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.assembly.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          runId: "run-1",
          studyId: "study-1",
          generatedAt: "2026-03-03T12:00:00.000Z",
          entries: [
            {
              index: 0,
              sampleId: "sample-1",
              sampleCode: "SAMPLE-1",
              sampleTitle: "Sample 1",
              yamlPath: path.join(runFolder, "sample.yml"),
              readIds: [],
              reads: [],
              assemblyId: "asm-1",
              assemblyFile: "/tmp/assembly.fa",
              bins: [],
            },
          ],
        },
        null,
        2
      )
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.samplesUpdated).toBe(1);
    expect(result.readsUpdated).toBe(0);
    expect(result.assembliesUpdated).toBe(1);
    expect(result.binsUpdated).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /Could not map read report .*\/SUBMG-20260303-004\/logging_0\/reads\/1\/webin-cli\.report to a read record/
    );
  });

  it("prepares a submg run with ENA test mode enabled", async () => {
    const executionSettings = {
      useSlurm: false,
      slurmQueue: "cpu",
      slurmCores: 4,
      slurmMemory: "16GB",
      slurmTimeLimit: 2,
      runtimeMode: "conda" as const,
      condaPath: "/opt/conda",
      condaEnv: "submg",
      pipelineRunDir: tempDir,
      dataBasePath: tempDir,
      nextflowProfile: "standard",
    };

    const dataBaseDir = path.join(tempDir, "db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });

    const read1 = path.join("reads", "sample-1_R1.fastq.gz");
    const read2 = path.join("reads", "sample-1_R2.fastq.gz");
    const assemblyPath = path.join("assemblies", "sample-1_assembly.fasta.gz");
    await fs.writeFile(path.join(dataBaseDir, read1), "r1");
    await fs.writeFile(path.join(dataBaseDir, read2), "r2");
    await fs.writeFile(path.join(dataBaseDir, assemblyPath), ">asm\nATCG");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: null,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: true,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      testRegisteredAt: new Date(),
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          sampleAlias: "S1",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Bacteria",
          preferredAssemblyId: null,
          checklistData: JSON.stringify({
            "collection date": "2026-02-01",
            "geographic location (country and/or sea)": "Europe",
            coverage: 10,
          }),
          reads: [
            {
              id: "read-1",
              file1: read1,
              file2: read2,
              checksum1: "md5r1",
              checksum2: "md5r2",
            },
          ],
          assemblies: [
            {
              id: "asm-1",
              assemblyName: "sample-1_assembly",
              assemblyFile: assemblyPath,
              createdByPipelineRunId: "pipeline-run-asm",
              createdByPipelineRun: {
                id: "pipeline-run-asm",
                runNumber: "MAG-2026-001",
                createdAt: new Date("2026-02-01T00:00:00.000Z"),
              },
            },
          ],
          bins: [],
          order: {
            platform: "Illumina",
            customFields: null,
            instrumentModel: "NovaSeq",
            librarySource: "METAGENOMIC",
            librarySelection: "RANDOM",
            libraryStrategy: "WGS",
          },
        },
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings,
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    const script = await fs.readFile(result.scriptPath!, "utf8");
    expect(script).toContain("export ENA_TEST_MODE=true");
  });

  it("prepares a submg run filtering to selected sample IDs", async () => {
    const executionSettings = {
      useSlurm: false,
      pipelineRunDir: tempDir,
      dataBasePath: tempDir,
    };

    const dataBaseDir = path.join(tempDir, "db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });

    const read1 = path.join("reads", "sample-2_R1.fastq.gz");
    const read2 = path.join("reads", "sample-2_R2.fastq.gz");
    const assemblyPath = path.join("assemblies", "sample-2_assembly.fasta.gz");
    await fs.writeFile(path.join(dataBaseDir, read1), "r1");
    await fs.writeFile(path.join(dataBaseDir, read2), "r2");
    await fs.writeFile(path.join(dataBaseDir, assemblyPath), ">asm\nATCG");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      inputSampleIds: JSON.stringify(["sample-2"]),
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "secret",
      enaTestMode: false,
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          sampleAlias: "S1",
          sampleTitle: "Sample 1",
          taxId: "9606",
          scientificName: "Bacteria",
          preferredAssemblyId: null,
          checklistData: JSON.stringify({
            "collection date": "2026-02-01",
            "geographic location (country and/or sea)": "Europe",
          }),
          reads: [{ id: "read-1", file1: "reads/sample-1_R1.fastq.gz", file2: "reads/sample-1_R2.fastq.gz", checksum1: "md5r1", checksum2: "md5r2" }],
          assemblies: [{ id: "asm-1", assemblyName: "sample-1_assembly", assemblyFile: "assemblies/sample-1_assembly.fasta.gz", createdByPipelineRunId: "run-asm", createdByPipelineRun: { id: "run-asm", runNumber: "MAG-2026-001", createdAt: new Date() } }],
          bins: [],
          order: { platform: "Illumina", customFields: null, instrumentModel: "NovaSeq", librarySource: "METAGENOMIC", librarySelection: "RANDOM", libraryStrategy: "WGS" },
        },
        {
          id: "sample-2",
          sampleId: "SAMPLE-2",
          sampleAlias: "S2",
          sampleTitle: "Sample 2",
          taxId: "9606",
          scientificName: "Bacteria",
          preferredAssemblyId: null,
          checklistData: JSON.stringify({
            "collection date": "2026-02-01",
            "geographic location (country and/or sea)": "Europe",
          }),
          reads: [{ id: "read-2", file1: read1, file2: read2, checksum1: "md5r3", checksum2: "md5r4" }],
          assemblies: [{ id: "asm-2", assemblyName: "sample-2_assembly", assemblyFile: assemblyPath, createdByPipelineRunId: "run-asm2", createdByPipelineRun: { id: "run-asm2", runNumber: "MAG-2026-002", createdAt: new Date() } }],
          bins: [],
          order: { platform: "Illumina", customFields: null, instrumentModel: "NovaSeq", librarySource: "METAGENOMIC", librarySelection: "RANDOM", libraryStrategy: "WGS" },
        },
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings,
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    const metadata = JSON.parse(
      await fs.readFile(path.join(result.runFolder!, "submg-metadata.json"), "utf8")
    );
    expect(metadata.entries).toHaveLength(1);
    expect(metadata.entries[0].sampleId).toBe("sample-2");
  });

  it("warns when sample update fails in processSubmgRunResults", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-020");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [],
            assemblies: [],
            bins: [],
          },
        ],
      },
    });
    mocks.db.sample.update.mockRejectedValue(new Error("sample db error"));
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: [],
            reads: [],
            assemblyId: null,
            assemblyFile: null,
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.samplesUpdated).toBe(0);
    expect(result.warnings.some((w: string) => w.includes("Failed to update sample"))).toBe(true);
  });

  it("skips artifact creation when artifact already exists", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-021");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: {
        samples: [
          {
            id: "sample-1",
            reads: [],
            assemblies: [],
            bins: [],
          },
        ],
      },
    });
    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue({ id: "existing-artifact" });

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: [],
            reads: [],
            assemblyId: null,
            assemblyFile: null,
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.artifactsCreated).toBe(0);
    expect(mocks.db.pipelineArtifact.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // prepareSubmgRun: per-sample validation guard branches.
  // These exercise the sampleErrors paths that short-circuit a sample without
  // writing YAML, plus the platform/coverage/fallback variations.
  // ---------------------------------------------------------------------------

  const baseExecutionSettings = () => ({
    useSlurm: false,
    pipelineRunDir: tempDir,
    dataBasePath: tempDir,
  });

  const baseSiteSettings = (testMode = false) => ({
    enaUsername: "Webin-12345",
    enaPassword: "secret",
    enaTestMode: testMode,
  });

  // Builds a sample fixture with everything valid; callers override fields.
  const validSample = (overrides: Record<string, unknown> = {}) => ({
    id: "sample-1",
    sampleId: "SAMPLE-1",
    sampleAlias: "S1",
    sampleTitle: "Sample 1",
    taxId: "9606",
    scientificName: "Bacteria",
    preferredAssemblyId: null,
    customFields: null,
    checklistData: JSON.stringify({
      "collection date": "2026-02-01",
      "geographic location (country and/or sea)": "Europe",
    }),
    reads: [
      {
        id: "read-1",
        file1: "reads/sample-1_R1.fastq.gz",
        file2: "reads/sample-1_R2.fastq.gz",
        checksum1: "md5r1",
        checksum2: "md5r2",
      },
    ],
    assemblies: [
      {
        id: "asm-1",
        assemblyName: "sample-1_assembly",
        assemblyFile: "assemblies/sample-1_assembly.fasta.gz",
        createdByPipelineRunId: "run-asm",
        createdByPipelineRun: {
          id: "run-asm",
          runNumber: "MAG-2026-001",
          createdAt: new Date(),
        },
      },
    ],
    bins: [],
    order: {
      platform: "Illumina",
      customFields: null,
      instrumentModel: "NovaSeq",
      librarySource: "METAGENOMIC",
      librarySelection: "RANDOM",
      libraryStrategy: "WGS",
    },
    ...overrides,
  });

  it("collects a sample error when taxId is missing", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample({ taxId: null })],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("missing taxId"))).toBe(true);
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
  });

  it("collects sample errors for missing paired reads and missing checksums", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        // No paired reads (file2 missing) -> "no paired-end read files".
        validSample({
          id: "sample-1",
          sampleId: "SAMPLE-1",
          reads: [
            { id: "read-1", file1: "reads/a_R1.fastq.gz", file2: null, checksum1: "x", checksum2: "y" },
          ],
        }),
        // Paired but missing checksums.
        validSample({
          id: "sample-2",
          sampleId: "SAMPLE-2",
          reads: [
            { id: "read-2", file1: "reads/b_R1.fastq.gz", file2: "reads/b_R2.fastq.gz", checksum1: null, checksum2: null },
          ],
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("no paired-end read files"))).toBe(true);
    expect(result.errors.some((e) => e.includes("without MD5 checksums"))).toBe(true);
  });

  it("collects sample errors for missing collection date and geo location", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample({ checklistData: JSON.stringify({ irrelevant: "field" }) })],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("collection date"))).toBe(true);
    expect(result.errors.some((e) => e.includes("geographic location"))).toBe(true);
  });

  it("collects a sample error when the sample has no assembly file", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample({ assemblies: [] })],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("has no assembly file"))).toBe(true);
  });

  it("hints at a fallback assembly when the preferred selection is unavailable", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        validSample({
          preferredAssemblyId: "missing-assembly",
          assemblies: [
            {
              id: "asm-other",
              assemblyName: "other",
              assemblyFile: "assemblies/other.fasta.gz",
              createdByPipelineRunId: "run-other",
              createdByPipelineRun: { id: "run-other", runNumber: "MAG-2026-009", createdAt: new Date() },
            },
          ],
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("preferred assembly selection is unavailable"))).toBe(true);
    expect(result.errors.some((e) => e.includes("MAG-2026-009"))).toBe(true);
  });

  it("collects a sample error when read FASTQ files do not exist on disk", async () => {
    // No files are written to disk and no fallbacks exist, so the read paths
    // resolve as missing while everything else is valid.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample()],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: path.join(tempDir, "nonexistent-data"),
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("missing FASTQ R1 file"))).toBe(true);
    expect(result.errors.some((e) => e.includes("missing FASTQ R2 file"))).toBe(true);
  });

  it("resolves a .fastq fallback when the .fastq.gz path is absent and warns", async () => {
    const dataBaseDir = path.join(tempDir, "fallback-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    // Only the un-gzipped variants exist on disk; the DB references .fastq.gz.
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample()],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes("was not found; using"))).toBe(true);
  });

  it("maps Nanopore and PacBio platforms and passes skip_checks through", async () => {
    const dataBaseDir = path.join(tempDir, "platform-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        validSample({
          order: {
            platform: "Oxford Nanopore MinION",
            customFields: null,
            instrumentModel: "MinION",
            librarySource: "METAGENOMIC",
            librarySelection: "RANDOM",
            libraryStrategy: "WGS",
          },
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: { skipChecks: true },
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    const yamlContent = await fs.readFile(
      path.join(result.runFolder!, "submg_run-1_0.yaml"),
      "utf8"
    );
    expect(yamlContent).toContain("OXFORD_NANOPORE");
    const script = await fs.readFile(result.scriptPath!, "utf8");
    expect(script).toContain("--skip-checks");
  });

  it("uses coverage from sample customFields and emits SLURM options", async () => {
    const dataBaseDir = path.join(tempDir, "coverage-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        validSample({
          customFields: JSON.stringify({ coverage_depth: 42 }),
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: {
        useSlurm: true,
        slurmQueue: "highmem",
        slurmCores: 8,
        slurmMemory: "64GB",
        slurmTimeLimit: 12,
        slurmOptions: "--exclusive",
        pipelineRunDir: tempDir,
        dataBasePath: dataBaseDir,
      },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    const yamlContent = await fs.readFile(
      path.join(result.runFolder!, "submg_run-1_0.yaml"),
      "utf8"
    );
    expect(yamlContent).toContain('COVERAGE_VALUE: "42"');
    const script = await fs.readFile(result.scriptPath!, "utf8");
    expect(script).toContain("#SBATCH --exclusive");
    expect(script).toContain("#SBATCH -p highmem");
  });

  it("increments the run number based on the latest existing SUBMG run", async () => {
    const dataBaseDir = path.join(tempDir, "runnum-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample()],
    });
    // A previous run ending in 007 means the next should be 008.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      { runNumber: `SUBMG-${today}-007` },
    ]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    expect(result.runNumber).toBe(`SUBMG-${today}-008`);
  });

  it("warns and skips bins that do not exist on disk while still succeeding", async () => {
    const dataBaseDir = path.join(tempDir, "bins-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        validSample({
          bins: [
            { id: "bin-1", binFile: "bins/missing.bin.fa", completeness: 90, contamination: 1 },
          ],
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: { submitBins: true },
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes("bin file does not exist"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("no usable bin files were found"))).toBe(true);
  });

  it("writes bin quality/taxonomy files and a BINS block when bins exist on disk", async () => {
    const dataBaseDir = path.join(tempDir, "bins-ok-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "bins"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");
    await fs.writeFile(path.join(dataBaseDir, "bins", "bin.001.fa"), ">bin");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [
        validSample({
          bins: [
            { id: "bin-1", binFile: "bins/bin.001.fa", completeness: 95, contamination: 2 },
          ],
        }),
      ],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: { submitBins: true },
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    const yamlContent = await fs.readFile(
      path.join(result.runFolder!, "submg_run-1_0.yaml"),
      "utf8"
    );
    expect(yamlContent).toContain("BINS:");
    expect(yamlContent).toContain("QUALITY_FILE:");
    const qualityContent = await fs.readFile(
      path.join(result.runFolder!, "checkm_summary_SAMPLE-1.tsv"),
      "utf8"
    );
    expect(qualityContent).toContain("bin.001\t95\t2");
    const script = await fs.readFile(result.scriptPath!, "utf8");
    expect(script).toContain("--submit-bins");
  });

  it("warns when no bins exist and submitBins is enabled", async () => {
    const dataBaseDir = path.join(tempDir, "nobins-db");
    await fs.mkdir(path.join(dataBaseDir, "reads"), { recursive: true });
    await fs.mkdir(path.join(dataBaseDir, "assemblies"), { recursive: true });
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R1.fastq.gz"), "r1");
    await fs.writeFile(path.join(dataBaseDir, "reads", "sample-1_R2.fastq.gz"), "r2");
    await fs.writeFile(path.join(dataBaseDir, "assemblies", "sample-1_assembly.fasta.gz"), ">asm");

    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample({ bins: [] })],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: { submitBins: true },
      executionSettings: { ...baseExecutionSettings(), pipelineRunDir: tempDir },
      dataBasePath: dataBaseDir,
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes("has no bins"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // processSubmgRunResults: accession parsing and read mapping branches.
  // ---------------------------------------------------------------------------

  it("matches reads by swapped checksums and falls back to read.findFirst by sample scope", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-050");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "biological_samples"), { recursive: true });
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "biological_samples", "sample_preliminary_accessions.txt"),
      ["sample\tbiosample\trun", "SAMPLE-1\tSAMPLE0001\tERS0001"].join("\n")
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR300\nexperiment accession submission: EXP300"
    );
    // Checksums appear swapped relative to metadata (md5r2 then md5r1).
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5r2"/><checksum="md5r1"/>'
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [{ id: "sample-1", reads: [], assemblies: [], bins: [] }] },
    });
    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const metadataPath = path.join(runFolder, "submg-metadata.json");
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            // Two reads so the single-read fallback does NOT trigger.
            readIds: ["read-1", "read-2"],
            reads: [
              { id: "read-1", checksum1: "md5r1", checksum2: "md5r2" },
              { id: "read-2", checksum1: "other1", checksum2: "other2" },
            ],
            assemblyId: null,
            assemblyFile: null,
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.readsUpdated).toBe(1);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { runAccessionNumber: "ERR300", experimentAccessionNumber: "EXP300" },
    });
  });

  it("falls back to a single declared read when checksums do not match", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-051");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR301\nexperiment accession submission: EXP301"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="unknownA"/><checksum="unknownB"/>'
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [{ id: "sample-1", reads: [], assemblies: [], bins: [] }] },
    });
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: ["read-solo"],
            reads: [{ id: "read-solo", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblyId: null,
            assemblyFile: null,
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.readsUpdated).toBe(1);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-solo" },
      data: { runAccessionNumber: "ERR301", experimentAccessionNumber: "EXP301" },
    });
  });

  it("matches a read via db.read.findFirst when metadata has no entry mapping", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-052");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "reads", "1", "submit"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "webin-cli.report"),
      "run accession submission: ERR302\nexperiment accession submission: EXP302"
    );
    await fs.writeFile(
      path.join(loggingDir, "reads", "1", "submit", "run.xml"),
      'submission><checksum="md5x"/><checksum="md5y"/>'
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [{ id: "sample-1", reads: [], assemblies: [], bins: [] }] },
    });
    mocks.db.read.findFirst.mockResolvedValue({ id: "db-read-1" });
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    // Metadata with no matching entry index (index 5) so entry is null for dir 0.
    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 5,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: ["read-1"],
            reads: [{ id: "read-1", checksum1: "md5r1", checksum2: "md5r2" }],
            assemblyId: null,
            assemblyFile: null,
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(mocks.db.read.findFirst).toHaveBeenCalled();
    expect(result.readsUpdated).toBe(1);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "db-read-1" },
      data: { runAccessionNumber: "ERR302", experimentAccessionNumber: "EXP302" },
    });
  });

  it("parses an ERZ assembly accession from the bare regex pattern", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-053");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "assembly_fasta"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "assembly_fasta", "webin-cli.report"),
      "The assembly was registered as ERZ9988776 successfully."
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [{ id: "sample-1", reads: [], assemblies: [], bins: [] }] },
    });
    mocks.db.assembly.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: [],
            reads: [],
            assemblyId: "asm-1",
            assemblyFile: "/tmp/asm.fa",
            bins: [],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(result.assembliesUpdated).toBe(1);
    expect(mocks.db.assembly.update).toHaveBeenCalledWith({
      where: { id: "asm-1" },
      data: { assemblyAccession: "ERZ9988776" },
    });
  });

  it("maps a bin accession via db.bin.findFirst when the metadata lookup misses", async () => {
    const runFolder = path.join(tempDir, "SUBMG-20260303-054");
    const loggingDir = path.join(runFolder, "logging_0");
    await fs.mkdir(path.join(loggingDir, "bins"), { recursive: true });

    await fs.writeFile(
      path.join(loggingDir, "bins", "bin_to_preliminary_accession.tsv"),
      "renamed.bin.fa\tERZBINDB"
    );

    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder,
      study: { samples: [{ id: "sample-1", reads: [], assemblies: [], bins: [] }] },
    });
    // The metadata bin lookup misses, but db.bin.findFirst resolves it.
    mocks.db.bin.findFirst.mockResolvedValue({ id: "bin-db-1" });
    mocks.db.bin.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    await fs.writeFile(
      path.join(runFolder, "submg-metadata.json"),
      JSON.stringify({
        runId: "run-1",
        studyId: "study-1",
        generatedAt: "2026-03-03T12:00:00.000Z",
        entries: [
          {
            index: 0,
            sampleId: "sample-1",
            sampleCode: "SAMPLE-1",
            sampleTitle: "Sample 1",
            yamlPath: path.join(runFolder, "sample.yml"),
            readIds: [],
            reads: [],
            assemblyId: null,
            assemblyFile: null,
            bins: [{ id: "bin-1", name: "different", path: "/tmp/different.fa" }],
          },
        ],
      })
    );

    const result = await processSubmgRunResults("run-1");

    expect(mocks.db.bin.findFirst).toHaveBeenCalled();
    expect(result.binsUpdated).toBe(1);
    expect(mocks.db.bin.update).toHaveBeenCalledWith({
      where: { id: "bin-db-1" },
      data: { binAccession: "ERZBINDB" },
    });
  });

  it("returns 'No valid samples' error when no metadata entries were produced", async () => {
    // A sample whose only failure is a missing assembly produces errors, but
    // here we drive the metadataEntries.length === 0 guard by selecting a
    // sample list that yields a sample error -> errors path returns first.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ id: "run-1", inputSampleIds: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue(baseSiteSettings());
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      studyAccessionId: "PRJ123456",
      samples: [validSample({ taxId: null, assemblies: [] })],
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await prepareSubmgRun({
      runId: "run-1",
      studyId: "study-1",
      config: {},
      executionSettings: baseExecutionSettings(),
      dataBasePath: tempDir,
    });

    expect(result.success).toBe(false);
    // errors take precedence over the "No valid samples" guard.
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
