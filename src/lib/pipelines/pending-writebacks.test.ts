import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  txRead: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  txPipelineRun: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  getPackage: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
}));

import {
  listPendingWritebacks,
  promotePendingWritebacks,
} from "./pending-writebacks";

let tempDir = "";

function writeFastq(filePath: string, reads = 2) {
  const lines: string[] = [];
  for (let index = 0; index < reads; index += 1) {
    lines.push(`@read_${index}`, "ACGT", "+", "IIII");
  }
  return fs.writeFile(filePath, `${lines.join("\n")}\n`);
}

function mockPackage() {
  mocks.getPackage.mockReturnValue({
    manifest: {
      outputs: [
        {
          id: "filtered_reads",
          scope: "sample",
          destination: "run_artifact",
          type: "artifact",
          result: {
            kind: "sample_read_candidate",
            writebackPolicy: "admin_review",
            preview: { label: "Filtered read candidate" },
          },
          discovery: { pattern: "filtered/*.fastq.gz" },
        },
        {
          id: "multiqc_report",
          scope: "run",
          destination: "run_artifact",
          type: "report",
          discovery: { pattern: "multiqc/multiqc_report.html" },
        },
      ],
    },
    definition: {
      outputs: [
        { id: "filtered_reads", name: "Filtered Reads" },
        { id: "multiqc_report", name: "MultiQC" },
      ],
    },
  });
}

function createRun(runFolder: string, candidatePath: string) {
  return {
    id: "run-1",
    runNumber: "RUN-001",
    pipelineId: "host-filter",
    status: "completed",
    runFolder,
    orderId: "order-1",
    targetType: "order",
    artifacts: [
      {
        id: "artifact-1",
        name: "S1 filtered reads",
        path: candidatePath,
        sampleId: "sample-1",
        outputId: "filtered_reads",
        metadata: JSON.stringify({
          dataClass: "cleaned",
          readLayout: "single",
          sourceFile1: candidatePath,
          sourceFile2: null,
          classified_reads: 2,
        }),
      },
      {
        id: "artifact-report",
        name: "MultiQC report",
        path: path.join(runFolder, "output", "multiqc", "multiqc_report.html"),
        sampleId: null,
        outputId: "multiqc_report",
        metadata: null,
      },
    ],
    order: {
      id: "order-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          reads: [
            {
              id: "read-raw",
              file1: "orders/order-1/S1.fastq",
              file2: null as string | null,
              dataClass: "raw",
              isActive: true,
              pipelineRunId: null as string | null,
              pipelineSources: null as string | null,
            },
          ],
        },
      ],
    },
  };
}

describe("pending-writebacks", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-pending-writebacks-"));
    mockPackage();
    mocks.txRead.findFirst.mockResolvedValue(null);
    mocks.txRead.create.mockResolvedValue({ id: "read-cleaned" });
    mocks.txRead.updateMany.mockResolvedValue({ count: 1 });
    mocks.txRead.update.mockResolvedValue({ id: "read-cleaned" });
    // The count-recompute transaction re-reads results and, for each candidate,
    // checks whether a promoted read now exists. By default the promotion
    // transaction's tx.read.findFirst returns null (no prior promotion), and the
    // count-recompute's tx.read.findFirst sees the just-promoted read.
    mocks.txPipelineRun.findUnique.mockResolvedValue({ results: null });
    mocks.txPipelineRun.update.mockResolvedValue({});
    mocks.db.$transaction.mockImplementation(async (callback) =>
      callback({ read: mocks.txRead, pipelineRun: mocks.txPipelineRun }),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("lists staged read candidates from manifest result contracts", async () => {
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");
    mocks.db.pipelineRun.findUnique.mockResolvedValue(createRun(runFolder, candidatePath));

    const summary = await listPendingWritebacks("run-1");

    expect(summary.run).toMatchObject({
      id: "run-1",
      pipelineId: "host-filter",
      status: "completed",
      orderId: "order-1",
    });
    expect(summary.readCandidates).toEqual([
      expect.objectContaining({
        artifactId: "artifact-1",
        outputId: "filtered_reads",
        outputLabel: "Filtered read candidate",
        sampleId: "sample-1",
        sampleCode: "S1",
        file1: candidatePath,
        targetDataClass: "cleaned",
        status: "candidate",
      }),
    ]);
    expect(summary.reports).toEqual([
      expect.objectContaining({
        id: "artifact-report",
        name: "MultiQC report",
      }),
    ]);
  });

  it("promotes selected candidates using the producing pipeline id for provenance", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");

    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFastq(candidatePath, 2);

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(createRun(runFolder, candidatePath));
    // Promotion-transaction guard sees no prior promotion (null); the subsequent
    // count-recompute transaction sees the freshly promoted read for the sample.
    mocks.txRead.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "read-cleaned" });

    const result = await promotePendingWritebacks({
      runId: "run-1",
      sampleIds: ["sample-1"],
      userId: "admin-1",
    });

    expect(result).toEqual({ promoted: 1, readIds: ["read-cleaned"] });
    expect(mocks.txRead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: "sample-1",
        file1: path.join(
          "_pipeline",
          "orders",
          "order-1",
          "host-filter",
          "RUN-001",
          "S1",
          "filtered_reads",
          "R1-S1.fastq",
        ),
        checksum1: createHash("md5")
          .update(await fs.readFile(candidatePath))
          .digest("hex"),
        readCount1: 2,
        pipelineRunId: "run-1",
        pipelineSources: JSON.stringify({ "host-filter": "run-1", __runs: ["run-1"] }),
        classifiedById: "admin-1",
        classificationNote: "Promoted cleaned reads from RUN-001",
      }),
    });
    // The count is recomputed from live rows and written inside the transaction,
    // merging only the pendingWritebacks key into the freshly re-read results.
    expect(mocks.txPipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { results: JSON.stringify({ pendingWritebacks: 0 }) },
    });
  });

  it("skips creating a duplicate read when a concurrent promotion already promoted the candidate", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");

    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFastq(candidatePath, 2);

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(createRun(runFolder, candidatePath));

    // Inside the transaction, a read promoted from this run for the sample
    // already exists (a concurrent/double-submit promotion won the race).
    mocks.txRead.findFirst.mockResolvedValue({ id: "read-already-promoted" });

    const result = await promotePendingWritebacks({
      runId: "run-1",
      sampleIds: ["sample-1"],
      userId: "admin-1",
    });

    expect(result).toEqual({ promoted: 0, readIds: [] });
    // No duplicate read created, no supersession performed.
    expect(mocks.txRead.create).not.toHaveBeenCalled();
    expect(mocks.txRead.updateMany).not.toHaveBeenCalled();
    expect(mocks.txRead.findFirst).toHaveBeenCalledWith({
      where: {
        sampleId: "sample-1",
        dataClass: "cleaned",
        pipelineRunId: "run-1",
      },
      select: { id: true },
    });
  });

  it("rejects a candidate whose source path escapes the run folder and creates no read", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    // A candidate that points outside the run folder via path traversal. The
    // artifact path stays inside the run folder, but the metadata sourceFile1
    // (which wins over artifact.path in listPendingWritebacks) escapes it.
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    const run = createRun(runFolder, candidatePath);
    const escapingPath = path.join(runFolder, "..", "..", "..", "etc", "passwd");
    run.artifacts[0].metadata = JSON.stringify({
      dataClass: "cleaned",
      readLayout: "single",
      sourceFile1: escapingPath,
      sourceFile2: null,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(run);

    await expect(
      promotePendingWritebacks({
        runId: "run-1",
        sampleIds: ["sample-1"],
        userId: "admin-1",
      }),
    ).rejects.toThrow(/outside the run folder/);

    // The security guard must run before any read is created or copied.
    expect(mocks.txRead.create).not.toHaveBeenCalled();
    expect(mocks.txRead.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a candidate whose second source path escapes the run folder", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1_R1.fastq");

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    const run = createRun(runFolder, candidatePath);
    // R1 stays inside the run folder, but R2 is an absolute path elsewhere on disk.
    run.artifacts[0].metadata = JSON.stringify({
      dataClass: "cleaned",
      readLayout: "paired",
      sourceFile1: candidatePath,
      sourceFile2: "/etc/shadow",
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(run);

    await expect(
      promotePendingWritebacks({
        runId: "run-1",
        sampleIds: ["sample-1"],
        userId: "admin-1",
      }),
    ).rejects.toThrow(/outside the run folder/);

    expect(mocks.txRead.create).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("forces protected raw/unknown candidate classes to cleaned on promotion", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");

    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFastq(candidatePath, 2);

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    const run = createRun(runFolder, candidatePath);
    run.artifacts[0].metadata = JSON.stringify({
      dataClass: "raw",
      readLayout: "single",
      sourceFile1: candidatePath,
      sourceFile2: null,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(run);

    await promotePendingWritebacks({ runId: "run-1", sampleIds: ["sample-1"], userId: "admin-1" });

    expect(mocks.txRead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dataClass: "cleaned", dataClassSource: "pipeline" }),
    });
  });

  it("keeps an earlier run's candidate marked promoted after a later same-pipeline run supersedes the active read", async () => {
    // Run-1 promoted a cleaned read; a later run-2 of the SAME pipeline then
    // promoted its own read and now owns the flat-map slot + pipelineRunId.
    // Run-1 must still see its candidate as promoted (BUG #17), because run-1
    // is recorded in the per-run __runs provenance list.
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filtered", "S1.fastq");
    const run = createRun(runFolder, candidatePath);
    // The active read is now owned by run-2, but __runs records both runs.
    run.order.samples[0].reads = [
      {
        id: "read-cleaned-2",
        file1: "x/S1_cleaned.fastq",
        file2: null,
        dataClass: "cleaned",
        isActive: true,
        pipelineRunId: "run-2",
        pipelineSources: JSON.stringify({
          "host-filter": "run-2",
          __runs: ["run-1", "run-2"],
        }),
      },
    ];
    mocks.db.pipelineRun.findUnique.mockResolvedValue(run);

    const summary = await listPendingWritebacks("run-1");

    expect(summary.readCandidates).toHaveLength(1);
    expect(summary.readCandidates[0].status).toBe("promoted");
  });
});
