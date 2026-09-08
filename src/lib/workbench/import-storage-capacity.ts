import fs from "node:fs/promises";

// CAMI retains at most a 100 GiB archive/read input plus its extracted or
// recompressed output. Leave room for gzip overhead, logs and filesystem metadata.
export const CAMI_PREPARATION_BYTES = 200 * 1024 ** 3;
export const IMPORT_STORAGE_HEADROOM = 1024 ** 3;
export const STORAGE_WAITING = "Queued—waiting for enough disk space.";
export const STORAGE_UNKNOWN = "Storage availability could not be checked.";
export const PREPARATION_WAITING = "Queued—waiting for another preparation to finish.";

export class ImportStorageUnavailable extends Error {}

export async function requireImportStorage(directory: string, additionalBytes = 0): Promise<void> {
  let free: number;
  try {
    const capacity = await fs.statfs(directory);
    free = capacity.bavail * capacity.bsize;
    if (!Number.isFinite(free) || free < 0) throw new Error("Invalid filesystem capacity");
  } catch {
    throw new ImportStorageUnavailable(STORAGE_UNKNOWN);
  }
  if (free < additionalBytes + IMPORT_STORAGE_HEADROOM) {
    throw new ImportStorageUnavailable(STORAGE_WAITING);
  }
}
