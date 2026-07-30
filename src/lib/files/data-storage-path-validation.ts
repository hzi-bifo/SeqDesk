import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DataStoragePathInspection {
  valid: boolean;
  configuredPath?: string;
  resolvedPath?: string;
  readable: boolean;
  writable: boolean;
  error?: string;
}

/**
 * Inspect a sequencing-data directory on the SeqDesk host.
 *
 * The configured spelling is kept so a stable mount-point symlink remains
 * usable, while resolvedPath is reported for operator visibility and root
 * detection. A read-only directory is valid for discovery; callers surface
 * writable=false because uploads and pipeline write-back need write access.
 */
export async function inspectDataStoragePath(
  input: string | null | undefined
): Promise<DataStoragePathInspection> {
  const configuredPath = input?.trim() ?? "";
  if (!configuredPath) {
    return {
      valid: false,
      readable: false,
      writable: false,
      error: "No path provided",
    };
  }
  if (!path.isAbsolute(configuredPath)) {
    return {
      valid: false,
      readable: false,
      writable: false,
      error: "Data storage must use an absolute path",
    };
  }

  const normalizedPath = path.normalize(configuredPath);
  if (normalizedPath === path.parse(normalizedPath).root) {
    return {
      valid: false,
      configuredPath: normalizedPath,
      readable: false,
      writable: false,
      error: "The filesystem root cannot be used as data storage",
    };
  }

  let stats;
  try {
    const entry = await fs.lstat(normalizedPath);
    stats = entry.isSymbolicLink() ? await fs.stat(normalizedPath) : entry;
  } catch {
    return {
      valid: false,
      configuredPath: normalizedPath,
      readable: false,
      writable: false,
      error: "Directory does not exist or is not accessible",
    };
  }
  if (!stats.isDirectory()) {
    return {
      valid: false,
      configuredPath: normalizedPath,
      readable: false,
      writable: false,
      error: "Path exists but is not a directory",
    };
  }

  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(normalizedPath);
  } catch {
    return {
      valid: false,
      configuredPath: normalizedPath,
      readable: false,
      writable: false,
      error: "Directory cannot be resolved",
    };
  }
  if (resolvedPath === path.parse(resolvedPath).root) {
    return {
      valid: false,
      configuredPath: normalizedPath,
      resolvedPath,
      readable: false,
      writable: false,
      error: "The filesystem root cannot be used as data storage",
    };
  }

  try {
    await fs.access(normalizedPath, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    return {
      valid: false,
      configuredPath: normalizedPath,
      resolvedPath,
      readable: false,
      writable: false,
      error: "Directory is not readable or searchable (permission denied)",
    };
  }

  let writable = true;
  try {
    await fs.access(normalizedPath, fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    writable = false;
  }

  return {
    valid: true,
    configuredPath: normalizedPath,
    resolvedPath,
    readable: true,
    writable,
  };
}
