import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    assembly: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    bin: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    pipelineArtifact: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    read: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    pipelineRun: {
      update: vi.fn(),
    },
  },
  getPackage: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

import { resolveOutputs, saveRunResults } from "./output-resolver";

const baseDiscovered = {
  errors: [],
  summary: {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: 0,
    reportsFound: 0,
  },
};

describe("output-resolver", () => {
  let tempDir = "";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.read.findMany.mockResolvedValue([]);
    mocks.db.read.deleteMany.mockResolvedValue({});
    mocks.db.read.create.mockResolvedValue({});
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-output-resolver-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns package-missing result when pipeline package is not loaded", async () => {
    mocks.getPackage.mockReturnValue(undefined);

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [],
    });

    expect(result).toEqual({
      success: false,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: ["Pipeline package not found: mag"],
      warnings: [],
    });
  });

  it("creates assemblies and artifacts through matching destination handlers", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
          {
            id: "artifact-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "unmatched.txt" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "sample-1.fasta",
          path: "/tmp/sample-1.fasta",
          sampleId: "sample-1",
          outputId: "asm-output",
        },
        {
          type: "artifact",
          name: "unmatched.txt",
          path: "/tmp/unmatched.txt",
          outputId: "artifact-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(1);
    expect(result.artifactsCreated).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  it("prefers explicit outputId mapping over scope fallback", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
          {
            id: "fallback-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "fallback.txt" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "sample-1.fasta",
          path: "/tmp/sample-1.fasta",
          sampleId: "sample-1",
          outputId: "asm-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(1);
    expect(result.artifactsCreated).toBe(0);
    expect(mocks.db.assembly.create).toHaveBeenCalledTimes(1);
  });

  it("warns when output destination is unknown", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "weird-output",
            scope: "sample",
            destination: "unknown" as unknown,
            discovery: { pattern: "weird.txt" },
          },
        ],
      },
    });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "weird.txt",
          path: "/tmp/weird.txt",
          outputId: "weird-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Unknown destination type: unknown");
    expect(result.errors).toHaveLength(0);
  });

  it("falls back to artifact when output mapping is not found", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "other-output",
            scope: "sample",
            destination: "sample_assemblies",
            discovery: { pattern: "other.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "no-match.txt",
          path: "/tmp/no-match.txt",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.pipelineArtifact.findFirst).toHaveBeenCalled();
  });

  it("writes sample read metadata for sample_reads outputs", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-checksums",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "checksums/*.json" },
          },
        ],
      },
    });
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-1", pipelineSources: null });
    mocks.db.read.update.mockResolvedValue({});

    const result = await resolveOutputs("fastq-checksum", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1.json",
          path: "/tmp/sample-1.json",
          sampleId: "sample-1",
          outputId: "sample-checksums",
          metadata: {
            checksum1: "abc123",
            checksum2: "def456",
            readCount1: 120,
            avgQuality1: 37.5,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(0);
    expect(result.binsCreated).toBe(0);
    expect(result.artifactsCreated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(mocks.db.read.findFirst).toHaveBeenCalledWith({
      where: { sampleId: "sample-1" },
      select: { id: true, pipelineSources: true },
      orderBy: { id: "asc" },
    });
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        checksum1: "abc123",
        checksum2: "def456",
        readCount1: 120,
        avgQuality1: 37.5,
        pipelineSources: '{"fastq-checksum":"run-id"}',
      },
    });
    expect(mocks.db.pipelineArtifact.create).not.toHaveBeenCalled();
  });

  it("writes fastqcReport paths to sample reads for fastqc pipeline", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_fastqc_reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "fastqc_reports/*_R1_fastqc.html" },
          },
          {
            id: "sample_qc_reports",
            scope: "sample",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "fastqc_reports/*_fastqc.html" },
          },
        ],
      },
    });
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-1", pipelineSources: '{"simulate-reads":"old-run"}' });
    mocks.db.read.update.mockResolvedValue({});
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("fastqc", "fastqc-run-1", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1_fastqc_reads",
          path: "/data/fastqc_reports/sample-1_R1_fastqc.html",
          sampleId: "sample-1",
          outputId: "sample_fastqc_reads",
          metadata: {
            fastqcReport1: "/data/fastqc_reports/sample-1_R1_fastqc.html",
            fastqcReport2: "/data/fastqc_reports/sample-1_R2_fastqc.html",
            readCount1: 42000,
            readCount2: 42000,
            avgQuality1: 37.2,
            avgQuality2: 36.9,
          },
        },
        {
          type: "artifact",
          name: "sample-1_R1_fastqc.html",
          path: "/data/fastqc_reports/sample-1_R1_fastqc.html",
          sampleId: "sample-1",
          outputId: "sample_qc_reports",
          metadata: { readEnd: "R1", format: "html" },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        fastqcReport1: "/data/fastqc_reports/sample-1_R1_fastqc.html",
        fastqcReport2: "/data/fastqc_reports/sample-1_R2_fastqc.html",
        readCount1: 42000,
        readCount2: 42000,
        avgQuality1: 37.2,
        avgQuality2: 36.9,
        pipelineSources: '{"simulate-reads":"old-run","fastqc":"fastqc-run-1"}',
      },
    });
  });

  it("merges fastqc pipelineSources with existing checksum sources", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_fastqc_reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "fastqc_reports/*_R1_fastqc.html" },
          },
        ],
      },
    });
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineSources: '{"simulate-reads":"sr-run","fastq-checksum":"ck-run"}',
    });
    mocks.db.read.update.mockResolvedValue({});

    const result = await resolveOutputs("fastqc", "qc-run-2", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "s1_fastqc_reads",
          path: "/data/s1_R1_fastqc.html",
          sampleId: "s1",
          outputId: "sample_fastqc_reads",
          metadata: {
            fastqcReport1: "/data/s1_R1_fastqc.html",
            fastqcReport2: null,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        fastqcReport1: "/data/s1_R1_fastqc.html",
        fastqcReport2: null,
        pipelineSources: '{"simulate-reads":"sr-run","fastq-checksum":"ck-run","fastqc":"qc-run-2"}',
      },
    });
  });

  it("copies generated FASTQ files into sequencing storage and replaces existing sample reads", async () => {
    const sourceDir = path.join(tempDir, "run-output", "reads");
    const storageDir = path.join(tempDir, "storage");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(storageDir, "simulated", "order_order-1"), {
      recursive: true,
    });

    const sourceFile1 = path.join(sourceDir, "sample-1_R1.fastq.gz");
    const sourceFile2 = path.join(sourceDir, "sample-1_R2.fastq.gz");
    const oldFile1 = path.join(storageDir, "simulated", "order_order-1", "old_R1.fastq.gz");
    const oldFile2 = path.join(storageDir, "simulated", "order_order-1", "old_R2.fastq.gz");

    await fs.writeFile(sourceFile1, "new-r1");
    await fs.writeFile(sourceFile2, "new-r2");
    await fs.writeFile(oldFile1, "old-r1");
    await fs.writeFile(oldFile2, "old-r2");

    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-simulated-reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "manifests/*.json" },
          },
        ],
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: storageDir,
      source: "database",
      isImplicit: false,
    });
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-old", file1: "simulated/order_order-1/old_R1.fastq.gz", pipelineSources: null });
    mocks.db.read.findMany.mockResolvedValue([
      {
        id: "read-old",
        file1: "simulated/order_order-1/old_R1.fastq.gz",
        file2: "simulated/order_order-1/old_R2.fastq.gz",
      },
    ]);

    const result = await resolveOutputs("simulate-reads", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1.json",
          path: path.join(tempDir, "run-output", "manifests", "sample-1.json"),
          sampleId: "sample-1",
          outputId: "sample-simulated-reads",
          metadata: {
            file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
            file2: "simulated/order_order-1/sample-1_R2.fastq.gz",
            sourceFile1,
            sourceFile2,
            checksum1: "abc",
            checksum2: "def",
            readCount1: 1000,
            readCount2: 1000,
            replaceExisting: true,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(mocks.db.read.deleteMany).toHaveBeenCalledWith({
      where: { sampleId: "sample-1" },
    });
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: {
        sampleId: "sample-1",
        file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
        file2: "simulated/order_order-1/sample-1_R2.fastq.gz",
        checksum1: "abc",
        checksum2: "def",
        readCount1: 1000,
        readCount2: 1000,
        avgQuality1: null,
        avgQuality2: null,
        fastqcReport1: null,
        fastqcReport2: null,
        pipelineRunId: "run-id",
        pipelineSources: '{"simulate-reads":"run-id"}',
      },
    });
    await expect(
      fs.readFile(path.join(storageDir, "simulated", "order_order-1", "sample-1_R1.fastq.gz"), "utf8")
    ).resolves.toBe("new-r1");
    await expect(
      fs.readFile(path.join(storageDir, "simulated", "order_order-1", "sample-1_R2.fastq.gz"), "utf8")
    ).resolves.toBe("new-r2");
    await expect(fs.access(oldFile1)).rejects.toBeDefined();
    await expect(fs.access(oldFile2)).rejects.toBeDefined();
  });

  it("skips file copy and read update when replaceExisting is false and sample already has reads", async () => {
    const sourceDir = path.join(tempDir, "run-output", "reads");
    const storageDir = path.join(tempDir, "storage");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(storageDir, "simulated", "order_order-1"), {
      recursive: true,
    });

    const sourceFile1 = path.join(sourceDir, "sample-1_R1.fastq.gz");
    const sourceFile2 = path.join(sourceDir, "sample-1_R2.fastq.gz");
    await fs.writeFile(sourceFile1, "new-r1");
    await fs.writeFile(sourceFile2, "new-r2");

    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-simulated-reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "manifests/*.json" },
          },
        ],
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: storageDir,
      source: "database",
      isImplicit: false,
    });
    // Sample already has reads from a previous run
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-existing",
      file1: "simulated/order_order-1/old_R1.fastq.gz",
      pipelineSources: null,
    });

    const result = await resolveOutputs("simulate-reads", "run-2", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1.json",
          path: path.join(tempDir, "run-output", "manifests", "sample-1.json"),
          sampleId: "sample-1",
          outputId: "sample-simulated-reads",
          metadata: {
            file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
            file2: "simulated/order_order-1/sample-1_R2.fastq.gz",
            sourceFile1,
            sourceFile2,
            replaceExisting: false,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    // Should NOT copy files, create, or update the read
    expect(mocks.db.read.create).not.toHaveBeenCalled();
    expect(mocks.db.read.update).not.toHaveBeenCalled();
    expect(mocks.db.read.deleteMany).not.toHaveBeenCalled();
    // The storage dir should NOT have the new files
    await expect(
      fs.access(path.join(storageDir, "simulated", "order_order-1", "sample-1_R1.fastq.gz"))
    ).rejects.toBeDefined();
  });

  it("creates read when replaceExisting is false but sample has no existing reads", async () => {
    const sourceDir = path.join(tempDir, "run-output", "reads");
    const storageDir = path.join(tempDir, "storage");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(storageDir, "simulated", "order_order-1"), {
      recursive: true,
    });

    const sourceFile1 = path.join(sourceDir, "sample-1_R1.fastq.gz");
    await fs.writeFile(sourceFile1, "new-r1");

    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-simulated-reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "manifests/*.json" },
          },
        ],
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: storageDir,
      source: "database",
      isImplicit: false,
    });
    // No existing reads
    mocks.db.read.findFirst.mockResolvedValue(null);

    const result = await resolveOutputs("simulate-reads", "run-1", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1.json",
          path: path.join(tempDir, "run-output", "manifests", "sample-1.json"),
          sampleId: "sample-1",
          outputId: "sample-simulated-reads",
          metadata: {
            file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
            sourceFile1,
            replaceExisting: false,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    // Should create a new read since none exists
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
        pipelineRunId: "run-1",
      }),
    });
  });

  it("replaceExisting=true overwrites existing reads and sets new pipelineRunId", async () => {
    const sourceDir = path.join(tempDir, "run-output", "reads");
    const storageDir = path.join(tempDir, "storage");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(storageDir, "simulated", "order_order-1"), {
      recursive: true,
    });

    const sourceFile1 = path.join(sourceDir, "sample-1_R1.fastq.gz");
    await fs.writeFile(sourceFile1, "new-r1");

    const oldFile1 = path.join(storageDir, "simulated", "order_order-1", "old_R1.fastq.gz");
    await fs.writeFile(oldFile1, "old-r1");

    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-simulated-reads",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
            discovery: { pattern: "manifests/*.json" },
          },
        ],
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: storageDir,
      source: "database",
      isImplicit: false,
    });
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-existing",
      file1: "simulated/order_order-1/old_R1.fastq.gz",
      pipelineSources: null,
    });
    mocks.db.read.findMany.mockResolvedValue([
      {
        id: "read-existing",
        file1: "simulated/order_order-1/old_R1.fastq.gz",
        file2: null,
      },
    ]);

    const result = await resolveOutputs("simulate-reads", "run-2", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "sample-1.json",
          path: path.join(tempDir, "run-output", "manifests", "sample-1.json"),
          sampleId: "sample-1",
          outputId: "sample-simulated-reads",
          metadata: {
            file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
            sourceFile1,
            replaceExisting: true,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    // Should delete old reads and create new one with new pipelineRunId
    expect(mocks.db.read.deleteMany).toHaveBeenCalledWith({
      where: { sampleId: "sample-1" },
    });
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        file1: "simulated/order_order-1/sample-1_R1.fastq.gz",
        pipelineRunId: "run-2",
      }),
    });
  });

  it("collects handler errors and marks result as failed", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "bin-output",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });
    mocks.db.bin.findFirst.mockResolvedValue(null);
    mocks.db.bin.create.mockRejectedValue(new Error("db write failure"));

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "bin",
          name: "bin.fa",
          path: "/tmp/bin.fa",
          sampleId: "sample-1",
          outputId: "bin-output",
        },
      ],
      errors: ["upstream error"],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("upstream error");
    expect(result.errors.some((error) => error.includes("Failed to create bin"))).toBe(true);
    expect(mocks.db.bin.create).toHaveBeenCalledTimes(1);
  });

  it("uses explicit outputId even when destination fallback would map differently", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "wrong-destination",
            scope: "sample",
            destination: "sample_qc",
            type: "qc",
            discovery: { pattern: "assembly.fa" },
          },
          {
            id: "direct-bin",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });
    mocks.db.bin.findFirst.mockResolvedValue(null);
    mocks.db.bin.create.mockResolvedValue({});
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "sample-1.fasta",
          path: "/tmp/sample-1.fasta",
          sampleId: "sample-1",
          outputId: "direct-bin",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(0);
    expect(result.binsCreated).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(mocks.db.bin.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.assembly.create).not.toHaveBeenCalled();
  });

  it("falls back to scope-based matching when explicit outputId is unknown", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "fallback-assembly",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
          {
            id: "run-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "artifact.txt" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "sample-1.fasta",
          path: "/tmp/sample-1.fasta",
          sampleId: "sample-1",
          outputId: "missing-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(mocks.db.assembly.create).toHaveBeenCalledTimes(1);
  });

  it("counts skipped assembly and bin creations when records already exist", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
          {
            id: "bin-output",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue({ id: "existing" });
    mocks.db.bin.findFirst.mockResolvedValue({ id: "existing" });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "sample-1.fasta",
          path: "/tmp/sample-1.fasta",
          sampleId: "sample-1",
          outputId: "asm-output",
        },
        {
          type: "bin",
          name: "bins.tsv",
          path: "/tmp/bin.fa",
          sampleId: "sample-1",
          outputId: "bin-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(1);
    expect(result.binsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("handles missing sample id for assemblies and bins", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
          {
            id: "bin-output",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "missing-sample.fasta",
          path: "/tmp/missing-sample.fasta",
          outputId: "asm-output",
        },
        {
          type: "bin",
          name: "missing-bin.fa",
          path: "/tmp/missing-bin.fa",
          outputId: "bin-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Assembly missing-sample.fasta: No sample ID");
    expect(result.errors).toContain("Bin missing-bin.fa: No sample ID");
  });

  it("adds errors when assembly creation fails", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            discovery: { pattern: "asm.fasta" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockRejectedValue(new Error("assembly create failed"));

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "broken-assembly.fasta",
          path: "/tmp/broken-assembly.fasta",
          sampleId: "sample-1",
          outputId: "asm-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to create assembly: assembly create failed");
  });

  it("counts existing artifacts from idempotency path", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "artifact-output",
            scope: "run",
            destination: "run_artifact",
            discovery: { pattern: "artifact.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue({ id: "existing-artifact" });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "existing.txt",
          path: "/tmp/existing.txt",
          outputId: "artifact-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("matches outputs through scope-priority fallback when outputId is missing", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "sample.fasta" },
          },
          {
            id: "run-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "unmatched.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "unmatched.txt",
          path: "/tmp/unmatched.txt",
          sampleId: "sample-1",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "data",
        name: "unmatched.txt",
        path: "/tmp/unmatched.txt",
        sampleId: "sample-1",
        producedByStepId: "",
      }),
    });
  });

  it("falls back to destination-only matching when scope-based matching fails", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "legacy-output",
            scope: "custom" as never,
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "legacy.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "legacy.txt",
          path: "/tmp/legacy.txt",
          sampleId: "sample-1",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "data",
        name: "legacy.txt",
        path: "/tmp/legacy.txt",
      }),
    });
  });

  it("falls back when file type has no destination priority mapping", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "run-output",
            scope: "run",
            destination: "run_artifact",
            discovery: { pattern: "unmatched.txt" },
          } as never,
        ],
      },
    });

    const invalidType = "weird" as unknown as "artifact";
    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: invalidType,
          name: "unmatched.txt",
          path: "/tmp/unmatched.txt",
        } as never,
      ],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("No output definition found for weird: unmatched.txt");
    expect(result.artifactsCreated).toBe(1);
  });

  it("supports qc outputs and serializes artifact metadata", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "qc-output",
            scope: "sample",
            destination: "sample_qc",
            type: "qc",
            discovery: { pattern: "qc.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "qc",
          name: "qc.txt",
          path: "/tmp/qc.txt",
          sampleId: "sample-1",
          metadata: { completeness: 95.2 },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "qc",
        name: "qc.txt",
        path: "/tmp/qc.txt",
        sampleId: "sample-1",
        metadata: JSON.stringify({ completeness: 95.2 }),
      }),
    });
  });

  it("creates run artifacts with report destination as report artifact type", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "report-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "report.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "report",
          name: "report.txt",
          path: "/tmp/report.txt",
          outputId: "report-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "report",
          name: "report.txt",
          path: "/tmp/report.txt",
        }),
      })
    );
  });

  it("captures non-Error failures from assembly creation", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "asm-output",
            scope: "sample",
            destination: "sample_assemblies",
            type: "assembly",
            discovery: { pattern: "asm.fasta" },
          },
        ],
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.assembly.create.mockRejectedValue("assembly create exploded");

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "assembly",
          name: "bad-assembly.fasta",
          path: "/tmp/bad-assembly.fasta",
          sampleId: "sample-1",
          outputId: "asm-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to create assembly: Unknown error");
  });

  it("captures non-Error failures from bin creation", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "bin-output",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });
    mocks.db.bin.findFirst.mockResolvedValue(null);
    mocks.db.bin.create.mockRejectedValue({ error: "nope" });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "bin",
          name: "bins.fa",
          path: "/tmp/bins.fa",
          sampleId: "sample-1",
          outputId: "bin-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to create bin: Unknown error");
  });

  it("captures non-Error failures from artifact creation", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "artifact-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "artifact.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockRejectedValue(999);

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "artifact.txt",
          path: "/tmp/artifact.txt",
          outputId: "artifact-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to create artifact: Unknown error");
  });

  it("defaults unknown output destinations to download-only records", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "missing-destination",
            scope: "run",
            destination: undefined,
            type: "artifact",
            discovery: { pattern: "report.txt" },
          } as never,
        ],
      },
    });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "report.txt",
          path: "/tmp/report.txt",
          outputId: "missing-destination",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(0);
    expect(mocks.db.pipelineArtifact.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.pipelineArtifact.create).not.toHaveBeenCalled();
  });

  it("creates bin successfully and increments bin count", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "bin-output",
            scope: "sample",
            destination: "sample_bins",
            type: "bin",
            discovery: { pattern: "bins.tsv" },
          },
        ],
      },
    });
    mocks.db.bin.findFirst.mockResolvedValue(null);
    mocks.db.bin.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "bin",
          name: "bins.fa",
          path: "/tmp/bins.fa",
          sampleId: "sample-1",
          outputId: "bin-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.binsCreated).toBe(1);
    expect(mocks.db.bin.create).toHaveBeenCalled();
  });

  it("does not increment counters for download_only destinations", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "dl-output",
            scope: "run",
            destination: "download_only",
            type: "artifact",
            discovery: { pattern: "db.tar.gz" },
          },
        ],
      },
    });

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "db.tar.gz",
          path: "/tmp/db.tar.gz",
          outputId: "dl-output",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(0);
    expect(mocks.db.pipelineArtifact.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.pipelineArtifact.create).not.toHaveBeenCalled();
  });

  it("falls back to artifact with warnings when fallback creation fails", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "other-output",
            scope: "sample",
            destination: "sample_assemblies",
            discovery: { pattern: "other.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockRejectedValue(new Error("artifact create failed"));

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "unmatched.txt",
          path: "/tmp/unmatched.txt",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toContain("No output definition found for artifact: unmatched.txt");
    expect(result.warnings.some((warning) => warning.includes("Failed to create artifact"))).toBe(true);
  });

  it("falls back to artifact when manifest outputs are missing", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {},
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "missing-manifest-output.txt",
          path: "/tmp/missing-manifest-output.txt",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(result.warnings).toContain("No output definition found for artifact: missing-manifest-output.txt");
    expect(result.errors).toHaveLength(0);
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledTimes(1);
  });

  it("falls back to artifact when destination fallback has no matches", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "other-output",
            scope: "study",
            destination: "study_report",
            type: "artifact",
            discovery: { pattern: "other.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockResolvedValue({});

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "no-destination-match.txt",
          path: "/tmp/no-destination-match.txt",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.artifactsCreated).toBe(1);
    expect(result.warnings).toContain("No output definition found for artifact: no-destination-match.txt");
    expect(mocks.db.pipelineArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "data",
        name: "no-destination-match.txt",
        path: "/tmp/no-destination-match.txt",
      }),
    });
  });

  it("records errors when a known artifact destination handler fails", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "report-output",
            scope: "run",
            destination: "run_artifact",
            type: "artifact",
            discovery: { pattern: "fail.txt" },
          },
        ],
      },
    });
    mocks.db.pipelineArtifact.findFirst.mockResolvedValue(null);
    mocks.db.pipelineArtifact.create.mockRejectedValue(new Error("run artifact failed"));

    const result = await resolveOutputs("mag", "run-id", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "failing-run-artifact.txt",
          path: "/tmp/failing-run-artifact.txt",
          outputId: "report-output",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to create artifact: run artifact failed");
  });

  it("saves run result payload with conditional serialization", async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await saveRunResults("run-id", {
      success: true,
      assembliesCreated: 1,
      binsCreated: 0,
      artifactsCreated: 2,
      errors: [],
      warnings: [],
    });

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-id" },
      data: {
        results: JSON.stringify({
          assembliesCreated: 1,
          binsCreated: 0,
          artifactsCreated: 2,
          errors: undefined,
          warnings: undefined,
        }),
      },
    });
  });

  it("falls back to findFirst without pipelineSources when column does not exist (metadata path)", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_checksums",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
          },
        ],
      },
    });
    // First call (with pipelineSources) fails, second call (without) succeeds
    mocks.db.read.findFirst
      .mockRejectedValueOnce(new Error("Unknown field pipelineSources"))
      .mockResolvedValueOnce({ id: "read-1" });
    mocks.db.read.update.mockResolvedValue({});

    const result = await resolveOutputs("fastq-checksum", "ck-run-1", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "s1.json",
          path: "/data/s1.json",
          sampleId: "s1",
          outputId: "sample_checksums",
          metadata: {
            checksum1: "abc123",
            checksum2: "def456",
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    // Should have retried findFirst without pipelineSources
    expect(mocks.db.read.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: expect.objectContaining({
        checksum1: "abc123",
        checksum2: "def456",
      }),
    });
  });

  it("retries metadata update without pipelineSources when column does not exist in DB", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "sample_checksums",
            scope: "sample",
            destination: "sample_reads",
            type: "artifact",
          },
        ],
      },
    });
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      pipelineSources: null,
    });
    // First update (with pipelineSources) fails, second (without) succeeds
    mocks.db.read.update
      .mockRejectedValueOnce(new Error("Unknown field pipelineSources"))
      .mockResolvedValueOnce({});

    const result = await resolveOutputs("fastq-checksum", "ck-run-1", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "s1.json",
          path: "/data/s1.json",
          sampleId: "s1",
          outputId: "sample_checksums",
          metadata: {
            checksum1: "abc123",
            checksum2: null,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.db.read.update).toHaveBeenCalledTimes(2);
    // Second call should NOT include pipelineSources
    const secondCall = mocks.db.read.update.mock.calls[1][0];
    expect(secondCall.data).toEqual({
      checksum1: "abc123",
      checksum2: null,
    });
    expect(secondCall.data).not.toHaveProperty("pipelineSources");
  });

  it("falls back to findFirst without pipelineSources when column does not exist (file-writeback path)", async () => {
    const sourceDir = path.join(tempDir, "run-output", "reads");
    await fs.mkdir(sourceDir, { recursive: true });
    const src1 = path.join(sourceDir, "s1_R1.fastq.gz");
    await fs.writeFile(src1, "read1-content");

    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "reads",
            scope: "sample",
            destination: "sample_reads",
          },
        ],
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: tempDir,
    });
    // First call (with pipelineSources) fails, second call (without) succeeds
    mocks.db.read.findFirst
      .mockRejectedValueOnce(new Error("Unknown field pipelineSources"))
      .mockResolvedValueOnce(null);
    mocks.db.read.create.mockResolvedValue({});

    const result = await resolveOutputs("simulate-reads", "sr-run-1", {
      ...baseDiscovered,
      files: [
        {
          type: "artifact",
          name: "s1_reads",
          path: src1,
          sampleId: "s1",
          outputId: "reads",
          metadata: {
            file1: "orders/s1/s1_R1.fastq.gz",
            sourceFile1: src1,
            replaceExisting: true,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.db.read.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.db.read.create).toHaveBeenCalled();
  });

  it("saves run results with errors and warnings arrays", async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await saveRunResults("run-id", {
      success: false,
      assembliesCreated: 0,
      binsCreated: 1,
      artifactsCreated: 0,
      errors: ["assembly failed"],
      warnings: ["partial data"],
    });

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-id" },
      data: {
        results: JSON.stringify({
          assembliesCreated: 0,
          binsCreated: 1,
          artifactsCreated: 0,
          errors: ["assembly failed"],
          warnings: ["partial data"],
        }),
      },
    });
  });
});
