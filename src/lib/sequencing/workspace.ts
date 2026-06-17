import { stat } from "fs/promises";
import * as path from "path";
import { Prisma } from "@prisma/client";
import {
  checkFileExists,
  ensureWithinBase,
  findFilesForSample,
  matchPairedEndFiles,
  hasAllowedExtension,
  scanDirectoryWithReport,
  safeJoin,
  toRelativePath,
  validateFilePair,
  type FileInfo,
  type FileMatchSuggestion,
} from "@/lib/files";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { db } from "@/lib/db";
import { checkAndCompleteOrder } from "@/lib/orders/auto-complete";
import {
  FILES_ASSIGNABLE_STATUSES,
  READ_DATA_CLASS_LABELS,
  READ_ORIGIN_LABELS,
  getSequencingIntegrityStatus,
  isProtectedReadDataClass,
  isFacilitySampleStatus,
  normalizeReadDataClass,
  normalizeReadDataClassSource,
  type ReadOrigin,
  type ReadDataClass,
  type ReadDataClassSource,
} from "./constants";
import {
  buildSequencingArtifactUploadRelativePath,
  buildSequencingReadUploadRelativePath,
  buildSequencingUploadTempRelativePath,
  calculateMd5ForRelativePath,
  finalizeSequencingUpload,
  removeSequencingRelativePath,
  statSequencingRelativePath,
  writeSequencingUploadChunk,
} from "./storage";
import { normalizeBarcode } from "./run-plan";
import type {
  OrderSequencingSummaryResponse,
  SequencingArtifactSummary,
  SequencingChecksumSummary,
  SequencingDiscoveryResult,
  SequencingDiscoveryScanWarnings,
  SequencingPlannedBarcodeSource,
  SequencingRunSummary,
  SequencingTechSelectionSummary,
  SequencingSampleRow,
  SequencingStatusCounts,
} from "./types";

type UploadMetadata = {
  stage?: string;
  artifactType?: string;
  visibility?: string;
  sequencingRunId?: string | null;
  source?: string;
  dataClass?: ReadDataClass;
};

const DEFAULT_STATUS_COUNTS: SequencingStatusCounts = {
  WAITING: 0,
  PROCESSING: 0,
  SEQUENCED: 0,
  QC_REVIEW: 0,
  READY: 0,
  ISSUE: 0,
};
const DISCOVERY_MAX_FILES = 10_000;

const ORDER_WITH_SEQUENCING_SELECT = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  name: true,
  status: true,
  userId: true,
  customFields: true,
  samples: {
    orderBy: { sampleId: "asc" },
    select: {
      id: true,
      sampleId: true,
      sampleAlias: true,
      sampleTitle: true,
      customFields: true,
      facilityStatus: true,
      facilityStatusUpdatedAt: true,
      updatedAt: true,
      reads: {
        orderBy: [
          { isActive: "desc" },
          { id: "desc" },
        ],
        select: {
          id: true,
          file1: true,
          file2: true,
          checksum1: true,
          checksum2: true,
          readCount1: true,
          readCount2: true,
          avgQuality1: true,
          avgQuality2: true,
          fastqcReport1: true,
          fastqcReport2: true,
          pipelineRunId: true,
          pipelineSources: true,
          dataClass: true,
          dataClassSource: true,
          isActive: true,
          supersededByReadId: true,
          classifiedAt: true,
          classifiedById: true,
          classificationNote: true,
          pipelineRun: {
            select: {
              runNumber: true,
            },
          },
          sequencingRun: {
            select: {
              id: true,
              runId: true,
              runName: true,
            },
          },
        },
      },
      sequencingRunSamples: {
        orderBy: { updatedAt: "desc" },
        select: {
          barcode: true,
          sequencingRun: {
            select: {
              id: true,
              runId: true,
              runName: true,
            },
          },
        },
      },
      sequencingArtifacts: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          orderId: true,
          sampleId: true,
          sequencingRunId: true,
          stage: true,
          artifactType: true,
          source: true,
          visibility: true,
          path: true,
          originalName: true,
          size: true,
          checksum: true,
          mimeType: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
  sequencingArtifacts: {
    where: { sampleId: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      orderId: true,
      sampleId: true,
      sequencingRunId: true,
      stage: true,
      artifactType: true,
      source: true,
      visibility: true,
      path: true,
      originalName: true,
      size: true,
      checksum: true,
      mimeType: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  },
});

type OrderWithSequencing = Prisma.OrderGetPayload<{
  select: typeof ORDER_WITH_SEQUENCING_SELECT;
}>;

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toSequencingTechSelectionSummary(
  customFields: string | null | undefined
): SequencingTechSelectionSummary | null {
  const selection = parseJsonObject(customFields)._sequencing_tech;
  if (!selection) return null;

  if (typeof selection === "string") {
    const value = selection.trim();
    return value ? { id: value, name: value, label: value, platform: value } : null;
  }

  if (typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }

  const record = selection as Record<string, unknown>;
  const id = toStringOrNull(record.technologyId) ?? toStringOrNull(record.id);
  const name = toStringOrNull(record.technologyName) ?? toStringOrNull(record.name);
  const platform = name ?? id;
  return id || name
    ? {
        id,
        name,
        label: name ?? id,
        platform,
      }
    : null;
}

function getLatestRunPlanBarcode(sample: NonNullable<OrderWithSequencing>["samples"][number]): {
  barcode: string | null;
  runId: string | null;
} {
  const assignment = (sample.sequencingRunSamples ?? []).find((item) =>
    Boolean(normalizeBarcode(item.barcode))
  );
  return {
    barcode: normalizeBarcode(assignment?.barcode),
    runId: assignment?.sequencingRun?.runId ?? null,
  };
}

function getSampleCustomBarcode(
  sample: NonNullable<OrderWithSequencing>["samples"][number]
): string | null {
  return normalizeBarcode(parseJsonObject(sample.customFields)._barcode);
}

function getPlannedBarcode(sample: NonNullable<OrderWithSequencing>["samples"][number]): {
  barcode: string | null;
  source: SequencingPlannedBarcodeSource;
  runId: string | null;
} {
  const runPlan = getLatestRunPlanBarcode(sample);
  if (runPlan.barcode) {
    return { barcode: runPlan.barcode, source: "run-plan", runId: runPlan.runId };
  }

  const sampleBarcode = getSampleCustomBarcode(sample);
  if (sampleBarcode) {
    return { barcode: sampleBarcode, source: "sample-barcode", runId: null };
  }

  return { barcode: null, source: null, runId: null };
}

function emptyFileSuggestion(): FileMatchSuggestion {
  return {
    status: "none",
    read1: null,
    read2: null,
    alternatives: [],
    confidence: 0,
    matchedBy: null,
  };
}

function filePathContainsBarcode(file: FileInfo, barcode: string): boolean {
  const normalizedBarcode = normalizeBarcode(barcode);
  if (!normalizedBarcode) return false;

  return file.relativePath
    .split(/[\\/]+/)
    .some((part) => normalizeBarcode(part) === normalizedBarcode);
}

function filePathContainsRunId(file: FileInfo, runId: string | null): boolean {
  const normalizedRunId = runId?.trim().toLowerCase();
  if (!normalizedRunId) return false;

  return file.relativePath
    .split(/[\\/]+/)
    .some((part) => {
      const normalizedPart = part.toLowerCase();
      return (
        normalizedPart === normalizedRunId ||
        (normalizedRunId.length >= 4 && normalizedPart.includes(normalizedRunId))
      );
    });
}

function findFilesForBarcode(
  barcode: string | null,
  files: FileInfo[],
  allowSingleEnd: boolean,
  runId: string | null = null
): FileMatchSuggestion {
  if (!barcode) return emptyFileSuggestion();

  const candidates = files.filter(
    (file) =>
      filePathContainsBarcode(file, barcode) &&
      (!runId || filePathContainsRunId(file, runId))
  );
  if (candidates.length === 0) return emptyFileSuggestion();

  const pairs = matchPairedEndFiles(candidates);
  if (pairs.length === 0) return emptyFileSuggestion();

  if (pairs.length === 1) {
    const pair = pairs[0];
    return {
      status: pair.isPaired || allowSingleEnd ? "exact" : "partial",
      read1: pair.read1,
      read2: pair.read2,
      alternatives: [],
      confidence: pair.isPaired ? 0.99 : 0.92,
      matchedBy: "barcode",
    };
  }

  return {
    status: "ambiguous",
    read1: null,
    read2: null,
    alternatives: pairs,
    confidence: 0.75,
    matchedBy: "barcode",
  };
}

function withDiscoveryMatchedBy(
  suggestion: FileMatchSuggestion,
  matchedBy: NonNullable<SequencingDiscoveryResult["suggestion"]["matchedBy"]>
): FileMatchSuggestion {
  return {
    ...suggestion,
    matchedBy,
  };
}

function findSequencingSuggestionForSample(
  sample: NonNullable<OrderWithSequencing>["samples"][number],
  files: FileInfo[],
  allowSingleEnd: boolean
): FileMatchSuggestion {
  const runPlan = getLatestRunPlanBarcode(sample);
  if (runPlan.barcode) {
    const suggestion = findFilesForBarcode(
      runPlan.barcode,
      files,
      allowSingleEnd,
      runPlan.runId
    );
    if (suggestion.status !== "none") {
      return withDiscoveryMatchedBy(suggestion, "run-plan-barcode");
    }
  }

  const sampleBarcode = getSampleCustomBarcode(sample);
  if (sampleBarcode) {
    const suggestion = findFilesForBarcode(sampleBarcode, files, allowSingleEnd);
    if (suggestion.status !== "none") {
      return withDiscoveryMatchedBy(suggestion, "sample-barcode");
    }
  }

  return withDiscoveryMatchedBy(
    findFilesForSample(
      {
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        sampleTitle: sample.sampleTitle,
      },
      files,
      allowSingleEnd
    ),
    "sample-id"
  );
}

async function loadOrderWithSequencing(orderId: string): Promise<OrderWithSequencing | null> {
  return db.order.findUnique({
    where: { id: orderId },
    select: ORDER_WITH_SEQUENCING_SELECT,
  });
}

function selectActiveRead(
  reads: NonNullable<OrderWithSequencing>["samples"][number]["reads"]
) {
  return (
    reads.find((read) => read.isActive !== false && read.dataClass === "cleaned" && (read.file1 || read.file2)) ||
    reads.find((read) => read.isActive !== false && (read.file1 || read.file2)) ||
    reads.find((read) => read.file1 || read.file2) ||
    reads[0] ||
    null
  );
}

function parsePipelineSources(value: string | null | undefined): Record<string, string> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

function deriveReadOrigin(
  dataClassSource: ReadDataClassSource,
  pipelineSources: Record<string, string> | null
): ReadOrigin {
  if (pipelineSources?.["simulate-reads"]) {
    return "simulated";
  }
  if (pipelineSources && Object.keys(pipelineSources).length > 0) {
    return "pipeline";
  }

  if (dataClassSource === "legacy_assumed_cleaned") {
    return "legacy";
  }

  return dataClassSource;
}

function toReadSummary(
  read: NonNullable<OrderWithSequencing>["samples"][number]["reads"][number],
  fileSize1: number | null = null,
  fileSize2: number | null = null
) {
  const dataClass = normalizeReadDataClass(read.dataClass);
  const dataClassSource = normalizeReadDataClassSource(
    read.dataClassSource,
    "legacy_assumed_cleaned"
  );
  const pipelineSources = parsePipelineSources(read.pipelineSources);
  const readOrigin = deriveReadOrigin(dataClassSource, pipelineSources);

  return {
    id: read.id,
    file1: read.file1,
    file2: read.file2,
    checksum1: read.checksum1,
    checksum2: read.checksum2,
    readCount1: read.readCount1,
    readCount2: read.readCount2,
    avgQuality1: read.avgQuality1,
    avgQuality2: read.avgQuality2,
    fileSize1,
    fileSize2,
    fastqcReport1: read.fastqcReport1,
    fastqcReport2: read.fastqcReport2,
    pipelineRunId: read.pipelineRunId,
    pipelineRunNumber: read.pipelineRun?.runNumber ?? null,
    pipelineSources,
    dataClass,
    dataClassLabel: READ_DATA_CLASS_LABELS[dataClass],
    dataClassSource,
    readOrigin,
    readOriginLabel: READ_ORIGIN_LABELS[readOrigin],
    isSimulated: readOrigin === "simulated",
    isProtectedRaw: isProtectedReadDataClass(dataClass),
    isActive: read.isActive !== false,
    supersededByReadId: read.supersededByReadId,
    classifiedAt: read.classifiedAt?.toISOString() ?? null,
    classifiedById: read.classifiedById,
    classificationNote: read.classificationNote,
    filesMissing: false,
  };
}

function assertManageableOrderStatus(status: string): void {
  if (!FILES_ASSIGNABLE_STATUSES.includes(status as (typeof FILES_ASSIGNABLE_STATUSES)[number])) {
    throw new Error("Sequencing data can only be managed on submitted or completed sequencing orders");
  }
}

function toSequencingRunSummary(
  sequencingRun: {
    id: string;
    runId: string;
    runName: string | null;
  } | null | undefined
): SequencingRunSummary | null {
  if (!sequencingRun) return null;
  return {
    id: sequencingRun.id,
    runId: sequencingRun.runId,
    runName: sequencingRun.runName,
  };
}

function toArtifactSummary(
  artifact: NonNullable<OrderWithSequencing>["sequencingArtifacts"][number]
): SequencingArtifactSummary {
  return {
    id: artifact.id,
    orderId: artifact.orderId,
    sampleId: artifact.sampleId,
    sequencingRunId: artifact.sequencingRunId,
    stage: artifact.stage,
    artifactType: artifact.artifactType,
    source: artifact.source,
    visibility: artifact.visibility,
    path: artifact.path,
    originalName: artifact.originalName,
    size: artifact.size === null ? null : Number(artifact.size),
    checksum: artifact.checksum,
    mimeType: artifact.mimeType,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

async function requireDataBasePath() {
  const { dataBasePath, config } = await getSequencingFilesConfig();
  if (!dataBasePath) {
    throw new Error("Data base path not configured");
  }
  return { dataBasePath, config };
}

function findOrderSample(
  order: NonNullable<OrderWithSequencing>,
  sampleIdentifier: string
) {
  return (
    order.samples.find((sample) => sample.id === sampleIdentifier) ||
    order.samples.find((sample) => sample.sampleId === sampleIdentifier)
  );
}

function normalizeReadPathInput(
  dataBasePath: string,
  value: string | null | undefined,
  allowedExtensions: string[]
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let relativePath = trimmed;
  if (path.isAbsolute(trimmed)) {
    relativePath = toRelativePath(dataBasePath, trimmed);
  } else {
    ensureWithinBase(dataBasePath, trimmed);
  }

  if (!relativePath || relativePath === ".") {
    throw new Error("Invalid file path");
  }

  if (!hasAllowedExtension(relativePath, allowedExtensions)) {
    throw new Error("File extension not allowed");
  }

  return relativePath;
}

function normalizeArtifactPathInput(
  dataBasePath: string,
  value: string
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("File path is required");
  }

  if (path.isAbsolute(trimmed)) {
    return toRelativePath(dataBasePath, trimmed);
  }

  ensureWithinBase(dataBasePath, trimmed);
  return trimmed;
}

function deriveStatusAfterReadsAssigned(currentStatus: string): string {
  if (currentStatus === "WAITING" || currentStatus === "PROCESSING") {
    return "SEQUENCED";
  }
  return currentStatus;
}

function deriveStatusAfterReadsCleared(currentStatus: string): string {
  if (currentStatus === "SEQUENCED") {
    return "WAITING";
  }
  return currentStatus;
}

async function updateSampleStatusAfterReadChange(
  sampleId: string,
  currentStatus: string,
  hasReads: boolean
) {
  const nextStatus = hasReads
    ? deriveStatusAfterReadsAssigned(currentStatus)
    : deriveStatusAfterReadsCleared(currentStatus);

  if (nextStatus !== currentStatus) {
    await db.sample.update({
      where: { id: sampleId },
      data: {
        facilityStatus: nextStatus,
        facilityStatusUpdatedAt: new Date(),
      },
    });
  }
}

export async function getOrderSequencingSummary(
  orderId: string
): Promise<OrderSequencingSummaryResponse> {
  const [order, configResult] = await Promise.all([
    loadOrderWithSequencing(orderId),
    getSequencingFilesConfig(),
  ]);

  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  // Aggregate stream-ingested files per sample so the response can advertise
  // streamed data alongside the existing Read-based files. We use a groupBy
  // for totals plus a separate query for the latest file timestamp per sample
  // (Prisma's groupBy doesn't return a per-group max in the same call).
  const sampleIds = order.samples.map((s) => s.id);
  const streamGroups = sampleIds.length
    ? await db.streamIngestedFile.groupBy({
        by: ["sampleId"],
        where: { sampleId: { in: sampleIds } },
        _count: { _all: true },
        _sum: { reads: true, bases: true },
        _max: { ingestedAt: true },
      })
    : [];
  // Find the most-recent ACTIVE stream run touching each sample, if any.
  const activeStreamBySample = sampleIds.length
    ? await db.streamIngestedFile.findMany({
        where: {
          sampleId: { in: sampleIds },
          streamRun: { status: "ACTIVE" },
        },
        distinct: ["sampleId"],
        orderBy: { ingestedAt: "desc" },
        select: { sampleId: true, streamRunId: true },
      })
    : [];
  const streamStatsBySampleId = new Map<
    string,
    {
      fileCount: number;
      totalReads: number;
      totalBases: number;
      lastFileAt: string | null;
      activeRunId: string | null;
    }
  >();
  for (const g of streamGroups) {
    if (!g.sampleId) continue;
    streamStatsBySampleId.set(g.sampleId, {
      fileCount: g._count._all,
      totalReads: g._sum.reads ?? 0,
      totalBases: Number(g._sum.bases ?? BigInt(0)),
      lastFileAt: g._max.ingestedAt ? g._max.ingestedAt.toISOString() : null,
      activeRunId: null,
    });
  }
  for (const a of activeStreamBySample) {
    if (!a.sampleId) continue;
    const cur = streamStatsBySampleId.get(a.sampleId);
    if (cur) cur.activeRunId = a.streamRunId;
  }

  const statusCounts: SequencingStatusCounts = { ...DEFAULT_STATUS_COUNTS };
  const rows: SequencingSampleRow[] = order.samples.map((sample) => {
    const read = selectActiveRead(sample.reads);
    const protectedProvenanceReads = sample.reads.filter(
      (item) => !item.isActive && isProtectedReadDataClass(item.dataClass) && (item.file1 || item.file2)
    );
    const artifacts = sample.sequencingArtifacts.map(toArtifactSummary);
    const plannedBarcode = getPlannedBarcode(sample);
    const integrityStatus = getSequencingIntegrityStatus({
      file1: read?.file1,
      file2: read?.file2,
      checksum1: read?.checksum1,
      checksum2: read?.checksum2,
    });
    const latestArtifact = sample.sequencingArtifacts[0] || null;
    const latestTimestamp = latestArtifact
      ? Math.max(
          latestArtifact.updatedAt.getTime(),
          sample.updatedAt.getTime(),
          sample.facilityStatusUpdatedAt?.getTime() ?? 0
        )
      : Math.max(
          sample.updatedAt.getTime(),
          sample.facilityStatusUpdatedAt?.getTime() ?? 0
        );

    if (isFacilitySampleStatus(sample.facilityStatus)) {
      statusCounts[sample.facilityStatus] += 1;
    }

    return {
      id: sample.id,
      sampleId: sample.sampleId,
      sampleAlias: sample.sampleAlias,
      sampleTitle: sample.sampleTitle,
      facilityStatus: sample.facilityStatus,
      facilityStatusUpdatedAt: sample.facilityStatusUpdatedAt?.toISOString() ?? null,
      updatedAt: new Date(latestTimestamp).toISOString(),
      read: read
        ? toReadSummary(read)
        : null,
      integrityStatus,
      hasReads: Boolean(read?.file1 || read?.file2),
      protectedProvenanceCount: protectedProvenanceReads.length,
      protectedProvenance: protectedProvenanceReads.map((item) => toReadSummary(item)),
      plannedBarcode: plannedBarcode.barcode,
      plannedBarcodeSource: plannedBarcode.source,
      plannedBarcodeRunId: plannedBarcode.runId,
      sequencingRun: toSequencingRunSummary(read?.sequencingRun),
      artifactCount: artifacts.length,
      qcArtifactCount: artifacts.filter((artifact) =>
        artifact.stage === "qc" ||
        artifact.artifactType === "qc_report" ||
        artifact.artifactType === "multiqc_report"
      ).length,
      latestArtifactStage: latestArtifact?.stage ?? null,
      artifacts,
      stream: streamStatsBySampleId.get(sample.id) ?? null,
    };
  });

  // Resolve file sizes in parallel for samples that have reads
  if (configResult.dataBasePath) {
    const basePath = configResult.dataBasePath;
    await Promise.all(
      rows.map(async (row) => {
        if (!row.read) return;
        const files = [
          { key: "fileSize1" as const, filePath: row.read.file1 },
          { key: "fileSize2" as const, filePath: row.read.file2 },
        ];
        let anyLinked = false;
        let anyMissing = false;
        await Promise.all(
          files.map(async ({ key, filePath }) => {
            if (!filePath || !row.read) return;
            anyLinked = true;
            try {
              const resolved = safeJoin(basePath, filePath);
              const stats = await stat(resolved);
              row.read[key] = stats.size;
            } catch {
              // File does not exist on disk
              anyMissing = true;
            }
          })
        );
        if (row.read) {
          row.read.filesMissing = anyLinked && anyMissing;
        }
      })
    );
  }

  return {
    orderId: order.id,
    orderName: order.name,
    orderStatus: order.status,
    canManage: FILES_ASSIGNABLE_STATUSES.includes(
      order.status as (typeof FILES_ASSIGNABLE_STATUSES)[number]
    ),
    dataBasePathConfigured: Boolean(configResult.dataBasePath),
    config: {
      allowedExtensions: configResult.config.allowedExtensions,
      allowSingleEnd: configResult.config.allowSingleEnd,
    },
    sequencingTechSelection: toSequencingTechSelectionSummary(order.customFields),
    summary: {
      totalSamples: rows.length,
      readsLinkedSamples: rows.filter((row) => row.hasReads).length,
      qcArtifactSamples: rows.filter(
        (row) =>
          row.qcArtifactCount > 0 ||
          Boolean(row.read?.fastqcReport1 || row.read?.fastqcReport2)
      ).length,
      missingChecksumSamples: rows.filter(
        (row) => row.integrityStatus === "missing" || row.integrityStatus === "partial"
      ).length,
      orderArtifactCount: order.sequencingArtifacts.length,
      statusCounts,
    },
    samples: rows,
    orderArtifacts: order.sequencingArtifacts.map(toArtifactSummary),
  };
}

export async function setOrderSequencingStatuses(
  orderId: string,
  updates: Array<{ sampleId: string; facilityStatus: string }>
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const now = new Date();
  const results: Array<{ sampleId: string; success: boolean; error?: string }> = [];

  for (const update of updates) {
    const sample = findOrderSample(order, update.sampleId);
    if (!sample) {
      results.push({ sampleId: update.sampleId, success: false, error: "Sample not found" });
      continue;
    }

    if (!isFacilitySampleStatus(update.facilityStatus)) {
      results.push({ sampleId: update.sampleId, success: false, error: "Invalid status" });
      continue;
    }

    await db.sample.update({
      where: { id: sample.id },
      data: {
        facilityStatus: update.facilityStatus,
        facilityStatusUpdatedAt: now,
      },
    });
    results.push({ sampleId: sample.sampleId, success: true });
  }

  return results;
}

export async function discoverOrderSequencingFiles(
  orderId: string,
  options: { autoAssign?: boolean; force?: boolean } = {}
): Promise<{
  scannedFiles: number;
  results: SequencingDiscoveryResult[];
  summary: {
    total: number;
    exactMatches: number;
    partialMatches: number;
    ambiguous: number;
    noMatch: number;
    autoAssigned: number;
  };
  scanWarnings: SequencingDiscoveryScanWarnings;
}> {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const { dataBasePath, config } = await requireDataBasePath();

  const scanReport = await scanDirectoryWithReport(
    dataBasePath,
    {
      allowedExtensions: config.allowedExtensions,
      maxDepth: config.scanDepth,
      ignorePatterns: config.ignorePatterns,
      maxFiles: DISCOVERY_MAX_FILES,
      activeWriteMinAgeMs: config.activeWriteMinAgeMs,
    },
    options.force ?? false
  );
  const files = scanReport.files;

  const results: SequencingDiscoveryResult[] = [];
  let autoAssigned = 0;

  for (const sample of order.samples) {
    const existingRead = selectActiveRead(sample.reads);
    const hasExistingAssignment = Boolean(existingRead?.file1 || existingRead?.file2);

    if (hasExistingAssignment && !options.force) {
      const plannedBarcode = getPlannedBarcode(sample);
      results.push({
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        plannedBarcode: plannedBarcode.barcode,
        plannedBarcodeSource: plannedBarcode.source,
        plannedBarcodeRunId: plannedBarcode.runId,
        suggestion: {
          status: "exact",
          read1: null,
          read2: null,
          confidence: 1,
          alternatives: [],
          matchedBy: null,
        },
        autoAssigned: false,
        dataClass: normalizeReadDataClass(existingRead?.dataClass),
        dataClassLabel: READ_DATA_CLASS_LABELS[normalizeReadDataClass(existingRead?.dataClass)],
        isProtectedRaw: isProtectedReadDataClass(existingRead?.dataClass),
      });
      continue;
    }

    const plannedBarcode = getPlannedBarcode(sample);
    const suggestion = findSequencingSuggestionForSample(
      sample,
      files,
      config.allowSingleEnd
    );

    const cleanSuggestion = toDiscoverySuggestion(suggestion);
    let wasAutoAssigned = false;

    const shouldAutoAssign =
      (options.autoAssign ?? config.autoAssign) &&
      suggestion.status === "exact" &&
      suggestion.confidence >= 0.9 &&
      suggestion.read1;

    if (shouldAutoAssign && suggestion.read1) {
      await upsertSampleReadAssignment(
        sample.id,
        sample.sampleId,
        sample.facilityStatus,
        existingRead?.id ?? null,
        suggestion.read1.relativePath,
        suggestion.read2?.relativePath || null,
        {
          dataClass: "cleaned",
          dataClassSource: "associate",
          existingDataClass: existingRead?.dataClass,
          existingFile1: existingRead?.file1,
          existingFile2: existingRead?.file2,
        }
      );
      wasAutoAssigned = true;
      autoAssigned += 1;
    }

    results.push({
      sampleId: sample.sampleId,
      sampleAlias: sample.sampleAlias,
      plannedBarcode: plannedBarcode.barcode,
      plannedBarcodeSource: plannedBarcode.source,
      plannedBarcodeRunId: plannedBarcode.runId,
      suggestion: cleanSuggestion,
      autoAssigned: wasAutoAssigned,
      dataClass: "cleaned",
      dataClassLabel: READ_DATA_CLASS_LABELS.cleaned,
      isProtectedRaw: false,
    });
  }

  return {
    scannedFiles: files.length,
    results,
    summary: {
      total: results.length,
      exactMatches: results.filter((item) => item.suggestion.status === "exact").length,
      partialMatches: results.filter((item) => item.suggestion.status === "partial").length,
      ambiguous: results.filter((item) => item.suggestion.status === "ambiguous").length,
      noMatch: results.filter((item) => item.suggestion.status === "none").length,
      autoAssigned,
    },
    scanWarnings: scanReport.warnings,
  };
}

function toDiscoverySuggestion(
  suggestion: FileMatchSuggestion
): SequencingDiscoveryResult["suggestion"] {
  return {
    status: suggestion.status,
    read1: suggestion.read1
      ? {
          relativePath: suggestion.read1.relativePath,
          filename: suggestion.read1.filename,
        }
      : null,
    read2: suggestion.read2
      ? {
          relativePath: suggestion.read2.relativePath,
          filename: suggestion.read2.filename,
        }
      : null,
    confidence: suggestion.confidence,
    matchedBy:
      suggestion.matchedBy === "run-plan-barcode" ||
      suggestion.matchedBy === "sample-barcode" ||
      suggestion.matchedBy === "sample-id"
        ? suggestion.matchedBy
        : null,
    alternatives: suggestion.alternatives.map((alternative) => ({
      identifier: alternative.identifier,
      read1: {
        relativePath: alternative.read1.relativePath,
        filename: alternative.read1.filename,
      },
      read2: alternative.read2
        ? {
            relativePath: alternative.read2.relativePath,
            filename: alternative.read2.filename,
          }
        : null,
    })),
  };
}

async function upsertSampleReadAssignment(
  sampleRecordId: string,
  sampleIdentifier: string,
  currentStatus: string,
  existingReadId: string | null,
  file1: string | null,
  file2: string | null,
  options?: {
    checksum1?: string | null;
    checksum2?: string | null;
    sequencingRunId?: string | null;
    dataClass?: ReadDataClass;
    dataClassSource?: ReadDataClassSource;
    classifiedById?: string | null;
    classificationNote?: string | null;
    existingDataClass?: string | null;
    existingFile1?: string | null;
    existingFile2?: string | null;
  }
) {
  const dataClass = normalizeReadDataClass(options?.dataClass);
  const dataClassSource = normalizeReadDataClassSource(options?.dataClassSource, "associate");
  const classificationData = {
    dataClass,
    dataClassSource,
    classifiedAt: new Date(),
    classifiedById: options?.classifiedById ?? null,
    classificationNote: options?.classificationNote ?? null,
  };

  if (existingReadId) {
    const preserveProtectedSource =
      isProtectedReadDataClass(options?.existingDataClass) &&
      dataClass === "cleaned" &&
      Boolean(file1 || file2) &&
      (options?.existingFile1 !== file1 || options?.existingFile2 !== file2);

    if (preserveProtectedSource) {
      await db.$transaction(async (tx) => {
        const newRead = await tx.read.create({
          data: {
            sampleId: sampleRecordId,
            file1,
            file2,
            checksum1: options?.checksum1 ?? null,
            checksum2: options?.checksum2 ?? null,
            sequencingRunId: options?.sequencingRunId ?? null,
            pipelineRunId: null,
            pipelineSources: null,
            isActive: false,
            ...classificationData,
          },
        });

        await tx.read.update({
          where: { id: existingReadId },
          data: {
            isActive: false,
            supersededByReadId: newRead.id,
          },
        });

        await tx.read.update({
          where: { id: newRead.id },
          data: { isActive: true },
        });
      });
    } else {
      await db.read.update({
        where: { id: existingReadId },
        data: {
          file1,
          file2,
          checksum1: options?.checksum1 ?? undefined,
          checksum2: options?.checksum2 ?? undefined,
          sequencingRunId: options?.sequencingRunId ?? undefined,
          pipelineRunId: null,
          pipelineSources: null,
          isActive: true,
          supersededByReadId: null,
          ...classificationData,
        },
      });
    }
  } else if (file1 || file2) {
    await db.read.create({
      data: {
        sampleId: sampleRecordId,
        file1,
        file2,
        checksum1: options?.checksum1 ?? null,
        checksum2: options?.checksum2 ?? null,
        sequencingRunId: options?.sequencingRunId ?? null,
        pipelineRunId: null,
        pipelineSources: null,
        isActive: true,
        ...classificationData,
      },
    });
  }

  await updateSampleStatusAfterReadChange(sampleRecordId, currentStatus, Boolean(file1 || file2));
  void sampleIdentifier;
}

export async function assignOrderSequencingReads(
  orderId: string,
  assignments: Array<{
    sampleId: string;
    read1: string | null;
    read2: string | null;
    checksum1?: string | null;
    checksum2?: string | null;
    sequencingRunId?: string | null;
    dataClass?: ReadDataClass;
    classificationNote?: string | null;
  }>
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const { dataBasePath, config } = await requireDataBasePath();

  const results: Array<{ sampleId: string; success: boolean; error?: string }> = [];

  for (const assignment of assignments) {
    const sample = findOrderSample(order, assignment.sampleId);
    if (!sample) {
      results.push({ sampleId: assignment.sampleId, success: false, error: "Sample not found" });
      continue;
    }

    let read1: string | null;
    let read2: string | null;
    try {
      read1 = normalizeReadPathInput(dataBasePath, assignment.read1, config.allowedExtensions);
      read2 = normalizeReadPathInput(dataBasePath, assignment.read2, config.allowedExtensions);
    } catch (error) {
      results.push({
        sampleId: sample.sampleId,
        success: false,
        error: error instanceof Error ? error.message : "Invalid file path",
      });
      continue;
    }

    const validation = validateFilePair(read1, read2, config.allowSingleEnd);
    if (!validation.valid) {
      results.push({
        sampleId: sample.sampleId,
        success: false,
        error: validation.errors.join(" "),
      });
      continue;
    }

    if (read1) {
      const exists = await checkFileExists(dataBasePath, read1);
      if (!exists) {
        results.push({ sampleId: sample.sampleId, success: false, error: "Read 1 file not found" });
        continue;
      }
    }
    if (read2) {
      const exists = await checkFileExists(dataBasePath, read2);
      if (!exists) {
        results.push({ sampleId: sample.sampleId, success: false, error: "Read 2 file not found" });
        continue;
      }
    }

    const existingRead = selectActiveRead(sample.reads);

    if (!read1 && !read2) {
      if (existingRead) {
        await db.read.update({
          where: { id: existingRead.id },
          data: {
            file1: null,
            file2: null,
            checksum1: null,
            checksum2: null,
            sequencingRunId: null,
            pipelineRunId: null,
            pipelineSources: null,
          },
        });
      }
      await updateSampleStatusAfterReadChange(sample.id, sample.facilityStatus, false);
      results.push({ sampleId: sample.sampleId, success: true });
      continue;
    }

    await upsertSampleReadAssignment(
      sample.id,
      sample.sampleId,
      sample.facilityStatus,
      existingRead?.id ?? null,
      read1,
      read2,
      {
        checksum1: assignment.checksum1 ?? null,
        checksum2: assignment.checksum2 ?? null,
        sequencingRunId: assignment.sequencingRunId ?? null,
        dataClass: assignment.dataClass ?? "cleaned",
        dataClassSource: "associate",
        classificationNote: assignment.classificationNote ?? null,
        existingDataClass: existingRead?.dataClass,
        existingFile1: existingRead?.file1,
        existingFile2: existingRead?.file2,
      }
    );

    results.push({ sampleId: sample.sampleId, success: true });
  }

  await checkAndCompleteOrder(orderId);
  return results;
}

export async function classifyOrderSequencingRead(
  orderId: string,
  input: {
    sampleId: string;
    readId?: string | null;
    dataClass: ReadDataClass;
    classificationNote?: string | null;
  },
  classifiedById?: string | null
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const sample = findOrderSample(order, input.sampleId);
  if (!sample) {
    throw new Error("Sample not found");
  }

  const read = input.readId
    ? sample.reads.find((item) => item.id === input.readId)
    : selectActiveRead(sample.reads);

  if (!read) {
    throw new Error("Read record not found");
  }

  const dataClass = normalizeReadDataClass(input.dataClass);
  const updated = await db.read.update({
    where: { id: read.id },
    data: {
      dataClass,
      dataClassSource: "manual",
      classifiedAt: new Date(),
      classifiedById: classifiedById ?? null,
      classificationNote: input.classificationNote ?? null,
    },
  });

  return {
    id: updated.id,
    dataClass: normalizeReadDataClass(updated.dataClass),
    dataClassLabel: READ_DATA_CLASS_LABELS[normalizeReadDataClass(updated.dataClass)],
    dataClassSource: normalizeReadDataClassSource(updated.dataClassSource, "manual"),
    isProtectedRaw: isProtectedReadDataClass(updated.dataClass),
  };
}

export async function linkOrderSequencingArtifact(
  orderId: string,
  input: {
    sampleId?: string | null;
    sequencingRunId?: string | null;
    stage: string;
    artifactType: string;
    path: string;
    originalName?: string | null;
    checksum?: string | null;
    mimeType?: string | null;
    metadata?: string | null;
    visibility?: string | null;
    source?: string | null;
    createdById?: string | null;
  }
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const { dataBasePath } = await requireDataBasePath();
  const sample = input.sampleId ? findOrderSample(order, input.sampleId) : null;
  const relativePath = normalizeArtifactPathInput(dataBasePath, input.path);
  const stats = await statSequencingRelativePath(dataBasePath, relativePath);

  return db.sequencingArtifact.create({
    data: {
      orderId: order.id,
      sampleId: sample?.id ?? null,
      sequencingRunId: input.sequencingRunId ?? null,
      stage: input.stage,
      artifactType: input.artifactType,
      source: input.source ?? "linked",
      visibility: input.visibility ?? "facility",
      path: relativePath,
      originalName: input.originalName?.trim() || path.basename(relativePath),
      size: stats.size,
      checksum: input.checksum ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export async function createSequencingUploadSession(
  orderId: string,
  createdById: string,
  input: {
    sampleId?: string | null;
    targetKind: string;
    targetRole: string;
    originalName: string;
    expectedSize: number;
    checksumProvided?: string | null;
    mimeType?: string | null;
    metadata?: UploadMetadata | null;
  }
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);
  const { config } = await requireDataBasePath();

  if (input.targetKind !== "read" && input.targetKind !== "artifact") {
    throw new Error("Invalid upload target kind");
  }

  if (input.targetKind === "read") {
    if (input.targetRole !== "R1" && input.targetRole !== "R2") {
      throw new Error("Read uploads must target R1 or R2");
    }

    if (!hasAllowedExtension(input.originalName, config.allowedExtensions)) {
      throw new Error("Read uploads must use an allowed sequencing file extension");
    }
  }

  const sample = input.sampleId ? findOrderSample(order, input.sampleId) : null;

  const upload = await db.sequencingUpload.create({
    data: {
      orderId,
      sampleId: sample?.id ?? null,
      targetKind: input.targetKind,
      targetRole: input.targetRole,
      originalName: input.originalName,
      tempPath: "",
      expectedSize: BigInt(input.expectedSize),
      receivedSize: BigInt(0),
      status: "PENDING",
      checksumProvided: input.checksumProvided ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdById,
    },
    select: {
      id: true,
      originalName: true,
    },
  });

  const tempPath = buildSequencingUploadTempRelativePath(orderId, upload.id, upload.originalName);

  await db.sequencingUpload.update({
    where: { id: upload.id },
    data: {
      tempPath,
    },
  });

  return {
    uploadId: upload.id,
    tempPath,
    status: "PENDING",
    receivedSize: 0,
  };
}

export async function appendSequencingUploadChunk(
  orderId: string,
  uploadId: string,
  offset: bigint,
  body: ReadableStream<Uint8Array>
) {
  const upload = await db.sequencingUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      orderId: true,
      tempPath: true,
      receivedSize: true,
      expectedSize: true,
      status: true,
    },
  });

  if (!upload || upload.orderId !== orderId) {
    throw new Error("Upload not found");
  }

  if (offset !== upload.receivedSize) {
    throw new Error("Upload offset does not match current upload size");
  }

  const { dataBasePath } = await requireDataBasePath();
  await writeSequencingUploadChunk(
    dataBasePath,
    upload.tempPath,
    body,
    offset === BigInt(0)
  );

  const stats = await statSequencingRelativePath(dataBasePath, upload.tempPath);
  const nextStatus = stats.size >= upload.expectedSize ? "READY" : "UPLOADING";

  await db.sequencingUpload.update({
    where: { id: uploadId },
    data: {
      receivedSize: stats.size,
      status: nextStatus,
    },
  });

  return {
    uploadId,
    receivedSize: Number(stats.size),
    expectedSize: Number(upload.expectedSize),
    status: nextStatus,
  };
}

function parseUploadMetadata(metadata: string | null): UploadMetadata {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as UploadMetadata;
    return {
      ...parsed,
      dataClass: parsed.dataClass ? normalizeReadDataClass(parsed.dataClass) : undefined,
    };
  } catch {
    return {};
  }
}

export async function completeSequencingUpload(
  orderId: string,
  uploadId: string
) {
  const upload = await db.sequencingUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      orderId: true,
      sampleId: true,
      targetKind: true,
      targetRole: true,
      originalName: true,
      tempPath: true,
      expectedSize: true,
      receivedSize: true,
      checksumProvided: true,
      checksumComputed: true,
      mimeType: true,
      metadata: true,
      finalPath: true,
      createdById: true,
    },
  });

  if (!upload || upload.orderId !== orderId) {
    throw new Error("Upload not found");
  }

  if (upload.receivedSize !== upload.expectedSize) {
    throw new Error("Upload is incomplete");
  }

  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  const { dataBasePath } = await requireDataBasePath();
  const sample = upload.sampleId
    ? order.samples.find((item) => item.id === upload.sampleId) ?? null
    : null;
  const metadata = parseUploadMetadata(upload.metadata);

  const finalPath =
    upload.targetKind === "read"
      ? buildSequencingReadUploadRelativePath(
          orderId,
          sample?.sampleId ?? "order",
          upload.id,
          upload.targetRole,
          upload.originalName
        )
      : buildSequencingArtifactUploadRelativePath(
          orderId,
          upload.id,
          metadata.stage ?? "delivery",
          upload.originalName,
          sample?.sampleId ?? null
        );

  await finalizeSequencingUpload(dataBasePath, upload.tempPath, finalPath);
  const finalStats = await statSequencingRelativePath(dataBasePath, finalPath);

  if (upload.targetKind === "read") {
    if (!sample) {
      throw new Error("Read uploads require a target sample");
    }

    const existingRead = selectActiveRead(sample.reads);
    const existingFile1 =
      upload.targetRole.toUpperCase() === "R1" ? finalPath : existingRead?.file1 ?? null;
    const existingFile2 =
      upload.targetRole.toUpperCase() === "R2" ? finalPath : existingRead?.file2 ?? null;
    const checksum1 =
      upload.targetRole.toUpperCase() === "R1"
        ? upload.checksumProvided ?? upload.checksumComputed ?? null
        : existingRead?.checksum1 ?? null;
    const checksum2 =
      upload.targetRole.toUpperCase() === "R2"
        ? upload.checksumProvided ?? upload.checksumComputed ?? null
        : existingRead?.checksum2 ?? null;

    await upsertSampleReadAssignment(
      sample.id,
      sample.sampleId,
      sample.facilityStatus,
      existingRead?.id ?? null,
      existingFile1,
      existingFile2,
      {
        checksum1,
        checksum2,
        sequencingRunId: metadata.sequencingRunId ?? null,
        dataClass: metadata.dataClass ?? "cleaned",
        dataClassSource: "upload",
        existingDataClass: existingRead?.dataClass,
        existingFile1: existingRead?.file1,
        existingFile2: existingRead?.file2,
      }
    );
  } else {
    await db.sequencingArtifact.create({
      data: {
        orderId,
        sampleId: sample?.id ?? null,
        sequencingRunId: metadata.sequencingRunId ?? null,
        stage: metadata.stage ?? "delivery",
        artifactType: metadata.artifactType ?? "attachment",
        source: metadata.source ?? "upload",
        visibility: metadata.visibility ?? "facility",
        path: finalPath,
        originalName: upload.originalName,
        size: finalStats.size,
        checksum: upload.checksumProvided ?? upload.checksumComputed ?? null,
        mimeType: upload.mimeType,
        metadata: upload.metadata,
        createdById: upload.createdById,
      },
    });
  }

  await db.sequencingUpload.update({
    where: { id: uploadId },
    data: {
      finalPath,
      status: "COMPLETED",
    },
  });

  await checkAndCompleteOrder(orderId);

  return {
    uploadId,
    finalPath,
    size: Number(finalStats.size),
    status: "COMPLETED",
  };
}

export async function cancelSequencingUpload(orderId: string, uploadId: string) {
  const upload = await db.sequencingUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      orderId: true,
      tempPath: true,
      finalPath: true,
      status: true,
    },
  });

  if (!upload || upload.orderId !== orderId) {
    throw new Error("Upload not found");
  }

  const { dataBasePath } = await requireDataBasePath();

  if (upload.status !== "COMPLETED") {
    await removeSequencingRelativePath(dataBasePath, upload.tempPath);
  }

  await db.sequencingUpload.update({
    where: { id: uploadId },
    data: {
      status: "CANCELLED",
    },
  });
}

export async function computeOrderSequencingChecksums(
  orderId: string,
  options?: {
    readIds?: string[];
    artifactIds?: string[];
  }
): Promise<SequencingChecksumSummary> {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Sequencing Order not found");
  }

  assertManageableOrderStatus(order.status);

  const { dataBasePath } = await requireDataBasePath();

  const readCandidates = order.samples
    .flatMap((sample) => sample.reads)
    .filter((read) => !options?.readIds || options.readIds.includes(read.id));

  const artifactCandidates = [
    ...order.sequencingArtifacts,
    ...order.samples.flatMap((sample) => sample.sequencingArtifacts),
  ].filter((artifact) => !options?.artifactIds || options.artifactIds.includes(artifact.id));

  let updatedReads = 0;
  let updatedArtifacts = 0;
  let failed = 0;
  let skippedMissingFiles = 0;

  for (const read of readCandidates) {
    const updates: Record<string, string> = {};

    if (read.file1 && !read.checksum1) {
      try {
        updates.checksum1 = await calculateMd5ForRelativePath(dataBasePath, read.file1);
      } catch (error) {
        if (error instanceof Error && /ENOENT/.test(error.message)) {
          skippedMissingFiles += 1;
        } else {
          failed += 1;
        }
      }
    }

    if (read.file2 && !read.checksum2) {
      try {
        updates.checksum2 = await calculateMd5ForRelativePath(dataBasePath, read.file2);
      } catch (error) {
        if (error instanceof Error && /ENOENT/.test(error.message)) {
          skippedMissingFiles += 1;
        } else {
          failed += 1;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.read.update({
        where: { id: read.id },
        data: updates,
      });
      updatedReads += 1;
    }
  }

  for (const artifact of artifactCandidates) {
    if (artifact.checksum || !artifact.path) {
      continue;
    }

    try {
      const checksum = await calculateMd5ForRelativePath(dataBasePath, artifact.path);
      await db.sequencingArtifact.update({
        where: { id: artifact.id },
        data: { checksum },
      });
      updatedArtifacts += 1;
    } catch (error) {
      if (error instanceof Error && /ENOENT/.test(error.message)) {
        skippedMissingFiles += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    updatedReads,
    updatedArtifacts,
    failed,
    skippedMissingFiles,
  };
}
