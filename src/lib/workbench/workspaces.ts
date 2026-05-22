import { db } from "@/lib/db";

export interface SerializedWorkbenchDataset {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  sourceType: string;
  sourceMetadata: unknown;
  storagePath: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  genomeCount: number | null;
  status: string;
  linkedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedWorkbenchImportJob {
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  request: unknown;
  preview: unknown;
  progress: number | null;
  logPath: string | null;
  targetPath: string | null;
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
  return db.workbenchWorkspace.upsert({
    where: { ownerId: userId },
    create: {
      ownerId: userId,
      name: "Private Workbench",
      isDefault: true,
    },
    update: {},
  });
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
    storagePath: link.dataset.storagePath,
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
    logPath: job.logPath,
    targetPath: job.targetPath,
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

export async function listWorkbenchImportJobs(userId: string): Promise<SerializedWorkbenchImportJob[]> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const jobs = await db.workbenchImportJob.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return jobs.map(serializeWorkbenchImportJob);
}
