import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { db } from "@/lib/db";
import {
  assertPathInsideBase,
  resolveWorkbenchStorageBase,
  sanitizePathSegment,
} from "@/lib/workbench/storage";
import { getOrCreateDefaultWorkbenchWorkspace } from "@/lib/workbench/workspaces";
import { validateFastqFile } from "@/lib/workbench/fastq-validation";
import { lockWorkbenchPublicationAccess } from "./publication-access";

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024;
const SUPPORTED_UPLOAD_SUFFIXES = [
  ".fastq",
  ".fastq.gz",
  ".fq",
  ".fq.gz",
  ".fasta",
  ".fasta.gz",
  ".fa",
  ".fa.gz",
  ".fna",
  ".fna.gz",
  ".bam",
  ".cram",
  ".vcf",
  ".vcf.gz",
  ".bcf",
  ".csv",
  ".tsv",
  ".txt",
];

export class WorkbenchUploadError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 = 400
  ) {
    super(message);
    this.name = "WorkbenchUploadError";
  }
}

export function getWorkbenchUploadLimitBytes(): number {
  const configured = Number(process.env.SEQDESK_WORKBENCH_UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_BYTES;
}

export function normalizeWorkbenchUploadFilename(value: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  const basename = path.basename(decoded.trim()).replace(/[\u0000-\u001f\u007f]/g, "");
  if (!basename || basename === "." || basename === ".." || Buffer.byteLength(basename, "utf8") > 255) {
    throw new WorkbenchUploadError("A valid file name is required");
  }
  const lower = basename.toLowerCase();
  if (!SUPPORTED_UPLOAD_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    throw new WorkbenchUploadError(
      "Unsupported file type. Upload FASTQ, FASTA, BAM, CRAM, VCF, BCF, CSV, TSV, or TXT data."
    );
  }
  return basename;
}

export async function storeWorkbenchUpload(args: {
  userId: string;
  filename: string;
  contentType?: string | null;
  contentLength?: number | null;
  body: ReadableStream<Uint8Array>;
}) {
  const filename = normalizeWorkbenchUploadFilename(args.filename);
  const maxBytes = getWorkbenchUploadLimitBytes();
  if (args.contentLength != null && (!Number.isSafeInteger(args.contentLength) || args.contentLength < 0)) {
    throw new WorkbenchUploadError("Invalid upload content length");
  }
  if (args.contentLength && args.contentLength > maxBytes) {
    throw new WorkbenchUploadError("Upload exceeds the configured size limit", 413);
  }

  const workspace = await getOrCreateDefaultWorkbenchWorkspace(args.userId);
  const storage = await resolveWorkbenchStorageBase();
  const uploadId = crypto.randomUUID();
  const uploadDir = path.join(storage.baseDir, "uploads", workspace.id, uploadId);
  const suffix = [...SUPPORTED_UPLOAD_SUFFIXES].sort((a, b) => b.length - a.length)
    .find((item) => filename.toLowerCase().endsWith(item))!;
  const storedFilename = `${sanitizePathSegment(filename.slice(0, -suffix.length))}${suffix}`;
  const finalPath = path.join(uploadDir, storedFilename);
  const temporaryPath = `${finalPath}.part`;
  assertPathInsideBase(finalPath, storage.baseDir, "Workbench upload path");

  await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const hash = crypto.createHash("sha256");
  let bytesWritten = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > maxBytes) {
        callback(new WorkbenchUploadError("Upload exceeds the configured size limit", 413));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(args.body as never),
      meter,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })
    );
    if (bytesWritten === 0) {
      throw new WorkbenchUploadError("The uploaded file is empty");
    }
    if (args.contentLength != null && bytesWritten !== args.contentLength) {
      throw new WorkbenchUploadError("Upload length does not match the declared content length");
    }
    if (/\.(fastq|fq)(\.gz)?$/.test(filename.toLowerCase())) {
      try {
        await validateFastqFile(temporaryPath, { gzip: suffix.endsWith(".gz"), maxExpandedBytes: maxBytes });
      } catch {
        throw new WorkbenchUploadError("Invalid, unsupported, or oversized FASTQ content");
      }
    }
    await fs.rename(temporaryPath, finalPath);

    const checksumSha256 = hash.digest("hex");
    const linkedAt = new Date();
    const dataset = await db.$transaction(async (tx) => {
      await lockWorkbenchPublicationAccess(tx, workspace.id, args.userId);
      const created = await tx.workbenchDataset.create({
        data: {
          providerId: "local-upload",
          cacheKey: `local-upload:${workspace.id}:${uploadId}`,
          name: filename,
          description: "Uploaded from local disk",
          sourceType: "local-upload",
          sourceMetadata: JSON.stringify({
            originalFilename: filename,
            contentType: args.contentType || "application/octet-stream",
            uploadedAt: linkedAt.toISOString(),
            validation: /\.(fastq|fq)(\.gz)?$/.test(filename.toLowerCase())
              ? "four-line-fastq; pairing-not-validated" : "content-validation-pending",
          }),
          storagePath: finalPath,
          sizeBytes: BigInt(bytesWritten),
          checksumSha256,
          status: "ready",
        },
      });
      await tx.workbenchWorkspaceDataset.create({
        data: {
          workspaceId: workspace.id,
          datasetId: created.id,
          linkedAt,
        },
      });
      return created;
    });

    return {
      id: dataset.id,
      providerId: dataset.providerId,
      name: dataset.name,
      description: dataset.description,
      sourceType: dataset.sourceType,
      sizeBytes: bytesWritten,
      checksumSha256,
      status: dataset.status,
      linkedAt: linkedAt.toISOString(),
      createdAt: dataset.createdAt.toISOString(),
      updatedAt: dataset.updatedAt.toISOString(),
    };
  } catch (error) {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
