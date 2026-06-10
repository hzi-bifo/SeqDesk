import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { getPackage } from "@/lib/pipelines/package-loader";
import { inferPipelineResultContract } from "@/lib/pipelines/package-contracts";
import {
  calculateMd5ForRelativePath,
  sanitizeSequencingFilename,
} from "@/lib/sequencing/storage";
import { countFastqStats } from "@/lib/sequencing/fastq-stats";
import {
  READ_DATA_CLASS_LABELS,
  type ReadDataClass,
  isProtectedReadDataClass,
  normalizeReadDataClass,
} from "@/lib/sequencing/constants";

export const PENDING_READ_CANDIDATE_KIND = "sample_read_candidate";

type ArtifactRecord = {
  id: string;
  name: string | null;
  path: string;
  sampleId: string | null;
  outputId: string | null;
  metadata: string | null;
};

type ReadRecord = {
  id: string;
  file1: string | null;
  file2: string | null;
  dataClass: string | null;
  isActive: boolean | null;
  pipelineRunId: string | null;
  pipelineSources: string | null;
};

type SampleRecord = {
  id: string;
  sampleId: string;
  reads: ReadRecord[];
};

type RunRecord = {
  id: string;
  runNumber: string;
  pipelineId: string;
  status: string;
  runFolder: string | null;
  orderId: string | null;
  targetType: string | null;
  results: string | null;
  artifacts: ArtifactRecord[];
  order: {
    id: string;
    samples: SampleRecord[];
  } | null;
};

type OrderRunRecord = RunRecord & {
  orderId: string;
  targetType: "order";
  order: NonNullable<RunRecord["order"]>;
};

export type PendingReadCandidateStatus = "candidate" | "promoted";

export interface PendingReadCandidate {
  artifactId: string;
  outputId: string | null;
  outputLabel: string;
  sampleId: string;
  sampleCode: string;
  file1: string;
  file2: string | null;
  readLayout: "single" | "paired" | "long" | "unknown";
  targetDataClass: ReadDataClass;
  status: PendingReadCandidateStatus;
  metadata: Record<string, unknown>;
  currentRead: {
    id: string;
    file1: string | null;
    file2: string | null;
    dataClass: string;
    dataClassLabel: string;
    isProtectedRaw: boolean;
  } | null;
}

export interface PendingWritebackReportFile {
  id: string;
  name: string;
  path: string;
  outputId: string | null;
}

export interface PendingWritebackReviewCopy {
  title: string;
  description: string;
  candidateCountLabel: string;
  emptyText: string;
  promoteButtonLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  reviewedLabel: string;
}

export interface PendingWritebackSummary {
  run: {
    id: string;
    runNumber: string;
    pipelineId: string;
    status: string;
    orderId: string | null;
  };
  readCandidates: PendingReadCandidate[];
  reports: PendingWritebackReportFile[];
  review: PendingWritebackReviewCopy;
}

export interface PromotePendingWritebacksResult {
  promoted: number;
  readIds: string[];
}

type CandidateOutput = {
  id: string;
  label: string;
};

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getReadLayout(value: unknown): PendingReadCandidate["readLayout"] {
  return value === "single" || value === "paired" || value === "long"
    ? value
    : "unknown";
}

function resolveCandidateDataClass(value: unknown): ReadDataClass {
  const normalized = normalizeReadDataClass(value);
  // Promoted candidates are always pipeline-produced output. Never let a pipeline
  // stage a candidate that masquerades as a protected raw/unknown read class, which
  // would overwrite an order's canonical source reads with derived data.
  return isProtectedReadDataClass(normalized) ? "cleaned" : normalized;
}

function parsePipelineSources(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

// Reserved key in pipelineSources holding an append-only list of every run id
// that has promoted reads onto this Read lineage. The flat map still records
// the CURRENT owner per pipeline ("latest run owns the active read"), but the
// list lets an earlier run still recognize its own promotion after a later
// same-pipeline run supersedes the active read (otherwise that earlier run's
// candidate would flip back to "candidate" in the review panel — BUG #17).
const PROMOTED_RUNS_KEY = "__runs";

function parsePromotedRuns(value: string | null | undefined): string[] {
  const sources = parsePipelineSources(value) as Record<string, unknown>;
  const raw = sources[PROMOTED_RUNS_KEY];
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

function mergePipelineSources(
  existing: string | null | undefined,
  pipelineId: string,
  runId: string
): string {
  const sources = parsePipelineSources(existing) as Record<string, unknown>;
  const runs = parsePromotedRuns(existing);
  if (!runs.includes(runId)) runs.push(runId);
  return JSON.stringify({
    ...sources,
    [pipelineId]: runId,
    [PROMOTED_RUNS_KEY]: runs,
  });
}

function getActiveRead(
  sample: SampleRecord,
  targetDataClass: ReadDataClass = "cleaned"
): ReadRecord | null {
  return (
    sample.reads.find(
      (read) =>
        read.isActive !== false &&
        read.file1 &&
        normalizeReadDataClass(read.dataClass) === targetDataClass
    ) ||
    sample.reads.find((read) => read.isActive !== false && read.file1) ||
    null
  );
}

function isReadPromotedFromRun(
  read: ReadRecord | null,
  run: Pick<RunRecord, "id" | "pipelineId">,
  targetDataClass: ReadDataClass
): boolean {
  if (!read) return false;
  if (normalizeReadDataClass(read.dataClass) !== targetDataClass) return false;
  if (read.pipelineRunId === run.id) return true;
  if (parsePipelineSources(read.pipelineSources)[run.pipelineId] === run.id) return true;
  // A later same-pipeline run may now own the flat-map slot / pipelineRunId, but
  // this run still promoted reads onto the lineage — recognize it so its
  // candidate does not flip back to "candidate".
  return parsePromotedRuns(read.pipelineSources).includes(run.id);
}

async function getPipelineRun(runId: string): Promise<RunRecord | null> {
  return db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      runNumber: true,
      pipelineId: true,
      status: true,
      runFolder: true,
      orderId: true,
      targetType: true,
      results: true,
      artifacts: {
        select: {
          id: true,
          name: true,
          path: true,
          sampleId: true,
          outputId: true,
          metadata: true,
        },
        orderBy: { createdAt: "asc" },
      },
      order: {
        select: {
          id: true,
          samples: {
            select: {
              id: true,
              sampleId: true,
              reads: {
                select: {
                  id: true,
                  file1: true,
                  file2: true,
                  dataClass: true,
                  isActive: true,
                  pipelineRunId: true,
                  pipelineSources: true,
                },
                orderBy: [{ isActive: "desc" }, { dataClass: "asc" }, { id: "asc" }],
              },
            },
            orderBy: { sampleId: "asc" },
          },
        },
      },
    },
  }) as Promise<RunRecord | null>;
}

function assertOrderRun(run: RunRecord | null): asserts run is OrderRunRecord {
  if (!run) {
    throw new Error("Pipeline run not found");
  }
  if (run.targetType !== "order" || !run.orderId || !run.order) {
    throw new Error("Pending read promotion requires an order-scoped run");
  }
}

function prettifyId(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getCandidateOutputs(pipelineId: string): Map<string, CandidateOutput> {
  const pkg = getPackage(pipelineId);
  const outputs = pkg?.manifest.outputs ?? [];
  const definitionOutputs = new Map(
    (pkg?.definition.outputs ?? []).map((output) => [output.id, output])
  );
  const result = new Map<string, CandidateOutput>();

  for (const output of outputs) {
    const contract = inferPipelineResultContract(output);
    if (contract.kind !== PENDING_READ_CANDIDATE_KIND) continue;
    result.set(output.id, {
      id: output.id,
      label:
        contract.preview?.label ||
        definitionOutputs.get(output.id)?.name ||
        prettifyId(output.id),
    });
  }

  return result;
}

function buildReviewCopy(): PendingWritebackReviewCopy {
  return {
    title: "Review pending read outputs",
    description:
      "Select staged read candidates that should become active reads for this order. Existing raw or unknown reads are preserved.",
    candidateCountLabel: "candidate",
    emptyText: "No pending read candidates were discovered for this run.",
    promoteButtonLabel: "Set as active reads",
    confirmTitle: "Set as active reads",
    confirmDescription:
      "This will change which read files SeqDesk uses for delivery and downstream pipelines. Existing raw or unknown reads will be preserved. Existing active cleaned reads will be superseded, not deleted.",
    reviewedLabel: "I reviewed the reports and want to use these read candidates.",
  };
}

export async function listPendingWritebacks(
  runId: string
): Promise<PendingWritebackSummary> {
  const run = await getPipelineRun(runId);
  assertOrderRun(run);

  const candidateOutputs = getCandidateOutputs(run.pipelineId);
  const sampleById = new Map(run.order.samples.map((sample) => [sample.id, sample]));
  const readCandidates: PendingReadCandidate[] = [];
  const reports: PendingWritebackReportFile[] = [];

  for (const artifact of run.artifacts) {
    const candidateOutput = artifact.outputId ? candidateOutputs.get(artifact.outputId) : null;
    if (candidateOutput && artifact.sampleId) {
      const sample = sampleById.get(artifact.sampleId);
      if (!sample) continue;
      const metadata = parseMetadata(artifact.metadata);
      const file1 = getString(metadata.sourceFile1) || artifact.path;
      const file2 = getString(metadata.sourceFile2);
      const targetDataClass = resolveCandidateDataClass(metadata.dataClass);
      const currentRead = getActiveRead(sample, targetDataClass);
      const dataClass = normalizeReadDataClass(currentRead?.dataClass);

      readCandidates.push({
        artifactId: artifact.id,
        outputId: artifact.outputId,
        outputLabel: candidateOutput.label,
        sampleId: sample.id,
        sampleCode: sample.sampleId,
        file1,
        file2,
        readLayout: getReadLayout(metadata.readLayout),
        targetDataClass,
        status: isReadPromotedFromRun(currentRead, run, targetDataClass)
          ? "promoted"
          : "candidate",
        metadata,
        currentRead: currentRead
          ? {
              id: currentRead.id,
              file1: currentRead.file1,
              file2: currentRead.file2,
              dataClass,
              dataClassLabel: READ_DATA_CLASS_LABELS[dataClass],
              isProtectedRaw: isProtectedReadDataClass(dataClass),
            }
          : null,
      });
      continue;
    }

    if (!artifact.sampleId && !candidateOutput) {
      reports.push({
        id: artifact.id,
        name: artifact.name || path.basename(artifact.path),
        path: artifact.path,
        outputId: artifact.outputId,
      });
    }
  }

  return {
    run: {
      id: run.id,
      runNumber: run.runNumber,
      pipelineId: run.pipelineId,
      status: run.status,
      orderId: run.orderId,
    },
    readCandidates,
    reports,
    review: buildReviewCopy(),
  };
}

function assertSourceInsideRun(runFolder: string | null, sourcePath: string): void {
  if (!runFolder) {
    throw new Error("Run folder is not available");
  }
  const resolvedRunFolder = path.resolve(runFolder);
  const resolvedSource = path.resolve(sourcePath);
  if (
    resolvedSource !== resolvedRunFolder &&
    !resolvedSource.startsWith(`${resolvedRunFolder}${path.sep}`)
  ) {
    throw new Error(`Read candidate is outside the run folder: ${sourcePath}`);
  }
}

function safeSegment(value: string): string {
  return sanitizeSequencingFilename(value).replace(/\.+$/g, "") || "item";
}

function buildPromotedReadPath(args: {
  pipelineId: string;
  orderId: string;
  runNumber: string;
  sampleCode: string;
  outputId: string | null;
  sourcePath: string;
  role: "R1" | "R2";
}): string {
  return path.join(
    "_pipeline",
    "orders",
    safeSegment(args.orderId),
    safeSegment(args.pipelineId),
    safeSegment(args.runNumber),
    safeSegment(args.sampleCode),
    safeSegment(args.outputId || "output"),
    `${args.role}-${sanitizeSequencingFilename(path.basename(args.sourcePath))}`
  );
}

async function copyCandidateFile(args: {
  dataBasePath: string;
  pipelineId: string;
  orderId: string;
  runNumber: string;
  sampleCode: string;
  outputId: string | null;
  sourcePath: string;
  role: "R1" | "R2";
}): Promise<{ relativePath: string; checksum: string; reads: number | null }> {
  const relativePath = buildPromotedReadPath(args);
  const absoluteTarget = ensureWithinBase(args.dataBasePath, relativePath);
  await fs.mkdir(path.dirname(absoluteTarget), { recursive: true });
  await fs.copyFile(args.sourcePath, absoluteTarget);
  const checksum = await calculateMd5ForRelativePath(args.dataBasePath, relativePath);
  const stats = await countFastqStats(absoluteTarget);
  return {
    relativePath,
    checksum,
    reads: stats?.reads ?? null,
  };
}

/**
 * Recompute and persist the remaining pending-writeback count from the LIVE
 * candidate rows, atomically.
 *
 * This must not be a read-modify-write of a stale in-memory results blob: a
 * concurrent promotion (or a concurrent re-resolution touching sibling result
 * fields) would be clobbered, and the count would drift. Instead we:
 *   1. open a transaction and re-read the run's results inside it,
 *   2. count, from the live DB, how many of this run's read candidates are
 *      still un-promoted (no active Read promoted from this run for that
 *      sample + target data class),
 *   3. merge ONLY the pendingWritebacks key back into the freshly-read blob.
 *
 * candidates is the full candidate set for the run (status as observed before
 * promotion); we re-derive promotion state from the DB so the written count
 * reflects every promotion that has committed, not just this caller's.
 */
async function persistPendingWritebackCount(
  run: Pick<RunRecord, "id" | "pipelineId">,
  candidates: Array<Pick<PendingReadCandidate, "sampleId" | "targetDataClass">>
): Promise<void> {
  await db.$transaction(async (tx) => {
    const remaining = await countRemainingCandidates(tx, run, candidates);

    const fresh = await tx.pipelineRun.findUnique({
      where: { id: run.id },
      select: { results: true },
    });
    const results = parseMetadata(fresh?.results ?? null);
    if (results.pendingWritebacks === remaining) return;
    results.pendingWritebacks = remaining;

    await tx.pipelineRun.update({
      where: { id: run.id },
      data: { results: JSON.stringify(results) },
    });
  });
}

type WritebackTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Count how many of the run's read candidates are still un-promoted, reading
 * the live Read rows inside the given transaction. A candidate is "promoted"
 * once an active Read for its sample + target data class carries this run's id
 * in pipelineRunId or in pipelineSources[run.pipelineId].
 */
async function countRemainingCandidates(
  tx: WritebackTx,
  run: Pick<RunRecord, "id" | "pipelineId">,
  candidates: Array<Pick<PendingReadCandidate, "sampleId" | "targetDataClass">>
): Promise<number> {
  let remaining = 0;
  for (const candidate of candidates) {
    const promoted = await tx.read.findFirst({
      where: {
        sampleId: candidate.sampleId,
        dataClass: candidate.targetDataClass,
        isActive: true,
        OR: [
          { pipelineRunId: run.id },
          { pipelineSources: { contains: `"${run.pipelineId}":"${run.id}"` } },
        ],
      },
      select: { id: true },
    });
    if (!promoted) remaining += 1;
  }
  return remaining;
}

export async function promotePendingWritebacks(args: {
  runId: string;
  sampleIds?: string[];
  userId?: string | null;
}): Promise<PromotePendingWritebacksResult> {
  const run = await getPipelineRun(args.runId);
  assertOrderRun(run);

  if (run.status !== "completed") {
    throw new Error("Only completed pipeline runs can be promoted");
  }

  const summary = await listPendingWritebacks(args.runId);
  const selectedSampleIds = new Set(args.sampleIds || []);
  const candidates = summary.readCandidates.filter((candidate) => {
    if (candidate.status === "promoted") return false;
    return selectedSampleIds.size === 0 || selectedSampleIds.has(candidate.sampleId);
  });

  if (candidates.length === 0) {
    throw new Error("No pending read candidates selected for promotion");
  }

  const resolvedDataBasePath = await getResolvedDataBasePath();
  if (!resolvedDataBasePath.dataBasePath) {
    throw new Error("Data base path is not configured");
  }

  const sampleById = new Map(run.order.samples.map((sample) => [sample.id, sample]));
  const promotedReadIds: string[] = [];

  for (const candidate of candidates) {
    const sample = sampleById.get(candidate.sampleId);
    if (!sample) {
      throw new Error(`Sample ${candidate.sampleCode} is no longer part of the order`);
    }

    assertSourceInsideRun(run.runFolder, candidate.file1);
    if (candidate.file2) {
      assertSourceInsideRun(run.runFolder, candidate.file2);
    }

    const copied1 = await copyCandidateFile({
      dataBasePath: resolvedDataBasePath.dataBasePath,
      pipelineId: run.pipelineId,
      orderId: run.orderId,
      runNumber: run.runNumber,
      sampleCode: candidate.sampleCode,
      outputId: candidate.outputId,
      sourcePath: candidate.file1,
      role: "R1",
    });
    const copied2 = candidate.file2
      ? await copyCandidateFile({
          dataBasePath: resolvedDataBasePath.dataBasePath,
          pipelineId: run.pipelineId,
          orderId: run.orderId,
          runNumber: run.runNumber,
          sampleCode: candidate.sampleCode,
          outputId: candidate.outputId,
          sourcePath: candidate.file2,
          role: "R2",
        })
      : null;
    const activeRead = getActiveRead(sample, candidate.targetDataClass);
    const pipelineSources = mergePipelineSources(
      activeRead?.pipelineSources,
      run.pipelineId,
      run.id
    );
    const dataClassLabel = READ_DATA_CLASS_LABELS[candidate.targetDataClass].toLowerCase();

    const newRead = await db.$transaction(async (tx) => {
      // Re-check for an existing read promoted from this run inside the
      // transaction. The candidate-vs-promoted decision was made from a snapshot
      // read before the transaction, so a concurrent promotion (double-submit) can
      // pass the same filter; without this guard both would create a duplicate
      // active read for the sample, leaving orphaned superseded reads and copied
      // FASTQ files.
      const alreadyPromoted = await tx.read.findFirst({
        where: {
          sampleId: sample.id,
          dataClass: candidate.targetDataClass,
          pipelineRunId: run.id,
        },
        select: { id: true },
      });
      if (alreadyPromoted) {
        return null;
      }

      const created = await tx.read.create({
        data: {
          sampleId: sample.id,
          file1: copied1.relativePath,
          file2: copied2?.relativePath ?? null,
          checksum1: copied1.checksum,
          checksum2: copied2?.checksum ?? null,
          readCount1: copied1.reads,
          readCount2: copied2?.reads ?? null,
          pipelineRunId: run.id,
          pipelineSources,
          dataClass: candidate.targetDataClass,
          dataClassSource: "pipeline",
          isActive: false,
          classifiedAt: new Date(),
          classifiedById: args.userId ?? null,
          classificationNote: `Promoted ${dataClassLabel} reads from ${run.runNumber}`,
        },
      });

      // The promoted read becomes the sample's single active read. A sample may
      // have at most one active read (the Read_one_active_per_sample partial
      // unique index), so EVERY currently-active read must be deactivated here —
      // including a protected raw/unknown read. "Preserved" means the raw row is
      // kept (never deleted) and linked via supersededByReadId for provenance,
      // not that it stays active; activating the cleaned read while the raw read
      // were still active would violate the unique index (P2002).
      await tx.read.updateMany({
        where: {
          sampleId: sample.id,
          isActive: true,
        },
        data: {
          isActive: false,
          supersededByReadId: created.id,
        },
      });

      await tx.read.update({
        where: { id: created.id },
        data: { isActive: true },
      });

      return created;
    });

    // A concurrent promotion already created the read for this run+sample; skip
    // to avoid duplicate active reads.
    if (!newRead) {
      continue;
    }

    promotedReadIds.push(newRead.id);

    // Keep the in-memory snapshot consistent so additional candidates for the same
    // sample observe the freshly promoted active read (correct provenance + supersession).
    for (const read of sample.reads) {
      read.isActive = false;
    }
    sample.reads.unshift({
      id: newRead.id,
      file1: copied1.relativePath,
      file2: copied2?.relativePath ?? null,
      dataClass: candidate.targetDataClass,
      isActive: true,
      pipelineRunId: run.id,
      pipelineSources,
    });
  }

  // Refresh the denormalized pending-writeback count so run badges/actions stop
  // advertising candidates that have now been promoted. The count is recomputed
  // atomically from the live promoted-read rows inside persistPendingWritebackCount,
  // so concurrent promotions cannot clobber each other's count or sibling fields.
  await persistPendingWritebackCount(run, summary.readCandidates);

  return {
    promoted: promotedReadIds.length,
    readIds: promotedReadIds,
  };
}
