import * as path from "path";
import type { FileMatchSuggestion } from "@/lib/files";
import {
  checkFileExists,
  ensureWithinBase,
  findFilesForSample,
  hasAllowedExtension,
  scanDirectory,
  toRelativePath,
  validateFilePair,
} from "@/lib/files";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { db } from "@/lib/db";
import { checkAndCompleteOrder } from "@/lib/orders/auto-complete";
import {
  FILES_ASSIGNABLE_STATUSES,
  getSequencingIntegrityStatus,
  isFacilitySampleStatus,
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
import type {
  OrderSequencingSummaryResponse,
  SequencingArtifactSummary,
  SequencingChecksumSummary,
  SequencingDiscoveryResult,
  SequencingRunSummary,
  SequencingSampleRow,
  SequencingStatusCounts,
} from "./types";

type OrderWithSequencing = Awaited<ReturnType<typeof loadOrderWithSequencing>>;

type UploadMetadata = {
  stage?: string;
  artifactType?: string;
  visibility?: string;
  sequencingRunId?: string | null;
  source?: string;
};

const DEFAULT_STATUS_COUNTS: SequencingStatusCounts = {
  WAITING: 0,
  PROCESSING: 0,
  SEQUENCED: 0,
  QC_REVIEW: 0,
  READY: 0,
  ISSUE: 0,
};

async function loadOrderWithSequencing(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      name: true,
      status: true,
      userId: true,
      samples: {
        orderBy: { sampleId: "asc" },
        select: {
          id: true,
          sampleId: true,
          sampleAlias: true,
          sampleTitle: true,
          facilityStatus: true,
          facilityStatusUpdatedAt: true,
          updatedAt: true,
          reads: {
            select: {
              id: true,
              file1: true,
              file2: true,
              checksum1: true,
              checksum2: true,
              readCount1: true,
              readCount2: true,
              fastqcReport1: true,
              fastqcReport2: true,
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
    },
  });
}

function assertManageableOrderStatus(status: string): void {
  if (!FILES_ASSIGNABLE_STATUSES.includes(status as (typeof FILES_ASSIGNABLE_STATUSES)[number])) {
    throw new Error("Sequencing data can only be managed on submitted or completed orders");
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
    throw new Error("Order not found");
  }

  const statusCounts: SequencingStatusCounts = { ...DEFAULT_STATUS_COUNTS };
  const rows: SequencingSampleRow[] = order.samples.map((sample) => {
    const read = sample.reads[0] || null;
    const artifacts = sample.sequencingArtifacts.map(toArtifactSummary);
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
        ? {
            id: read.id,
            file1: read.file1,
            file2: read.file2,
            checksum1: read.checksum1,
            checksum2: read.checksum2,
            readCount1: read.readCount1,
            readCount2: read.readCount2,
            fastqcReport1: read.fastqcReport1,
            fastqcReport2: read.fastqcReport2,
          }
        : null,
      integrityStatus,
      hasReads: Boolean(read?.file1 || read?.file2),
      sequencingRun: toSequencingRunSummary(read?.sequencingRun),
      artifactCount: artifacts.length,
      qcArtifactCount: artifacts.filter((artifact) =>
        artifact.stage === "qc" ||
        artifact.artifactType === "qc_report" ||
        artifact.artifactType === "multiqc_report"
      ).length,
      latestArtifactStage: latestArtifact?.stage ?? null,
      artifacts,
    };
  });

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
    summary: {
      totalSamples: rows.length,
      readsLinkedSamples: rows.filter((row) => row.hasReads).length,
      qcArtifactSamples: rows.filter((row) => row.qcArtifactCount > 0).length,
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
    throw new Error("Order not found");
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
}> {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  assertManageableOrderStatus(order.status);

  const { dataBasePath, config } = await requireDataBasePath();

  const files = await scanDirectory(
    dataBasePath,
    {
      allowedExtensions: config.allowedExtensions,
      maxDepth: config.scanDepth,
      ignorePatterns: config.ignorePatterns,
    },
    options.force ?? false
  );

  const results: SequencingDiscoveryResult[] = [];
  let autoAssigned = 0;

  for (const sample of order.samples) {
    const existingRead = sample.reads[0] || null;
    const hasExistingAssignment = Boolean(existingRead?.file1 || existingRead?.file2);

    if (hasExistingAssignment && !options.force) {
      results.push({
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        suggestion: {
          status: "exact",
          read1: null,
          read2: null,
          confidence: 1,
          alternatives: [],
        },
        autoAssigned: false,
      });
      continue;
    }

    const suggestion = findFilesForSample(
      {
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        sampleTitle: sample.sampleTitle,
      },
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
        suggestion.read2?.relativePath || null
      );
      wasAutoAssigned = true;
      autoAssigned += 1;
    }

    results.push({
      sampleId: sample.sampleId,
      sampleAlias: sample.sampleAlias,
      suggestion: cleanSuggestion,
      autoAssigned: wasAutoAssigned,
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
  };
}

function toDiscoverySuggestion(suggestion: FileMatchSuggestion) {
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
  }
) {
  if (existingReadId) {
    await db.read.update({
      where: { id: existingReadId },
      data: {
        file1,
        file2,
        checksum1: options?.checksum1 ?? undefined,
        checksum2: options?.checksum2 ?? undefined,
        sequencingRunId: options?.sequencingRunId ?? undefined,
      },
    });
  } else if (file1 || file2) {
    await db.read.create({
      data: {
        sampleId: sampleRecordId,
        file1,
        file2,
        checksum1: options?.checksum1 ?? null,
        checksum2: options?.checksum2 ?? null,
        sequencingRunId: options?.sequencingRunId ?? null,
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
  }>
) {
  const order = await loadOrderWithSequencing(orderId);
  if (!order) {
    throw new Error("Order not found");
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

    const existingRead = sample.reads[0] || null;

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
      }
    );

    results.push({ sampleId: sample.sampleId, success: true });
  }

  await checkAndCompleteOrder(orderId);
  return results;
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
    throw new Error("Order not found");
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
    throw new Error("Order not found");
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
    return JSON.parse(metadata) as UploadMetadata;
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
    throw new Error("Order not found");
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

    const existingRead = sample.reads[0] || null;
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
    throw new Error("Order not found");
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
