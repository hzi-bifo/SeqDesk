import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Safety limits are not reservations. Each import is budgeted from its own size.
export const CAMI_MAX_BYTES = 100 * 1024 ** 3;
export const IMPORT_STORAGE_HEADROOM = 1024 ** 3;
export const STORAGE_WAITING = "Queued—waiting for enough disk space.";
export const STORAGE_UNKNOWN = "Storage availability could not be checked.";
export const PREPARATION_WAITING = "Queued—waiting for another preparation to finish.";

export class ImportStorageUnavailable extends Error {
  constructor(message: string, readonly additionalBytes = 0) {
    super(message);
    this.name = "ImportStorageUnavailable";
  }
}

function validBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - IMPORT_STORAGE_HEADROOM;
}

/** Initial estimate, refined against the archive entry and validated FASTQ later.
 * CAMI archives contain gzip-compressed reads. Keep room for the archive, its
 * reads and paired outputs, rather than reserving the global 100 GiB limits. */
export function estimateCamiPreparationBytes(archiveBytes: unknown): number {
  if (!validBytes(archiveBytes) || archiveBytes === 0 || archiveBytes > CAMI_MAX_BYTES) {
    throw new Error("CAMI archive size is missing or invalid. Preview the import again.");
  }
  return Math.min(archiveBytes * 3, CAMI_MAX_BYTES * 2);
}

/** Bound both gzip outputs from the measured, validated uncompressed input.
 * With default window/memory settings, zlib's worst-case overhead is below 1%.
 * The extra 64 KiB covers both gzip wrappers, small blocks and a final newline.
 * https://www.zlib.net/zlib_tech.html
 */
export function benchmarkReadOutputBytes(expandedBytes: number): number {
  if (!validBytes(expandedBytes) || expandedBytes === 0 || expandedBytes > CAMI_MAX_BYTES) {
    throw new Error("Invalid benchmark read size");
  }
  return Math.ceil(expandedBytes * 1.01) + 64 * 1024;
}

export async function requireImportStorage(directory: string, additionalBytes = 0): Promise<void> {
  if (!validBytes(additionalBytes)) throw new Error("Invalid import storage requirement");
  let free: number;
  try {
    const capacity = await fs.statfs(directory);
    free = capacity.bavail * capacity.bsize;
    if (!Number.isFinite(free) || free < 0) throw new Error("Invalid filesystem capacity");
  } catch {
    throw new ImportStorageUnavailable(STORAGE_UNKNOWN);
  }
  if (free < additionalBytes + IMPORT_STORAGE_HEADROOM) {
    const gib = (Math.ceil((additionalBytes + IMPORT_STORAGE_HEADROOM) / 1024 ** 3 * 100) / 100).toFixed(2);
    // Report this import's requirement, not installation-wide free-space figures.
    throw new ImportStorageUnavailable(`${STORAGE_WAITING} This import requires ${gib} GiB of free working space, including a 1 GiB reserve.`, additionalBytes);
  }
}

const REQUIREMENT_FILE = "storage-requirement.json";

/** Keep learned peak requirements in the job directory, which survives partial
 * cache cleanup. A large expansion must not cause an endless download/retry loop.
 * This leaves signed previews, idempotency keys and scientific metadata unchanged. */
export async function readImportStorageRequirement(jobDirectory: string): Promise<number> {
  try {
    const file = path.join(jobDirectory, REQUIREMENT_FILE);
    if ((await fs.stat(file)).size > 1024) throw new Error("Invalid storage requirement file");
    const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    const bytes = (value as { additionalBytes?: unknown } | null)?.additionalBytes;
    if (!validBytes(bytes)) throw new Error("Invalid stored import storage requirement");
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new ImportStorageUnavailable(STORAGE_UNKNOWN);
  }
}

export async function rememberImportStorageRequirement(jobDirectory: string, additionalBytes: number): Promise<void> {
  if (!validBytes(additionalBytes)) throw new Error("Invalid import storage requirement");
  const required = Math.max(additionalBytes, await readImportStorageRequirement(jobDirectory));
  await fs.mkdir(jobDirectory, { recursive: true });
  const file = path.join(jobDirectory, REQUIREMENT_FILE);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ additionalBytes: required }), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
