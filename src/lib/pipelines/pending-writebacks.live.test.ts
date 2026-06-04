/**
 * Real-database integration test for the order read-cleaning -> candidate ->
 * admin promotion path (the "order pipeline" writeback contract).
 *
 * Unlike pending-writebacks.test.ts (which mocks @/lib/db), this exercises the
 * real Prisma client, the real read-cleaning package contract, and real file
 * copies against a live Postgres test database. It is gated to the `live` tier
 * (SEQDESK_TEST_TIER=live) because it requires a migrated database and is the
 * piece the order-pipeline-e2e workflow runs to cover read-cleaning promotion.
 *
 * detaxizer/kraken2 are intentionally NOT executed; the cleaned-read candidate
 * artifacts are seeded directly the way resolveOutputs would create them, so
 * this stays fast, deterministic, and free of external bioinformatics deps.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dataBasePath: "" }));

// Point the canonical data base path at a temp dir; everything else is real.
vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: vi.fn(async () => ({
    dataBasePath: state.dataBasePath,
    source: "database",
    isImplicit: false,
  })),
}));

import { db } from "@/lib/db";
import { listPendingWritebacks, promotePendingWritebacks } from "./pending-writebacks";

// The read-cleaning package stages cleaned reads under this manifest output id.
const READ_CLEANING_CANDIDATE_OUTPUT_ID = "cleaned_read_candidates";

const CANDIDATE_FASTQ = ["@r0", "ACGT", "+", "IIII", "@r1", "TGCA", "+", "IIII", ""].join("\n");

type Seed = {
  tag: string;
  userId: string;
  orderId: string;
  sampleId: string;
  rawReadId: string;
  runId: string;
  runFolder: string;
  dataDir: string;
  candidatePath: string;
};

let seed: Seed | null = null;

async function createSeed(): Promise<Seed> {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const runFolder = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-wb-run-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-wb-data-"));
  const candidatePath = path.join(runFolder, "filter", "filtered", "S1_filtered.fastq");
  await fs.mkdir(path.dirname(candidatePath), { recursive: true });
  await fs.writeFile(candidatePath, CANDIDATE_FASTQ);
  state.dataBasePath = dataDir;

  const user = await db.user.create({
    data: {
      email: `e2e-writeback-${tag}@example.com`,
      password: "integration-test",
      firstName: "E2E",
      lastName: "Writeback",
      role: "FACILITY_ADMIN",
    },
  });
  const order = await db.order.create({
    data: {
      orderNumber: `E2E-WB-${tag}`,
      status: "SUBMITTED",
      generatedByE2E: true,
      userId: user.id,
    },
  });
  const sample = await db.sample.create({
    data: { sampleId: "S1", orderId: order.id },
  });
  const rawRead = await db.read.create({
    data: {
      sampleId: sample.id,
      file1: `orders/${order.id}/S1_raw_R1.fastq.gz`,
      dataClass: "raw",
      dataClassSource: "manual",
      isActive: true,
    },
  });
  const run = await db.pipelineRun.create({
    data: {
      runNumber: `E2E-RC-${tag}`,
      pipelineId: "read-cleaning",
      status: "completed",
      targetType: "order",
      orderId: order.id,
      userId: user.id,
      runFolder,
      results: JSON.stringify({ artifactsCreated: 1, pendingWritebacks: 1 }),
    },
  });
  await db.pipelineArtifact.create({
    data: {
      type: "artifact",
      name: "S1 cleaned reads",
      path: candidatePath,
      outputId: READ_CLEANING_CANDIDATE_OUTPUT_ID,
      sampleId: sample.id,
      pipelineRunId: run.id,
      metadata: JSON.stringify({
        sourceFile1: candidatePath,
        sourceFile2: null,
        readLayout: "single",
      }),
    },
  });

  return {
    tag,
    userId: user.id,
    orderId: order.id,
    sampleId: sample.id,
    rawReadId: rawRead.id,
    runId: run.id,
    runFolder,
    dataDir,
    candidatePath,
  };
}

async function destroySeed(current: Seed): Promise<void> {
  // Order matters: run delete cascades artifacts (and SetNulls read.pipelineRunId);
  // order delete cascades samples -> reads; then the user can be removed.
  await db.pipelineRun.deleteMany({ where: { id: current.runId } });
  await db.order.deleteMany({ where: { id: current.orderId } });
  await db.user.deleteMany({ where: { id: current.userId } });
  await fs.rm(current.runFolder, { recursive: true, force: true });
  await fs.rm(current.dataDir, { recursive: true, force: true });
}

describe("pending-writebacks (live DB)", () => {
  beforeEach(async () => {
    seed = await createSeed();
  });

  afterEach(async () => {
    if (seed) {
      await destroySeed(seed);
      seed = null;
    }
  });

  it("lists the cleaned-read candidate against the live database", async () => {
    if (!seed) throw new Error("seed missing");
    const summary = await listPendingWritebacks(seed.runId);

    expect(summary.run).toMatchObject({
      id: seed.runId,
      pipelineId: "read-cleaning",
      status: "completed",
      orderId: seed.orderId,
    });
    expect(summary.readCandidates).toHaveLength(1);
    expect(summary.readCandidates[0]).toMatchObject({
      sampleCode: "S1",
      status: "candidate",
      targetDataClass: "cleaned",
      currentRead: expect.objectContaining({ dataClass: "raw", isProtectedRaw: true }),
    });
  });

  it("promotes the candidate to an active cleaned read while preserving the raw read", async () => {
    if (!seed) throw new Error("seed missing");
    const result = await promotePendingWritebacks({
      runId: seed.runId,
      sampleIds: [seed.sampleId],
      userId: seed.userId,
    });

    expect(result.promoted).toBe(1);

    const reads = await db.read.findMany({
      where: { sampleId: seed.sampleId },
    });
    // Raw read is preserved (not deleted), just superseded + deactivated.
    expect(reads).toHaveLength(2);
    const rawRead = reads.find((read) => read.id === seed!.rawReadId);
    const promoted = reads.find((read) => read.id === result.readIds[0]);
    expect(rawRead).toMatchObject({ dataClass: "raw", isActive: false });
    expect(rawRead?.supersededByReadId).toBe(promoted?.id);
    expect(promoted).toMatchObject({
      dataClass: "cleaned",
      dataClassSource: "pipeline",
      isActive: true,
      pipelineRunId: seed.runId,
    });
    expect(promoted?.pipelineSources).toBe(JSON.stringify({ "read-cleaning": seed.runId, __runs: [seed.runId] }));

    // The candidate file was copied into the canonical data base path.
    expect(promoted?.file1).toBeTruthy();
    const copied = path.join(seed.dataDir, promoted!.file1 as string);
    await expect(fs.readFile(copied, "utf8")).resolves.toContain("@r0");

    // The denormalized pending-writeback count is refreshed to 0 after promotion.
    const updatedRun = await db.pipelineRun.findUnique({ where: { id: seed.runId } });
    const results = JSON.parse(updatedRun?.results ?? "{}");
    expect(results.pendingWritebacks).toBe(0);

    // Re-listing now reports the candidate as promoted (no longer pending).
    const summary = await listPendingWritebacks(seed.runId);
    expect(summary.readCandidates[0]?.status).toBe("promoted");
  });
});
