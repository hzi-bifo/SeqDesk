import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Session } from "next-auth";
import { z } from "zod";
import { db } from "@/lib/db";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { validateFastqFile } from "@/lib/workbench/fastq-validation";
import { loadMinknowConfig } from "@/lib/minknow/config";
import { inputModuleEnabled } from "@/lib/modules/input-modules.server";
import type { OrderDataFilesInventory, OrderDataFilesStorage } from "./data-files-types";

export const DATA_FILES_UPLOAD_LIMIT = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024 * 1024;
const FASTQ = /\.(fastq|fq)(\.gz)?$/i;

export class DataFilesError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const linkDataFilesSchema = z.object({
  requestId: z.string().uuid().optional(),
  sampleId: z.string().min(1).max(200).optional(),
  newSample: z.object({ sampleId: z.string().trim().min(1).max(200), sampleTitle: z.string().trim().max(500).optional() }).strict().optional(),
  read1: z.string().min(1).max(4096),
  read2: z.string().max(4096).optional(),
  processing: z.enum(["unknown", "unprocessed", "cleaned"]).default("unknown"),
  processingNote: z.string().trim().max(2000).optional(),
}).strict().refine(value => Boolean(value.sampleId) !== Boolean(value.newSample), "Choose an existing sample or enter a new sample")
  .refine(value => value.processing === "unknown" || Boolean(value.processingNote), "Describe the evidence for the processing declaration");

function record(value: string | null | undefined): Record<string, unknown> {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function inside(target: string, root: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function authorizeDataFiles(session: Session | null, orderId: string, write = false) {
  if (!isActiveSession(session)) throw new DataFilesError(401, "Unauthorized");
  const profile = getServerDeploymentProfile();
  const all = decideCapability(session, "orders.read_all", profile);
  const own = decideCapability(session, "orders.read", profile);
  const grant = all.allowed ? all.grant : own.grant;
  if (!grant) throw new DataFilesError(own.status, "Files are not available");
  const order = await db.order.findUnique({ where: { id: orderId }, select: {
    id: true, name: true, userId: true, dataOrigin: true, status: true,
    sourceMetadata: true, sequencingFilesPublishedAt: true,
  } });
  if (!order) throw new DataFilesError(404, "Data collection not found");
  if (order.userId !== session.user.id && grant.scope !== "installation") throw new DataFilesError(403, "You do not have access to this collection");
  const facility = decideCapability(session, "sequencing.files.manage", profile).allowed;
  const facilityEnabled = facility && await inputModuleEnabled("sequencing-management");
  const canManage = !session.user.isDemo && (order.dataOrigin === "import"
    ? order.userId === session.user.id && decideCapability(session, "workbench.import", profile).allowed
    : facilityEnabled);
  if (write && !canManage) throw new DataFilesError(403, "You do not have permission to add files to this collection");
  const browseAll = facility || decideCapability(session, "system.sequencing.manage", profile).allowed;
  return { order, userId: session.user.id, canManage, canManageFacility: facilityEnabled && !session.user.isDemo, browseAll,
    canViewAll: facility || order.dataOrigin === "import",
    canRunSequencer: !session.user.isDemo && decideCapability(session, "sequencing.runs.manage", profile).allowed };
}
type Access = Awaited<ReturnType<typeof authorizeDataFiles>>;

async function configuredBase() {
  const { dataBasePath } = await getResolvedDataBasePath();
  if (!dataBasePath) throw new DataFilesError(400, "Server data storage is not configured");
  try { return await fs.realpath(dataBasePath); } catch { throw new DataFilesError(400, "Server data storage is unavailable"); }
}
function uploadRoot(orderId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(orderId)) throw new DataFilesError(400, "Invalid collection identifier");
  return path.join("_uploads", "orders", orderId);
}

async function storageRoots(access: Access, base: string) {
  if (access.browseAll) return [{ path: "", label: "Server data storage" }];
  const roots = [{ path: uploadRoot(access.order.id), label: "This collection's files" }];
  const links = await db.workbenchWorkspaceDataset.findMany({
    where: { workspace: { ownerId: access.userId } },
    select: { dataset: { select: { name: true, storagePath: true } } },
  });
  for (const { dataset } of links) {
    if (!dataset.storagePath) continue;
    const target = path.resolve(base, dataset.storagePath);
    if (inside(target, base)) roots.push({ path: path.relative(base, target), label: dataset.name });
  }
  return [...new Map(roots.map(root => [root.path, root])).values()];
}

/** Check both the supplied location and its real target, including root symlinks. */
async function scopedPath(base: string, roots: Array<{ path: string }>, input: string) {
  if (!input || input.includes("\0")) throw new DataFilesError(400, "Select a file or folder");
  const target = path.resolve(base, input);
  if (!inside(target, base)) throw new DataFilesError(403, "Path is outside permitted server storage");
  const root = roots.find(item => inside(target, path.resolve(base, item.path)));
  if (!root) throw new DataFilesError(403, "Path is outside your permitted server storage");
  let real: string;
  try { real = await fs.realpath(target); } catch { throw new DataFilesError(404, "File or folder was not found"); }
  const expectedRoot = path.resolve(base, root.path);
  let actualRoot: string;
  try { actualRoot = await fs.realpath(expectedRoot); } catch { throw new DataFilesError(404, "Storage folder was not found"); }
  if (actualRoot !== expectedRoot || !inside(real, actualRoot) || !inside(real, base)) throw new DataFilesError(403, "Symbolic link leaves permitted storage");
  return real;
}

export async function listDataFilesStorage(access: Access, requestedPath?: string, search = ""): Promise<OrderDataFilesStorage> {
  if (!access.canManage) throw new DataFilesError(403, "You do not have permission to browse server storage");
  const base = await configuredBase();
  const roots = await storageRoots(access, base);
  const current = requestedPath || roots[0]?.path || "";
  let directory: string;
  try { directory = await scopedPath(base, roots, current || "."); }
  catch (error) {
    if (error instanceof DataFilesError && error.status === 404 && current === uploadRoot(access.order.id)) return { path: current, roots, entries: [], truncated: false };
    throw error;
  }
  if (!(await fs.stat(directory)).isDirectory()) throw new DataFilesError(400, "Select a folder");
  const entries = [];
  let truncated = false;
  const folder = await fs.opendir(directory);
  let visited = 0;
  for await (const item of folder) {
    if (++visited > 5000 || entries.length >= 500) { truncated = true; break; }
    if (item.name.startsWith(".") || (!item.isDirectory() && !item.isSymbolicLink() && !FASTQ.test(item.name))) continue;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) continue;
    try {
      const relative = path.relative(base, path.join(directory, item.name));
      const resolved = await scopedPath(base, roots, relative);
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory() && (!stat.isFile() || !FASTQ.test(item.name))) continue;
      entries.push({ path: relative, name: item.name, type: stat.isDirectory() ? "directory" as const : "file" as const, size: stat.isFile() ? stat.size : null });
    } catch { /* Unreadable and out-of-scope links are omitted. */ }
  }
  entries.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
  return { path: path.relative(base, directory), roots, entries, truncated };
}

async function fileInfo(base: string | null, filePath: string, role: "R1" | "R2" | "single" = "single", checksum?: string | null) {
  let exists = false, size: number | null = null;
  if (base) {
    try { const target = await scopedPath(base, [{ path: "" }], filePath); const stat = await fs.stat(target); exists = stat.isFile(); size = exists ? stat.size : null; } catch { /* Keep missing files visible. */ }
  }
  return { path: filePath, name: path.basename(filePath), role, exists, size, checksum: checksum ?? null };
}

export async function getDataFilesInventory(access: Access): Promise<OrderDataFilesInventory> {
  const { order } = access;
  const readWhere = access.canViewAll ? undefined : order.sequencingFilesPublishedAt ? { isActive: true, dataClass: "cleaned" } : { id: "__unreleased__" };
  const [samples, artifacts, streams, base] = await Promise.all([
    db.sample.findMany({ where: { orderId: order.id }, include: { reads: { where: readWhere, orderBy: { id: "asc" } } }, orderBy: { sampleId: "asc" } }),
    db.sequencingArtifact.findMany({ where: { orderId: order.id, ...(access.canViewAll ? {} : order.sequencingFilesPublishedAt ? { visibility: "customer" } : { id: "__unreleased__" }) }, orderBy: { createdAt: "desc" } }),
    access.canViewAll ? db.streamRun.findMany({ where: { orderId: order.id }, include: { ingestedFiles: { orderBy: { ingestedAt: "desc" }, take: 200 } }, orderBy: { startedAt: "desc" } }) : Promise.resolve([]),
    configuredBase().catch(() => null),
  ]);
  const readSets = await Promise.all(samples.flatMap(sample => sample.reads.map(async read => {
    const metadata = record(read.pipelineSources);
    const files = await Promise.all([
      ...(read.file1 ? [fileInfo(base, read.file1, read.file2 ? "R1" : "single", read.checksum1)] : []),
      ...(read.file2 ? [fileInfo(base, read.file2, "R2", read.checksum2)] : []),
    ]);
    return { id: read.id, sampleId: sample.id, sampleIdentifier: sample.sampleId, sampleTitle: sample.sampleTitle,
      files, source: typeof metadata.sourceType === "string" ? metadata.sourceType : read.sequencingRunId ? "sequencer" : order.dataOrigin === "facility" ? "facility" : read.dataClassSource,
      // Classification may change independently of the retained source evidence.
      processing: read.dataClass === "raw" ? "unprocessed" : read.dataClass,
      isActive: read.isActive, supersededByReadId: read.supersededByReadId,
      runAccessionNumber: read.runAccessionNumber, metadata };
  })));
  let sequencingSourceEnabled = false;
  if (access.canRunSequencer) {
    const [config, enabled] = await Promise.all([loadMinknowConfig(), inputModuleEnabled("sequencing-management")]);
    sequencingSourceEnabled = enabled && config.enabled && Boolean(config.outputRoot);
  }
  const collectionMetadata = record(order.sourceMetadata);
  return {
    order: { id: order.id, name: order.name, dataOrigin: order.dataOrigin, status: order.status, collectionKey: typeof collectionMetadata.collectionKey === "string" ? collectionMetadata.collectionKey : null },
    canManage: access.canManage, canManageFacility: access.canManageFacility, sequencingSourceEnabled,
    storageConfigured: Boolean(base), uploadLimitBytes: DATA_FILES_UPLOAD_LIMIT,
    samples: samples.map(sample => ({ id: sample.id, sampleId: sample.sampleId, sampleTitle: sample.sampleTitle })), readSets,
    artifacts: await Promise.all(artifacts.map(async artifact => ({ id: artifact.id, sampleId: artifact.sampleId, stage: artifact.stage, type: artifact.artifactType, source: artifact.source, file: await fileInfo(base, artifact.path, "single", artifact.checksum) }))),
    streams: await Promise.all(streams.map(async stream => ({ id: stream.id, status: stream.status, startedAt: stream.startedAt.toISOString(),
      files: await Promise.all(stream.ingestedFiles.map(async file => ({ id: file.id, sampleId: file.sampleId, barcode: file.barcode, file: await fileInfo(base, file.filePath) }))) }))),
  };
}

async function inspectRead(base: string, roots: Array<{ path: string }>, input: string, signal?: AbortSignal) {
  if (!FASTQ.test(input)) throw new DataFilesError(400, "Read files must be FASTQ or FASTQ.gz (.fq is also supported)");
  const absolute = await scopedPath(base, roots, input);
  const before = await fs.stat(absolute);
  if (!before.isFile() || before.size === 0) throw new DataFilesError(400, "Read files must be nonempty regular files");
  let validation;
  try { validation = await validateFastqFile(absolute, { gzip: /\.gz$/i.test(input), maxExpandedBytes: MAX_EXPANDED_BYTES, signal }); }
  catch (error) { throw new DataFilesError(400, error instanceof Error ? error.message : "Invalid FASTQ file"); }
  const hash = createHash("md5");
  for await (const chunk of createReadStream(absolute)) { signal?.throwIfAborted(); hash.update(chunk); }
  const after = await fs.stat(absolute);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new DataFilesError(409, "A file changed during validation. Wait until writing finishes and retry");
  return { path: path.relative(base, absolute), absolute, device: after.dev, inode: after.ino, bytes: after.size, checksum: hash.digest("hex"), ...validation };
}

async function addDataFilesReadSetImpl(access: Access, input: unknown, source: "local_files" | "upload" = "local_files", signal?: AbortSignal) {
  if (!access.canManage) throw new DataFilesError(403, "You do not have permission to add files");
  const parsed = linkDataFilesSchema.safeParse(input);
  if (!parsed.success) throw new DataFilesError(400, parsed.error.issues[0]?.message ?? "Invalid file association");
  const value = parsed.data;
  const base = await configuredBase(), roots = await storageRoots(access, base);
  const first = await inspectRead(base, roots, value.read1, signal);
  const second = value.read2 ? await inspectRead(base, roots, value.read2, signal) : null;
  if (second && (first.absolute === second.absolute || (first.device === second.device && first.inode === second.inode))) throw new DataFilesError(400, "Choose two different files for a paired read set");
  if (second && (first.records !== second.records || first.readNamesSha256 !== second.readNamesSha256)) throw new DataFilesError(400, "Paired files have mismatched read identifiers or counts");
  const paths = [first.path, ...(second ? [second.path] : [])];
  const requestReadId = value.requestId ? `linked-read-${createHash("sha256").update(JSON.stringify([access.userId, access.order.id, value.requestId])).digest("hex")}` : undefined;
  const associationFingerprint = createHash("sha256").update(JSON.stringify({
    source, sampleId: value.sampleId ?? null, newSample: value.newSample ?? null,
    processing: value.processing, processingNote: value.processingNote ?? null,
    files: [first, ...(second ? [second] : [])].map(file => ({ checksum: file.checksum, bytes: file.bytes, path: source === "upload" ? null : file.path })),
  })).digest("hex");
  const metadata = { sourceType: source, linkedById: access.userId, linkedAt: new Date().toISOString(),
    ...(value.requestId ? { requestId: value.requestId, associationFingerprint } : {}),
    processing: { effectiveState: value.processing, source: { state: "unknown", evidence: "not_provided", details: "Processing history was not established from the file." },
      ...(value.processingNote ? { userDeclaration: { state: value.processing, details: value.processingNote, userId: access.userId, recordedAt: new Date().toISOString() } } : {}) },
    files: [first, ...(second ? [second] : [])].map(file => ({ filename: path.basename(file.path), bytes: file.bytes, verifiedMd5: file.checksum })),
  };
  return db.$transaction(async tx => {
    // Serialize all new associations in this collection, including new sample IDs.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${access.order.id}))::text`;
    const current = await tx.order.findUnique({ where: { id: access.order.id }, select: { userId: true, dataOrigin: true } });
    if (!current || current.userId !== access.order.userId || current.dataOrigin !== access.order.dataOrigin) throw new DataFilesError(409, "Collection ownership changed. Refresh and retry");
    if (requestReadId) {
      const prior = await tx.read.findUnique({ where: { id: requestReadId }, select: { id: true, sampleId: true, pipelineSources: true, sample: { select: { orderId: true } } } });
      if (prior) {
        if (prior.sample.orderId !== access.order.id || record(prior.pipelineSources).associationFingerprint !== associationFingerprint) throw new DataFilesError(409, "This request was already used for different files or sample metadata. Review the selection again");
        return { readId: prior.id, sampleId: prior.sampleId, reused: true };
      }
    }
    const duplicate = await tx.read.findFirst({ where: { sample: { orderId: access.order.id }, OR: [{ file1: { in: [...paths, first.absolute, ...(second ? [second.absolute] : [])] } }, { file2: { in: [...paths, first.absolute, ...(second ? [second.absolute] : [])] } }] }, select: { id: true } });
    if (duplicate) throw new DataFilesError(409, "A selected file is already linked in this collection");
    let sample;
    if (value.sampleId) sample = await tx.sample.findFirst({ where: { id: value.sampleId, orderId: access.order.id }, select: { id: true } });
    else {
      if (await tx.sample.findFirst({ where: { orderId: access.order.id, sampleId: value.newSample!.sampleId }, select: { id: true } })) throw new DataFilesError(409, "That sample identifier already exists. Select the existing sample");
      sample = await tx.sample.create({ data: { orderId: access.order.id, sampleId: value.newSample!.sampleId, sampleTitle: value.newSample!.sampleTitle, facilityStatus: access.order.dataOrigin === "import" ? "NOT_APPLICABLE" : "WAITING" }, select: { id: true } });
    }
    if (!sample) throw new DataFilesError(400, "Sample does not belong to this collection");
    const read = await tx.read.create({ data: {
      ...(requestReadId ? { id: requestReadId } : {}),
      sampleId: sample.id, file1: first.path, file2: second?.path ?? null, checksum1: first.checksum, checksum2: second?.checksum ?? null,
      readCount1: first.records <= 2147483647 ? first.records : null, readCount2: second && second.records <= 2147483647 ? second.records : null,
      isActive: false, dataClass: value.processing === "unprocessed" ? "raw" : value.processing,
      dataClassSource: value.processingNote ? "manual" : "external_import", classificationNote: value.processingNote ?? "Processing history unknown",
      classifiedById: value.processingNote ? access.userId : null, classifiedAt: value.processingNote ? new Date() : null,
      pipelineSources: JSON.stringify(metadata),
    }, select: { id: true } });
    return { readId: read.id, sampleId: sample.id, reused: false };
  });
}

export async function addDataFilesReadSet(access: Access, input: unknown, source: "local_files" | "upload" = "local_files", signal?: AbortSignal) {
  const result = await addDataFilesReadSetImpl(access, input, source, signal);
  return { readId: result.readId, sampleId: result.sampleId };
}

async function ensurePrivateDirectory(base: string, relative: string) {
  let current = base;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(current) !== current) throw new DataFilesError(403, "Upload storage contains a symbolic link");
  }
  return current;
}

export async function uploadDataFiles(access: Access, request: Request) {
  if (!access.canManage) throw new DataFilesError(403, "You do not have permission to upload files");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new DataFilesError(400, "Use a multipart form upload");
  const bodyLimit = DATA_FILES_UPLOAD_LIMIT + 1024 * 1024;
  if (Number(request.headers.get("content-length") || 0) > bodyLimit) throw new DataFilesError(413, "Upload limit is 64 MiB. Link larger files from server storage");
  const reader = request.body?.getReader();
  if (!reader) throw new DataFilesError(400, "Upload body is missing");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > bodyLimit) { await reader.cancel(); throw new DataFilesError(413, "Upload limit is 64 MiB. Link larger files from server storage"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData(); }
  catch { throw new DataFilesError(400, "Invalid multipart upload"); }
  const first = form.get("file1"), second = form.get("file2");
  if (!(first instanceof File) || (second !== null && !(second instanceof File))) throw new DataFilesError(400, "Choose a FASTQ file to upload");
  const files = [first, ...(second instanceof File ? [second] : [])];
  if (files.some(file => !FASTQ.test(file.name) || !file.size)) throw new DataFilesError(400, "Upload nonempty FASTQ or FASTQ.gz files");
  if (files.reduce((sum, file) => sum + file.size, 0) > DATA_FILES_UPLOAD_LIMIT) throw new DataFilesError(413, "Upload limit is 64 MiB. Link larger files from server storage");
  let newSample;
  try { if (form.get("newSample")) newSample = JSON.parse(String(form.get("newSample"))); } catch { throw new DataFilesError(400, "Invalid sample metadata"); }
  const base = await configuredBase();
  const directory = await ensurePrivateDirectory(base, path.join(uploadRoot(access.order.id), "linked", randomUUID()));
  try {
    const stored: string[] = [];
    for (const [index, file] of files.entries()) {
      const name = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-200);
      const target = path.join(directory, `${index + 1}-${name}`);
      await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 });
      stored.push(path.relative(base, target));
    }
    const result = await addDataFilesReadSetImpl(access, { ...(form.get("requestId") ? { requestId: String(form.get("requestId")) } : {}),
      ...(form.get("sampleId") ? { sampleId: String(form.get("sampleId")) } : {}), ...(newSample ? { newSample } : {}),
      read1: stored[0], ...(stored[1] ? { read2: stored[1] } : {}), processing: String(form.get("processing") || "unknown"),
      ...(form.get("processingNote") ? { processingNote: String(form.get("processingNote")) } : {}) }, "upload", request.signal);
    if (result.reused) await fs.rm(directory, { recursive: true, force: true });
    return { readId: result.readId, sampleId: result.sampleId };
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
