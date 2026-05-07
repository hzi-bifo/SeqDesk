import { promises as fs } from "fs";
import path from "path";

export interface OutputDirValidation {
  ok: boolean;
  reason?: string;
  realpath?: string;
}

/**
 * Resolve `outputDir` and `outputRoot` to canonical real paths and verify that
 * `outputDir` is contained in `outputRoot`. This is the gate that prevents a
 * malicious or careless admin from pointing the watcher at `/`, escaping via
 * symlinks, or watching a directory the operator never intended.
 *
 * The realpath comparison handles symlink loops and `..` traversal naturally;
 * a string-only check would not.
 */
export async function validateOutputDirUnderRoot(
  outputDir: string,
  outputRoot: string,
): Promise<OutputDirValidation> {
  if (!outputRoot || outputRoot.trim().length === 0) {
    return { ok: false, reason: "MinKNOW outputRoot is not configured (Application Settings → MinKNOW Stream)" };
  }
  if (!outputDir || outputDir.trim().length === 0) {
    return { ok: false, reason: "outputDir is required" };
  }
  if (!path.isAbsolute(outputDir)) {
    return { ok: false, reason: "outputDir must be an absolute path" };
  }
  if (!path.isAbsolute(outputRoot)) {
    return { ok: false, reason: "Configured outputRoot must be an absolute path" };
  }

  let realDir: string;
  let realRoot: string;
  try {
    realDir = await fs.realpath(outputDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `outputDir does not exist or is unreadable: ${message}` };
  }
  try {
    realRoot = await fs.realpath(outputRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Configured outputRoot does not exist or is unreadable: ${message}` };
  }

  // path.relative returns "" when paths are equal, "..." prefix when escaping.
  const relative = path.relative(realRoot, realDir);
  const escapes = relative.startsWith("..") || path.isAbsolute(relative);
  if (escapes) {
    return {
      ok: false,
      reason: `outputDir resolves to ${realDir} which is not under the configured outputRoot ${realRoot}`,
    };
  }

  return { ok: true, realpath: realDir };
}
