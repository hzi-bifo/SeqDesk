import fs from "fs/promises";
import path from "path";
import type { UpdateProgress } from "./types";

const INSTALL_DIR = process.cwd();
const STATUS_FILE = path.join(INSTALL_DIR, ".update-status.json");
const LOCK_FILE = path.join(INSTALL_DIR, ".update-lock");
const LOCK_TTL_MS = 60 * 60 * 1000;

export interface UpdateStatus extends UpdateProgress {
  updatedAt: string;
  targetVersion?: string;
}

export async function readUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const raw = await fs.readFile(STATUS_FILE, "utf-8");
    return JSON.parse(raw) as UpdateStatus;
  } catch {
    return null;
  }
}

export async function writeUpdateStatus(
  status: UpdateProgress,
  options?: { targetVersion?: string }
): Promise<void> {
  const payload: UpdateStatus = {
    ...status,
    targetVersion: options?.targetVersion,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(STATUS_FILE, JSON.stringify(payload, null, 2));
}

export async function clearUpdateStatus(): Promise<void> {
  await fs.rm(STATUS_FILE, { force: true });
}

export async function isUpdateInProgress(): Promise<boolean> {
  const status = await readUpdateStatus();
  if (!status) return false;
  return !["idle", "complete", "error"].includes(status.status);
}

export async function acquireUpdateLock(): Promise<boolean> {
  try {
    const stat = await fs.stat(LOCK_FILE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < LOCK_TTL_MS) {
      return false;
    }
    await fs.rm(LOCK_FILE, { force: true });
  } catch {
    // No lock file or failed to stat; proceed.
  }

  try {
    await fs.writeFile(
      LOCK_FILE,
      JSON.stringify(
        { createdAt: new Date().toISOString(), pid: process.pid },
        null,
        2
      ),
      { flag: "wx" }
    );
    return true;
  } catch {
    return false;
  }
}

export async function releaseUpdateLock(): Promise<void> {
  await fs.rm(LOCK_FILE, { force: true });
}
