import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import {
  calculateMd5ForRelativePath,
  sanitizeSequencingFilename,
} from "@/lib/sequencing/storage";
import { countFastqStats } from "@/lib/sequencing/fastq-stats";
import {
  READ_DATA_CLASS_LABELS,
  isProtectedReadDataClass,
  normalizeReadDataClass,
} from "@/lib/sequencing/constants";
import { READ_CLEANING_PIPELINE_ID } from "@/lib/pipelines/simulate-reads-config";

export const READ_CLEANING_CANDIDATE_OUTPUT_ID = "cleaned_read_candidates";

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
  artifacts: ArtifactRecord[];
  order: {
    id: string;
    samples: SampleRecord[];
  } | null;
};

type ReadCleaningRunRecord = RunRecord & {
  orderId: string;
  targetType: "order";
  order: NonNullable<RunRecord["order"]>;
};

export type ReadCleaningCandidateStatus = "candidate" | "promoted";

export interface ReadCleaningCandidate {
  artifactId: string;
  sampleId: string;
  sampleCode: string;
  file1: string;
  file2: string | null;
  readLayout: "single" | "paired" | "long" | "unknown";
  status: ReadCleaningCandidateStatus;
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

export interface ReadCleaningReportFile {
  id: string;
  name: string;
  path: string;
  outputId: string | null;
}

export interface ReadCleaningCandidateSummary {
  run: {
    id: string;
    runNumber: string;
    status: string;
    orderId: string | null;
  };
  candidates: ReadCleaningCandidate[];
  reports: ReadCleaningReportFile[];
}

export interface PromoteReadCleaningCandidatesResult {
  promoted: number;
  readIds: string[];
}

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

function getReadLayout(value: unknown): ReadCleaningCandidate["readLayout"] {
  return value === "single" || value === "paired" || value === "long"
    ? value
    : "unknown";
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

function mergePipelineSources(
  existing: string | null | undefined,
  runId: string
): string {
  return JSON.stringify({
    ...parsePipelineSources(existing),
    [READ_CLEANING_PIPELINE_ID]: runId,
  });
}

function getActiveRead(sample: SampleRecord): ReadRecord | null {
  return (
    sample.reads.find((read) => read.isActive !== false && read.file1 && read.dataClass === "cleaned") ||
    sample.reads.find((read) => read.isActive !== false && read.file1) ||
    null
  );
}

function isReadPromotedFromRun(read: ReadRecord | null, runId: string): boolean {
  if (!read) return false;
  if (normalizeReadDataClass(read.dataClass) !== "cleaned") return false;
  if (read.pipelineRunId === runId) return true;
  return parsePipelineSources(read.pipelineSources)[READ_CLEANING_PIPELINE_ID] === runId;
}

async function getReadCleaningRun(runId: string): Promise<RunRecord | null> {
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

function assertReadCleaningRun(
  run: RunRecord | null
): asserts run is ReadCleaningRunRecord {
  if (!run) {
    throw new Error("Pipeline run not found");
  }
  if (run.pipelineId !== READ_CLEANING_PIPELINE_ID) {
    throw new Error("Pipeline run is not a read-cleaning run");
  }
  if (run.targetType !== "order" || !run.orderId || !run.order) {
    throw new Error("Read-cleaning promotion requires an order-scoped run");
  }
}

export async function listReadCleaningCandidates(
  runId: string
): Promise<ReadCleaningCandidateSummary> {
  const run = await getReadCleaningRun(runId);
  assertReadCleaningRun(run);

  const sampleById = new Map(run.order.samples.map((sample) => [sample.id, sample]));
  const candidates: ReadCleaningCandidate[] = [];
  const reports: ReadCleaningReportFile[] = [];

  for (const artifact of run.artifacts) {
    if (artifact.outputId === READ_CLEANING_CANDIDATE_OUTPUT_ID && artifact.sampleId) {
      const sample = sampleById.get(artifact.sampleId);
      if (!sample) continue;
      const metadata = parseMetadata(artifact.metadata);
      const file1 = getString(metadata.sourceFile1) || artifact.path;
      const file2 = getString(metadata.sourceFile2);
      const currentRead = getActiveRead(sample);
      const dataClass = normalizeReadDataClass(currentRead?.dataClass);

      candidates.push({
        artifactId: artifact.id,
        sampleId: sample.id,
        sampleCode: sample.sampleId,
        file1,
        file2,
        readLayout: getReadLayout(metadata.readLayout),
        status: isReadPromotedFromRun(currentRead, run.id) ? "promoted" : "candidate",
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

    if (!artifact.sampleId && artifact.outputId !== READ_CLEANING_CANDIDATE_OUTPUT_ID) {
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
      status: run.status,
      orderId: run.orderId,
    },
    candidates,
    reports,
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
    throw new Error(`Cleaned read candidate is outside the run folder: ${sourcePath}`);
  }
}

function safeSegment(value: string): string {
  return sanitizeSequencingFilename(value).replace(/\.+$/g, "") || "item";
}

function buildPromotedReadPath(args: {
  orderId: string;
  runNumber: string;
  sampleCode: string;
  sourcePath: string;
  role: "R1" | "R2";
}): string {
  return path.join(
    "_pipeline",
    "orders",
    safeSegment(args.orderId),
    "read-cleaning",
    safeSegment(args.runNumber),
    safeSegment(args.sampleCode),
    `${args.role}-${sanitizeSequencingFilename(path.basename(args.sourcePath))}`
  );
}

async function copyCandidateFile(args: {
  dataBasePath: string;
  orderId: string;
  runNumber: string;
  sampleCode: string;
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

export async function promoteReadCleaningCandidates(args: {
  runId: string;
  sampleIds?: string[];
  userId?: string | null;
}): Promise<PromoteReadCleaningCandidatesResult> {
  const run = await getReadCleaningRun(args.runId);
  assertReadCleaningRun(run);

  if (run.status !== "completed") {
    throw new Error("Only completed read-cleaning runs can be promoted");
  }

  const summary = await listReadCleaningCandidates(args.runId);
  const selectedSampleIds = new Set(args.sampleIds || []);
  const candidates = summary.candidates.filter((candidate) => {
    if (candidate.status === "promoted") return false;
    return selectedSampleIds.size === 0 || selectedSampleIds.has(candidate.sampleId);
  });

  if (candidates.length === 0) {
    throw new Error("No cleaned read candidates selected for promotion");
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
      orderId: run.orderId!,
      runNumber: run.runNumber,
      sampleCode: candidate.sampleCode,
      sourcePath: candidate.file1,
      role: "R1",
    });
    const copied2 = candidate.file2
      ? await copyCandidateFile({
          dataBasePath: resolvedDataBasePath.dataBasePath,
          orderId: run.orderId!,
          runNumber: run.runNumber,
          sampleCode: candidate.sampleCode,
          sourcePath: candidate.file2,
          role: "R2",
        })
      : null;
    const activeRead = getActiveRead(sample);
    const pipelineSources = mergePipelineSources(activeRead?.pipelineSources, run.id);

    const newRead = await db.$transaction(async (tx) => {
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
          dataClass: "cleaned",
          dataClassSource: "pipeline",
          isActive: false,
          classifiedAt: new Date(),
          classifiedById: args.userId ?? null,
          classificationNote: `Promoted cleaned reads from ${run.runNumber}`,
        },
      });

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

    promotedReadIds.push(newRead.id);
  }

  return {
    promoted: promotedReadIds.length,
    readIds: promotedReadIds,
  };
}
