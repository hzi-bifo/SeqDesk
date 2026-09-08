import fs from "fs/promises";
import type { Prisma } from "@prisma/client";
import { CAMI_PREPARATION_BYTES, ImportStorageUnavailable, PREPARATION_WAITING, STORAGE_UNKNOWN, STORAGE_WAITING, requireImportStorage } from "./import-storage-capacity";
import path from "path";
import { createHash } from "node:crypto";
import { lockWorkbenchPublicationAccess } from "./publication-access";
import { publishScientificImport, scientificRecordId } from "./scientific-publication";
import { importCollectionSchema, type ImportCollection } from "./import-collection";
import { ImportSelectionConflict } from "./import-conflict";
import { processingDeclarationSchema } from "./import-processing";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";
import { db } from "@/lib/db";
import { updateWorkbenchAnalysisNodeForImportJob } from "@/lib/workbench/analyses";
import { assertPathInsideBase, resolveWorkbenchStorageBase, resolveWorkbenchImportStorage } from "@/lib/workbench/storage";
import { getOrCreateDefaultWorkbenchWorkspace, serializeWorkbenchImportJob } from "@/lib/workbench/workspaces";
import { getWorkbenchImporter } from "./importers/registry";
import type { WorkbenchImportPreview, WorkbenchImportResult } from "./importers/types";

async function appendLog(logPath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `[${new Date().toISOString()}] ${line}\n`);
}

export async function ensureQueuedCollection(tx: Prisma.TransactionClient, userId: string, input: unknown) {
  const collection = importCollectionSchema.optional().parse((input as { collection?: unknown }).collection);
  if (!collection) return;
  const id = scientificRecordId("data", userId, "collection", collection.key);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
  const order = await tx.order.upsert({ where: { id }, update: {}, create: {
    id, orderNumber: `IMP-${id.slice(-40)}`, name: collection.name, userId, dataOrigin: "import", status: "COMPLETED",
    sourceMetadata: JSON.stringify({ imported: true, collectionKey: collection.key, sources: [] }),
  } });
  if (order.userId !== userId || order.dataOrigin !== "import") throw new Error("Imported data container ownership changed");
  return order;
}

async function notifyImport(userId: string, jobId: string, request: string, failed: boolean) {
  try {
    const collection = importCollectionSchema.safeParse(JSON.parse(request).collection);
    if (!collection.success) return;
    const orderId = scientificRecordId("data", userId, "collection", collection.data.key);
    const dedupeKey = `import:${jobId}:${failed ? "error" : "success"}`;
    await db.inAppNotification.upsert({ where: { dedupeKey }, update: {}, create: {
      dedupeKey, userId, eventType: "import.completed", severity: failed ? "error" : "info",
      title: failed ? "Sample import failed" : "Sample import ready", body: collection.data.name,
      linkPath: `/orders/${orderId}/samples-files`, sourceType: "import", sourceId: jobId,
    } });
  } catch { console.warn("[imports] Could not deliver import notification"); }
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
    where: { id: jobId, status: "running", NOT: { phase: "cancelling" } },
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
  idempotencyKey?: string;
}) {
  const provider = getWorkbenchImporter(args.providerId);
  if (!provider) {
    throw new Error(`Unknown Workbench importer: ${args.providerId}`);
  }
  const parsedInput = provider.inputSchema.parse(args.input);
  await requireRawReadImporter(provider.id);
  const priorRequestId = args.idempotencyKey ? `import-${createHash("sha256").update(JSON.stringify([args.userId, args.providerId, args.idempotencyKey])).digest("hex")}` : undefined;
  if (provider.id === "cami-benchmark") {
    const prior = priorRequestId ? await db.workbenchImportJob.findUnique({ where: { id: priorRequestId } }) : null;
    if (prior) {
      if (prior.createdById !== args.userId || prior.request !== JSON.stringify(parsedInput) || prior.preview !== JSON.stringify(args.preview)) throw new Error("Import request key was already used with another selection");
      return { cacheKey: provider.getCacheKey(parsedInput, args.preview), job: serializeWorkbenchImportJob(prior) };
    }
    const input = parsedInput as { dataset: string; sample: number; technology: string; targetStudyId?: string; collection?: ImportCollection };
    if (input.targetStudyId && !await db.study.findFirst({ where: { id: input.targetStudyId, userId: args.userId, user: { isActive: true }, submitted: false }, select: { id: true } })) {
      throw new Error("Destination study is unavailable or cannot accept imports");
    }
    const existing = await db.read.findUnique({ where: { id: scientificRecordId("read", args.userId, ...(input.collection ? ["collection", input.collection.key] : []), provider.id, input.dataset, `sample_${input.sample}`, input.technology) }, select: { id: true } });
    if (existing) throw new ImportSelectionConflict("This CAMI sample and technology already exist in this sequencing-data collection; choose another sample or technology");
  }
  const cacheKey = provider.getCacheKey(parsedInput, args.preview);
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(args.userId);
  const requestId = args.idempotencyKey ? `import-${createHash("sha256").update(JSON.stringify([
    args.userId, args.providerId, args.idempotencyKey,
  ])).digest("hex")}` : undefined;
  let job;
  try {
    const data = {
        ...(requestId ? { id: requestId } : {}),
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
    };
    if (provider.id === "cami-benchmark") {
      const input = parsedInput as { dataset: string; sample: number; technology: string; collection?: ImportCollection };
      const readId = scientificRecordId("read", args.userId, ...(input.collection ? ["collection", input.collection.key] : []), provider.id, input.dataset, `sample_${input.sample}`, input.technology);
      job = await db.$transaction(async tx => {
        await ensureQueuedCollection(tx, args.userId, parsedInput);
        // Serialize same-sample requests across tabs and batch submissions.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${readId}))::text`;
        const prior = requestId ? await tx.workbenchImportJob.findUnique({ where: { id: requestId } }) : null;
        if (prior) {
          if (prior.createdById !== args.userId || prior.request !== JSON.stringify(parsedInput) || prior.preview !== JSON.stringify(args.preview)) throw new ImportSelectionConflict("Import request key was already used with another selection");
          return prior;
        }
        if (await tx.read.findUnique({ where: { id: readId }, select: { id: true } })) throw new ImportSelectionConflict("This CAMI sample and technology are already imported in this collection");
        const active = await tx.workbenchImportJob.findMany({ where: { workspaceId: workspace.id, createdById: args.userId, providerId: provider.id, status: { in: ["queued", "running"] }, request: { contains: input.collection?.key ?? input.dataset } }, select: { request: true } });
        const duplicate = active.some(job => {
          try {
            const pending = JSON.parse(job.request);
            return pending?.collection?.key === input.collection?.key && pending.dataset === input.dataset && pending.sample === input.sample && pending.technology === input.technology;
          } catch { return false; }
        });
        if (duplicate) throw new ImportSelectionConflict("This CAMI sample and technology are already queued or downloading in this collection");
        return tx.workbenchImportJob.create({ data });
      });
    } else job = await db.$transaction(async tx => {
      await ensureQueuedCollection(tx, args.userId, parsedInput);
      return tx.workbenchImportJob.create({ data });
    });
  } catch (error) {
    if (!requestId || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    const existing = await db.workbenchImportJob.findUnique({ where: { id: requestId } });
    if (!existing || existing.workspaceId !== workspace.id || existing.createdById !== args.userId ||
        existing.request !== JSON.stringify(parsedInput) || existing.preview !== JSON.stringify(args.preview)) {
      throw new Error("Import request key was already used with another selection");
    }
    return { cacheKey, job: serializeWorkbenchImportJob(existing) };
  }
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
  userId: string;
}) {
  return db.$transaction(async (tx) => {
    await lockWorkbenchPublicationAccess(tx, args.workspaceId, args.userId);
    for (const spec of args.result.scientificImports ?? (args.result.scientificImport ? [args.result.scientificImport] : [])) {
      for (const read of spec.reads) assertPathInsideBase(read.path, args.result.storagePath, "Imported read");
    }
    const scientificRecords = await publishScientificImport(tx, args.userId, args.result);
    const sourceMetadata = scientificRecords ? { ...args.result.sourceMetadata as object, scientificRecords } : args.result.sourceMetadata;
    const dataset = await tx.workbenchDataset.upsert({
      where: { cacheKey: args.result.cacheKey },
      create: {
        providerId: args.result.sourceType,
        cacheKey: args.result.cacheKey,
        name: args.result.name,
        description: args.result.description,
        sourceType: args.result.sourceType,
        sourceMetadata: JSON.stringify(sourceMetadata),
        storagePath: args.result.storagePath,
        sizeBytes: typeof args.result.sizeBytes === "number" ? BigInt(args.result.sizeBytes) : undefined,
        checksumSha256: args.result.checksumSha256,
        genomeCount: args.result.genomeCount,
        status: "ready",
      },
      update: {
        name: args.result.name,
        description: args.result.description,
        sourceMetadata: JSON.stringify(sourceMetadata),
        storagePath: args.result.storagePath,
        sizeBytes: typeof args.result.sizeBytes === "number" ? BigInt(args.result.sizeBytes) : undefined,
        checksumSha256: args.result.checksumSha256,
        genomeCount: args.result.genomeCount,
        status: "ready",
      },
    });

    await tx.workbenchWorkspaceDataset.upsert({
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

    await tx.workbenchImportJob.update({
      where: { id: args.jobId, status: "running", NOT: { phase: "cancelling" } },
      data: {
        status: "success",
        phase: "complete",
        progress: 100,
        resultDatasetId: dataset.id,
        targetPath: args.result.storagePath,
        finishedAt: new Date(),
        error: null,
      },
    });
    return dataset;
  });
}

export async function runWorkbenchImportJob(jobId: string): Promise<void> {
  const job = await db.workbenchImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;

  // Compete with other runners and queued cancellation in the database, not
  // against the stale snapshot above. Terminal/running jobs are never replayed.
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(742319, 1)::text`;
    if (job.providerId === "cami-benchmark") {
      // A running CAMI job owns the preparation slot until publication or cleanup.
      // This database-wide reservation also covers workers on shared storage and
      // avoids subtracting a budget from free space that already reflects its files.
      let waiting: string | undefined;
      if (await tx.workbenchImportJob.count({ where: { status: "running", providerId: "cami-benchmark" } })) {
        waiting = PREPARATION_WAITING;
      } else {
        try {
          const storageBase = await resolveWorkbenchStorageBase();
          await requireImportStorage(storageBase.cacheRoot, CAMI_PREPARATION_BYTES);
        } catch (error) {
          waiting = error instanceof ImportStorageUnavailable ? error.message : STORAGE_UNKNOWN;
        }
      }
      if (waiting) {
        await tx.workbenchImportJob.updateMany({
          where: { id: jobId, status: "queued" }, data: { phase: waiting },
        });
        return { count: 0 };
      }
    }
    const configured = Number(process.env.SEQDESK_WORKBENCH_IMPORT_CONCURRENCY || 2);
    const limit = Number.isInteger(configured) && configured > 0 && configured <= 16 ? configured : 2;
    if (await tx.workbenchImportJob.count({ where: { status: "running" } }) >= limit) return { count: 0 };
    return tx.workbenchImportJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "running", phase: "starting", startedAt: new Date() },
    });
  });
  if (claimed.count !== 1) return;

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

  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void db.workbenchImportJob.updateMany({
      where: { id: jobId, status: "running", NOT: { phase: "cancelling" } }, data: { updatedAt: new Date() },
    }).then(({ count }) => {
      if (count !== 1) controller.abort();
    }).catch(() => controller.abort());
  }, 2_000);
  heartbeat.unref();
  let storage: Awaited<ReturnType<typeof resolveWorkbenchImportStorage>> | undefined;
  let capacityMonitor: ReturnType<typeof setInterval> | undefined;
  let capacityCheck: Promise<void> = Promise.resolve();
  async function finishCancellation(): Promise<boolean> {
    const current = await db.workbenchImportJob.findUnique({ where: { id: jobId } });
    if (current?.status === "running" && current.phase === "cancelling") {
      // Keep the running slot until the provider has unwound and partial files
      // are removed. Never delete completed datasets or another job's files.
      try {
        if (storage) await fs.rm(storage.cacheDir, { recursive: true, force: true });
        await db.workbenchImportJob.updateMany({ where: { id: jobId, status: "running", phase: "cancelling" }, data: { status: "cancelled", phase: "cancelled", error: null, finishedAt: new Date() } });
      } catch {
        await db.workbenchImportJob.updateMany({ where: { id: jobId, status: "running", phase: "cancelling" }, data: { phase: "cancelling", error: "Cancellation cleanup failed; administrator attention required." } });
      }
      return true;
    }
    return false;
  }
  try {
    await requireRawReadImporter(provider.id);
    const destination = await db.workbenchWorkspace.findFirst({
      where: { id: job.workspaceId, ownerId: job.createdById, owner: { isActive: true } },
      select: { id: true },
    });
    if (!destination) throw new Error("Import destination is no longer available to this user");
    const input = provider.inputSchema.parse(JSON.parse(job.request));
    const preview = JSON.parse(job.preview || "{}") as WorkbenchImportPreview;
    // Until immutable content storage/ref-counting exists, never reuse mutable
    // provider directories between jobs or workspaces. Keep legacy datasets intact.
    const cacheKey = createHash("sha256").update(JSON.stringify([
      "private-import-v1", job.workspaceId, jobId, provider.getCacheKey(input, preview),
    ])).digest("hex");
    storage = await resolveWorkbenchImportStorage({
      providerId: provider.id,
      cacheKey,
      jobId,
    });

    if (provider.id === "cami-benchmark") {
      let checking = false;
      capacityMonitor = setInterval(() => {
        if (checking || controller.signal.aborted) return;
        checking = true;
        capacityCheck = requireImportStorage(storage!.cacheDir)
          .catch(error => controller.abort(error))
          .finally(() => { checking = false; });
      }, 15_000);
      capacityMonitor.unref();
    }

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

    const result = await provider.start({
      jobId,
      workspaceId: job.workspaceId,
      userId: job.createdById,
      input,
      preview,
      cacheKey,
      storage,
      signal: controller.signal,
      update: (update) => {
        if (update.status && update.status !== "running") throw new Error("Only the import runner may publish terminal status");
        return updateJob(jobId, update);
      },
      log: (line) => appendLog(storage!.logPath, line),
    });
    if (capacityMonitor) clearInterval(capacityMonitor);
    await capacityCheck;
    controller.signal.throwIfAborted();
    if (result.cacheKey !== cacheKey || result.sourceType !== provider.id) {
      throw new Error("Importer returned an unexpected dataset identity");
    }
    assertPathInsideBase(result.storagePath, storage.cacheDir, "Workbench import result path");
    const dataset = await completeJobWithDataset({
      jobId,
      workspaceId: job.workspaceId,
      userId: job.createdById,
      // Destination comes from the persisted, validated request, not the provider.
      result: { ...result, collection: importCollectionSchema.optional().parse((input as { collection?: unknown }).collection), processingDeclaration: processingDeclarationSchema.optional().parse((input as { processingDeclaration?: unknown }).processingDeclaration) },
    });
    await notifyImport(job.createdById, jobId, job.request, false);
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
    if (capacityMonitor) clearInterval(capacityMonitor);
    await capacityCheck;
    if (await finishCancellation()) return;
    const storageError = error instanceof ImportStorageUnavailable ? error
      : controller.signal.reason instanceof ImportStorageUnavailable ? controller.signal.reason
      : provider.id === "cami-benchmark" && error && typeof error === "object" && "code" in error &&
        (error.code === "ENOSPC" || error.code === "EDQUOT") ? new ImportStorageUnavailable(STORAGE_WAITING) : null;
    if (storageError) {
      // Retain the running reservation until the writer has stopped and cleanup
      // succeeds. A failed cleanup follows the normal error path below.
      try {
        if (storage) await fs.rm(storage.cacheDir, { recursive: true, force: true });
        const deferred = await db.workbenchImportJob.updateMany({
          where: { id: jobId, status: "running", NOT: { phase: "cancelling" } },
          data: { status: "queued", phase: storageError.message, progress: 0,
            startedAt: null, finishedAt: null, targetPath: null, error: null },
        });
        if (deferred.count === 1) await updateWorkbenchAnalysisNodeForImportJob({
          analysisId: job.analysisId, analysisNodeId: job.analysisNodeId,
          jobId, status: "queued", phase: storageError.message, progress: 0,
        }).catch(() => {});
        return;
      } catch { /* Fail visibly if partial storage cannot be cleaned safely. */ }
    }
    const failed = await db.workbenchImportJob.updateMany({
      where: { id: jobId, status: "running", NOT: { phase: "cancelling" } },
      data: {
        status: "error",
        phase: "failed",
        error: error instanceof Error ? error.message : "Workbench import failed",
        finishedAt: new Date(),
      },
    }).catch(() => null);
    // A canvas notification failure after publication must not downgrade a
    // successful import or make its dataset look failed.
    if (failed?.count !== 1) { await finishCancellation(); return; }
    await notifyImport(job.createdById, jobId, job.request, true);
    // Every new job has exclusive storage. Never clean up after a successful
    // publication; only the worker that recorded failure owns these partials.
    if (storage) {
      await fs.rm(storage.cacheDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(path.join(storage.jobDir, "ncbi_dataset.zip"), { force: true }).catch(() => {});
    }
    await updateWorkbenchAnalysisNodeForImportJob({
      analysisId: job.analysisId,
      analysisNodeId: job.analysisNodeId,
      jobId,
      status: "error",
      phase: "failed",
      error: error instanceof Error ? error.message : "Workbench import failed",
    }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    if (capacityMonitor) clearInterval(capacityMonitor);
  }
}

export async function reconcileWorkbenchImports(options: { waitForJobs?: boolean } = {}): Promise<void> {
  // Expired work is failed, never resumed in the same directory. Stale workers
  // cannot pass the running-status publication check. Byte resume is unsupported.
  await db.workbenchImportJob.updateMany({
    where: { status: "running", updatedAt: { lt: new Date(Date.now() - 180_000) } },
    data: { status: "error", phase: "interrupted", finishedAt: new Date(),
      error: "Import worker stopped responding. Preview again to start a new isolated attempt." },
  });
  const queued = await db.workbenchImportJob.findMany({
    where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: 16, select: { id: true },
  });
  const work = Promise.allSettled(queued.map(({ id }) => runWorkbenchImportJob(id)));
  if (options.waitForJobs !== false) await work;
}
