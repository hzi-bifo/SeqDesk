import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { updateWorkbenchAnalysisNodeForImportJob } from "@/lib/workbench/analyses";
import { assertPathInsideBase, resolveWorkbenchImportStorage } from "@/lib/workbench/storage";
import { getOrCreateDefaultWorkbenchWorkspace, serializeWorkbenchImportJob } from "@/lib/workbench/workspaces";
import { getWorkbenchImporter } from "./importers/registry";
import type { WorkbenchImportPreview, WorkbenchImportResult } from "./importers/types";

async function appendLog(logPath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `[${new Date().toISOString()}] ${line}\n`);
}

async function updateJob(jobId: string, update: {
  status?: string;
  phase?: string | null;
  progress?: number | null;
  logPath?: string | null;
  targetPath?: string | null;
  error?: string | null;
  resultDatasetId?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  await db.workbenchImportJob.update({
    where: { id: jobId },
    data: update,
  });
}

export async function createWorkbenchImportJob(args: {
  userId: string;
  providerId: string;
  input: unknown;
  preview: WorkbenchImportPreview;
  analysisId?: string;
  analysisNodeId?: string;
}) {
  const provider = getWorkbenchImporter(args.providerId);
  if (!provider) {
    throw new Error(`Unknown Workbench importer: ${args.providerId}`);
  }
  const parsedInput = provider.inputSchema.parse(args.input);
  const cacheKey = provider.getCacheKey(parsedInput, args.preview);
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(args.userId);
  const job = await db.workbenchImportJob.create({
    data: {
      workspaceId: workspace.id,
      providerId: args.providerId,
      status: "queued",
      phase: "queued",
      request: JSON.stringify(parsedInput),
      preview: JSON.stringify(args.preview),
      progress: 0,
      createdById: args.userId,
      analysisId: args.analysisId,
      analysisNodeId: args.analysisNodeId,
    },
  });
  await updateWorkbenchAnalysisNodeForImportJob({
    analysisId: args.analysisId,
    analysisNodeId: args.analysisNodeId,
    jobId: job.id,
    status: "queued",
    phase: "queued",
    progress: 0,
  });
  return {
    cacheKey,
    job: serializeWorkbenchImportJob(job),
  };
}

async function completeJobWithDataset(args: {
  jobId: string;
  workspaceId: string;
  result: WorkbenchImportResult;
}) {
  const dataset = await db.workbenchDataset.upsert({
    where: { cacheKey: args.result.cacheKey },
    create: {
      providerId: args.result.sourceType,
      cacheKey: args.result.cacheKey,
      name: args.result.name,
      description: args.result.description,
      sourceType: args.result.sourceType,
      sourceMetadata: JSON.stringify(args.result.sourceMetadata),
      storagePath: args.result.storagePath,
      sizeBytes: typeof args.result.sizeBytes === "number" ? BigInt(args.result.sizeBytes) : undefined,
      checksumSha256: args.result.checksumSha256,
      genomeCount: args.result.genomeCount,
      status: "ready",
    },
    update: {
      name: args.result.name,
      description: args.result.description,
      sourceMetadata: JSON.stringify(args.result.sourceMetadata),
      storagePath: args.result.storagePath,
      sizeBytes: typeof args.result.sizeBytes === "number" ? BigInt(args.result.sizeBytes) : undefined,
      checksumSha256: args.result.checksumSha256,
      genomeCount: args.result.genomeCount,
      status: "ready",
    },
  });

  await db.workbenchWorkspaceDataset.upsert({
    where: {
      workspaceId_datasetId: {
        workspaceId: args.workspaceId,
        datasetId: dataset.id,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      datasetId: dataset.id,
      createdByImportJobId: args.jobId,
    },
    update: {
      createdByImportJobId: args.jobId,
    },
  });

  await updateJob(args.jobId, {
    status: "success",
    phase: "complete",
    progress: 100,
    resultDatasetId: dataset.id,
    targetPath: args.result.storagePath,
    finishedAt: new Date(),
    error: null,
  });
  return dataset;
}

export async function runWorkbenchImportJob(jobId: string): Promise<void> {
  const job = await db.workbenchImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;

  const provider = getWorkbenchImporter(job.providerId);
  if (!provider) {
    await updateJob(jobId, {
      status: "error",
      phase: "failed",
      error: `Unknown Workbench importer: ${job.providerId}`,
      finishedAt: new Date(),
    });
    return;
  }

  try {
    const input = provider.inputSchema.parse(JSON.parse(job.request));
    const preview = JSON.parse(job.preview || "{}") as WorkbenchImportPreview;
    const cacheKey = provider.getCacheKey(input, preview);
    const storage = await resolveWorkbenchImportStorage({
      providerId: provider.id,
      cacheKey,
      jobId,
    });

    await updateJob(jobId, {
      status: "running",
      phase: "starting",
      startedAt: new Date(),
      logPath: storage.logPath,
      targetPath: storage.cacheDir,
      error: null,
    });
    await updateWorkbenchAnalysisNodeForImportJob({
      analysisId: job.analysisId,
      analysisNodeId: job.analysisNodeId,
      jobId,
      status: "running",
      phase: "starting",
      progress: job.progress ?? 0,
    });

    const existingDataset = await db.workbenchDataset.findUnique({
      where: { cacheKey },
    });
    if (existingDataset?.status === "ready" && existingDataset.storagePath) {
      assertPathInsideBase(
        existingDataset.storagePath,
        storage.cacheDir,
        "Shared Workbench cache path"
      );
      await appendLog(storage.logPath, `Reusing existing shared Workbench dataset ${existingDataset.id}.`);
      const dataset = await completeJobWithDataset({
        jobId,
        workspaceId: job.workspaceId,
        result: {
          cacheKey,
          name: existingDataset.name,
          description: existingDataset.description ?? undefined,
          sourceType: existingDataset.sourceType,
          sourceMetadata: JSON.parse(existingDataset.sourceMetadata || "{}"),
          storagePath: existingDataset.storagePath,
          sizeBytes: typeof existingDataset.sizeBytes === "bigint" ? Number(existingDataset.sizeBytes) : undefined,
          checksumSha256: existingDataset.checksumSha256 ?? undefined,
          genomeCount: existingDataset.genomeCount ?? undefined,
        },
      });
      await updateWorkbenchAnalysisNodeForImportJob({
        analysisId: job.analysisId,
        analysisNodeId: job.analysisNodeId,
        jobId,
        status: "success",
        phase: "complete",
        progress: 100,
        resultDataset: dataset,
      });
      return;
    }

    const result = await provider.start({
      jobId,
      workspaceId: job.workspaceId,
      userId: job.createdById,
      input,
      preview,
      cacheKey,
      storage,
      update: (update) => updateJob(jobId, update),
      log: (line) => appendLog(storage.logPath, line),
    });
    assertPathInsideBase(result.storagePath, storage.cacheDir, "Workbench import result path");
    const dataset = await completeJobWithDataset({
      jobId,
      workspaceId: job.workspaceId,
      result,
    });
    await updateWorkbenchAnalysisNodeForImportJob({
      analysisId: job.analysisId,
      analysisNodeId: job.analysisNodeId,
      jobId,
      status: "success",
      phase: "complete",
      progress: 100,
      resultDataset: dataset,
    });
  } catch (error) {
    await updateJob(jobId, {
      status: "error",
      phase: "failed",
      error: error instanceof Error ? error.message : "Workbench import failed",
      finishedAt: new Date(),
    }).catch(() => {});
    await updateWorkbenchAnalysisNodeForImportJob({
      analysisId: job.analysisId,
      analysisNodeId: job.analysisNodeId,
      jobId,
      status: "error",
      phase: "failed",
      error: error instanceof Error ? error.message : "Workbench import failed",
    }).catch(() => {});
  }
}
