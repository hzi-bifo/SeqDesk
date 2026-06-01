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
  getResolvedDataBasePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

import {
  READ_CLEANING_CANDIDATE_OUTPUT_ID,
  listReadCleaningCandidates,
  promoteReadCleaningCandidates,
} from "./read-cleaning-results";

let tempDir = "";

function writeFastq(filePath: string, reads = 2) {
  const lines: string[] = [];
  for (let index = 0; index < reads; index += 1) {
    lines.push(`@read_${index}`, "ACGT", "+", "IIII");
  }
  return fs.writeFile(filePath, `${lines.join("\n")}\n`);
}

function createRun(runFolder: string, candidatePath: string) {
  return {
    id: "run-1",
    runNumber: "RUN-001",
    pipelineId: "read-cleaning",
    status: "completed",
    runFolder,
    orderId: "order-1",
    targetType: "order",
    artifacts: [
      {
        id: "artifact-1",
        name: "S1 cleaned reads",
        path: candidatePath,
        sampleId: "sample-1",
        outputId: READ_CLEANING_CANDIDATE_OUTPUT_ID,
        metadata: JSON.stringify({
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
              file2: null,
              dataClass: "raw",
              isActive: true,
              pipelineRunId: null,
              pipelineSources: null,
            },
          ],
        },
      ],
    },
  };
}

describe("read-cleaning-results", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-read-cleaning-results-"));
    mocks.txRead.findFirst.mockResolvedValue(null);
    mocks.txRead.create.mockResolvedValue({ id: "read-cleaned" });
    mocks.txRead.updateMany.mockResolvedValue({ count: 1 });
    mocks.txRead.update.mockResolvedValue({ id: "read-cleaned" });
    mocks.db.$transaction.mockImplementation(async (callback) =>
      callback({ read: mocks.txRead }),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("lists cleaned read candidates without changing active reads", async () => {
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filter", "filtered", "S1_filtered.fastq");
    mocks.db.pipelineRun.findUnique.mockResolvedValue(createRun(runFolder, candidatePath));

    const summary = await listReadCleaningCandidates("run-1");

    expect(summary.run).toMatchObject({
      id: "run-1",
      runNumber: "RUN-001",
      status: "completed",
      orderId: "order-1",
    });
    expect(summary.candidates).toEqual([
      expect.objectContaining({
        artifactId: "artifact-1",
        sampleId: "sample-1",
        sampleCode: "S1",
        file1: candidatePath,
        readLayout: "single",
        status: "candidate",
        currentRead: expect.objectContaining({
          id: "read-raw",
          dataClass: "raw",
          isProtectedRaw: true,
        }),
      }),
    ]);
    expect(summary.reports).toEqual([
      expect.objectContaining({
        id: "artifact-report",
        name: "MultiQC report",
        outputId: "multiqc_report",
      }),
    ]);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps the compatibility wrapper scoped to read-cleaning runs", async () => {
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filter", "filtered", "S1_filtered.fastq");
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...createRun(runFolder, candidatePath),
      pipelineId: "fastq-checksum",
    });

    await expect(listReadCleaningCandidates("run-1")).rejects.toThrow(
      "Pipeline run is not a read-cleaning run"
    );
  });

  it("promotes selected candidates as active cleaned reads and preserves previous files", async () => {
    const dataBasePath = path.join(tempDir, "data");
    const runFolder = path.join(tempDir, "run");
    const candidatePath = path.join(runFolder, "output", "filter", "filtered", "S1_filtered.fastq");

    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFastq(candidatePath, 2);

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath,
      source: "database",
      isImplicit: false,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue(createRun(runFolder, candidatePath));

    const result = await promoteReadCleaningCandidates({
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
          "read-cleaning",
          "RUN-001",
          "S1",
          "cleaned_read_candidates",
          "R1-S1_filtered.fastq",
        ),
        file2: null,
        checksum1: createHash("md5")
          .update(await fs.readFile(candidatePath))
          .digest("hex"),
        readCount1: 2,
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: false,
        pipelineRunId: "run-1",
        pipelineSources: JSON.stringify({ "read-cleaning": "run-1" }),
        classifiedById: "admin-1",
        classificationNote: "Promoted cleaned reads from RUN-001",
      }),
    });
    expect(mocks.txRead.updateMany).toHaveBeenCalledWith({
      where: {
        sampleId: "sample-1",
        isActive: true,
      },
      data: {
        isActive: false,
        supersededByReadId: "read-cleaned",
      },
    });
    expect(mocks.txRead.update).toHaveBeenCalledWith({
      where: { id: "read-cleaned" },
      data: { isActive: true },
    });

    const copiedPath = path.join(
      dataBasePath,
      "_pipeline",
      "orders",
      "order-1",
      "read-cleaning",
      "RUN-001",
      "S1",
      "cleaned_read_candidates",
      "R1-S1_filtered.fastq",
    );
    await expect(fs.readFile(copiedPath, "utf8")).resolves.toContain("@read_0");
  });
});
