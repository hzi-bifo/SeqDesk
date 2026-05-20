import fs from "fs/promises";
import path from "path";
import type { UpdateProgress } from "./types";

const INSTALL_DIR = process.cwd();
const RELEASES_DIR_NAME = "releases";
const CURRENT_LINK_NAME = "current";
const STATUS_FILE_NAME = ".update-status.json";
const STATE_FILE_NAME = ".update-state.json";
const LOCK_FILE_NAME = ".update-lock";
const LOCK_TTL_MS = 60 * 60 * 1000;

export interface UpdateStatus extends UpdateProgress {
  updatedAt: string;
  targetVersion?: string;
}

export type UpdateStatePhase =
  | "preparing"
  | "staged"
  | "activating"
  | "migrating"
  | "complete"
  | "error"
  | "rollback_started"
  | "rolled_back";

export interface UpdateState {
  phase: UpdateStatePhase;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  previousRelease?: string | null;
  targetRelease?: string | null;
  activeRelease?: string | null;
  targetVersion?: string | null;
  error?: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function getUpdateRootDir(baseDir: string = INSTALL_DIR): Promise<string> {
  const parentDir = path.dirname(baseDir);
  const grandparentDir = path.dirname(parentDir);

  if (
    path.basename(baseDir) === CURRENT_LINK_NAME &&
    await pathExists(path.join(parentDir, RELEASES_DIR_NAME))
  ) {
    return parentDir;
  }

  if (path.basename(parentDir) === RELEASES_DIR_NAME) {
    return grandparentDir;
  }

  if (
    await pathExists(path.join(baseDir, CURRENT_LINK_NAME)) ||
    await pathExists(path.join(baseDir, RELEASES_DIR_NAME))
  ) {
    return baseDir;
  }

  return baseDir;
}

async function updateFilePath(fileName: string): Promise<string> {
  return path.join(await getUpdateRootDir(), fileName);
}

export async function readUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const raw = await fs.readFile(await updateFilePath(STATUS_FILE_NAME), "utf-8");
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

  await fs.writeFile(await updateFilePath(STATUS_FILE_NAME), JSON.stringify(payload, null, 2));
}

export async function clearUpdateStatus(): Promise<void> {
  await fs.rm(await updateFilePath(STATUS_FILE_NAME), { force: true });
}

export async function readUpdateState(): Promise<UpdateState | null> {
  try {
    const raw = await fs.readFile(await updateFilePath(STATE_FILE_NAME), "utf-8");
    return JSON.parse(raw) as UpdateState;
  } catch {
    return null;
  }
}

export async function writeUpdateState(
  state: Omit<UpdateState, "updatedAt"> & { updatedAt?: string }
): Promise<UpdateState> {
  const payload: UpdateState = {
    ...state,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
  await fs.writeFile(await updateFilePath(STATE_FILE_NAME), JSON.stringify(payload, null, 2));
  return payload;
}

export async function patchUpdateState(updates: Partial<UpdateState>): Promise<UpdateState> {
  const now = new Date().toISOString();
  const current = await readUpdateState();
  const payload: UpdateState = {
    phase: updates.phase || current?.phase || "preparing",
    startedAt: updates.startedAt || current?.startedAt || now,
    ...current,
    ...updates,
    updatedAt: now,
  };
  await fs.writeFile(await updateFilePath(STATE_FILE_NAME), JSON.stringify(payload, null, 2));
  return payload;
}

export async function isUpdateInProgress(): Promise<boolean> {
  const status = await readUpdateStatus();
  if (!status) return false;
  return !["idle", "complete", "error"].includes(status.status);
}

export async function acquireUpdateLock(): Promise<boolean> {
  const lockFile = await updateFilePath(LOCK_FILE_NAME);
  try {
    const stat = await fs.stat(lockFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < LOCK_TTL_MS) {
      return false;
    }
    await fs.rm(lockFile, { force: true });
  } catch {
    // No lock file or failed to stat; proceed.
  }

  try {
    await fs.writeFile(
      lockFile,
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
  await fs.rm(await updateFilePath(LOCK_FILE_NAME), { force: true });
}
