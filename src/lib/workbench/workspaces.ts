import { db } from "@/lib/db";
import { scientificRecordId } from "./scientific-publication";

export interface SerializedWorkbenchDataset {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  sourceType: string;
  sourceMetadata: unknown;
  sizeBytes: number | null;
  checksumSha256: string | null;
  genomeCount: number | null;
  status: string;
  linkedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedWorkbenchImportJob {
  collectionOrderId?: string;
  scientificRecords?: { orderId?: string; orderTitle?: string; studyId: string | null; sampleId: string; studyTitle: string | null; sampleTitle: string } | null;
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  request: unknown;
  preview: unknown;
  progress: number | null;
  error: string | null;
  resultDatasetId: string | null;
  analysisId: string | null;
  analysisNodeId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function dateToIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function bigintToNumber(value: bigint | number | null | undefined): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}

export async function getOrCreateDefaultWorkbenchWorkspace(userId: string) {
  try {
    return await db.workbenchWorkspace.upsert({
      where: { ownerId: userId },
      create: {
        ownerId: userId,
        name: "Private Workbench",
        isDefault: true,
      },
      update: {},
    });
  } catch (error) {
    // Prisma may emulate an empty-update upsert as read/create. Another request
    // can create this same owner's workspace between those statements.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    const existing = await db.workbenchWorkspace.findUnique({ where: { ownerId: userId } });
    if (!existing) throw error;
    return existing;
  }
}

export function serializeWorkbenchDatasetLink(link: {
  linkedAt: Date;
  dataset: {
    id: string;
    providerId: string;
    name: string;
    description: string | null;
    sourceType: string;
    sourceMetadata: string | null;
    storagePath: string | null;
    sizeBytes: bigint | number | null;
    checksumSha256: string | null;
    genomeCount: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
}): SerializedWorkbenchDataset {
  return {
    id: link.dataset.id,
    providerId: link.dataset.providerId,
    name: link.dataset.name,
    description: link.dataset.description,
    sourceType: link.dataset.sourceType,
    sourceMetadata: parseJson(link.dataset.sourceMetadata),
    sizeBytes: bigintToNumber(link.dataset.sizeBytes),
    checksumSha256: link.dataset.checksumSha256,
    genomeCount: link.dataset.genomeCount,
    status: link.dataset.status,
    linkedAt: link.linkedAt.toISOString(),
    createdAt: link.dataset.createdAt.toISOString(),
    updatedAt: link.dataset.updatedAt.toISOString(),
  };
}

export function serializeWorkbenchImportJob(job: {
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  request: string;
  preview: string | null;
  progress: number | null;
  logPath: string | null;
  targetPath: string | null;
  error: string | null;
  resultDatasetId: string | null;
  analysisId: string | null;
  analysisNodeId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SerializedWorkbenchImportJob {
  return {
    id: job.id,
    providerId: job.providerId,
    status: job.status,
    phase: job.phase,
    request: parseJson(job.request),
    preview: parseJson(job.preview),
    progress: job.progress,
    error: job.error,
    resultDatasetId: job.resultDatasetId,
    analysisId: job.analysisId,
    analysisNodeId: job.analysisNodeId,
    startedAt: dateToIso(job.startedAt),
    finishedAt: dateToIso(job.finishedAt),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function listWorkbenchDatasets(userId: string): Promise<SerializedWorkbenchDataset[]> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const links = await db.workbenchWorkspaceDataset.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { linkedAt: "desc" },
    include: { dataset: true },
  });
  return links.map(serializeWorkbenchDatasetLink);
}

export async function listWorkbenchImportJobs(userId: string, collection?: string): Promise<SerializedWorkbenchImportJob[]> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const collectionOrder = collection ? await db.order.findFirst({ where: { id: scientificRecordId("data", userId, "collection", collection), userId, dataOrigin: "import" }, select: { id: true } }) : null;
  const jobs = await db.workbenchImportJob.findMany({
    where: { workspaceId: workspace.id, ...(collection ? { request: { contains: collection } } : {}) },
    orderBy: { createdAt: "desc" },
    ...(collection ? {} : { take: 50 }),
    include: { resultDataset: { select: { sourceMetadata: true } } },
  });
  return jobs.filter(job => !collection || (parseJson(job.request) as { collection?: { key?: string } } | null)?.collection?.key === collection).map(job => {
    const metadata = parseJson(job.resultDataset?.sourceMetadata) as { scientificRecords?: SerializedWorkbenchImportJob["scientificRecords"] } | null;
    return { ...serializeWorkbenchImportJob(job), ...(collectionOrder ? { collectionOrderId: collectionOrder.id } : {}), scientificRecords: metadata?.scientificRecords ?? null };
  });
}
