import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, rm, stat } from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { safeJoin } from "@/lib/files";

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

export function sanitizeSequencingFilename(originalName: string): string {
  const baseName = path.basename(originalName);
  const parts = baseName.split(".");
  if (parts.length <= 1) {
    return sanitizePathSegment(baseName);
  }

  const extension = parts.pop();
  const stem = sanitizePathSegment(parts.join("."));
  return extension ? `${stem}.${sanitizePathSegment(extension)}` : stem;
}

export function buildSequencingUploadTempRelativePath(
  orderId: string,
  uploadId: string,
  originalName: string
): string {
  const safeName = sanitizeSequencingFilename(originalName);
  return path.join("_uploads", "orders", orderId, "_tmp", `${uploadId}-${safeName}.part`);
}

export function buildSequencingReadUploadRelativePath(
  orderId: string,
  sampleIdentifier: string,
  uploadId: string,
  targetRole: string,
  originalName: string
): string {
  const safeName = sanitizeSequencingFilename(originalName);
  const safeSample = sanitizePathSegment(sampleIdentifier);
  const safeRole = sanitizePathSegment(targetRole.toUpperCase());
  return path.join(
    "_uploads",
    "orders",
    orderId,
    "samples",
    safeSample,
    "reads",
    `${uploadId}-${safeRole}-${safeName}`
  );
}

export function buildSequencingArtifactUploadRelativePath(
  orderId: string,
  uploadId: string,
  stage: string,
  originalName: string,
  sampleIdentifier?: string | null
): string {
  const safeName = sanitizeSequencingFilename(originalName);
  const safeStage = sanitizePathSegment(stage);

  if (sampleIdentifier) {
    const safeSample = sanitizePathSegment(sampleIdentifier);
    return path.join(
      "_uploads",
      "orders",
      orderId,
      "samples",
      safeSample,
      "artifacts",
      safeStage,
      `${uploadId}-${safeName}`
    );
  }

  return path.join(
    "_uploads",
    "orders",
    orderId,
    "order-artifacts",
    safeStage,
    `${uploadId}-${safeName}`
  );
}

export async function ensureSequencingParentDirectory(
  basePath: string,
  relativePath: string
): Promise<string> {
  const absolutePath = safeJoin(basePath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

export async function writeSequencingUploadChunk(
  basePath: string,
  relativePath: string,
  body: ReadableStream<Uint8Array>,
  overwrite: boolean
): Promise<void> {
  const absolutePath = await ensureSequencingParentDirectory(basePath, relativePath);
  const nodeReadable = Readable.fromWeb(
    body as unknown as Parameters<typeof Readable.fromWeb>[0]
  );
  const writeStream = createWriteStream(absolutePath, { flags: overwrite ? "w" : "a" });
  nodeReadable.pipe(writeStream);
  await finished(writeStream);
}

export async function finalizeSequencingUpload(
  basePath: string,
  tempRelativePath: string,
  finalRelativePath: string
): Promise<void> {
  const tempAbsolutePath = safeJoin(basePath, tempRelativePath);
  const finalAbsolutePath = await ensureSequencingParentDirectory(basePath, finalRelativePath);
  await rename(tempAbsolutePath, finalAbsolutePath);
}

export async function removeSequencingRelativePath(
  basePath: string,
  relativePath: string
): Promise<void> {
  const absolutePath = safeJoin(basePath, relativePath);
  await rm(absolutePath, { force: true });
}

export async function statSequencingRelativePath(
  basePath: string,
  relativePath: string
): Promise<{ size: bigint; modifiedAt: Date }> {
  const absolutePath = safeJoin(basePath, relativePath);
  const stats = await stat(absolutePath);
  return {
    size: BigInt(stats.size),
    modifiedAt: stats.mtime,
  };
}

export async function calculateMd5ForRelativePath(
  basePath: string,
  relativePath: string
): Promise<string> {
  const absolutePath = safeJoin(basePath, relativePath);
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(absolutePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
