import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Build the filesystem directory for one pipeline run.
 *
 * The human-readable run number is not sufficient as a directory identity:
 * run numbers are allocated with a read-max/write pattern, so two concurrent
 * preparations can temporarily calculate the same value. The database run ID
 * is unique and is therefore part of every directory name.
 *
 * Prisma's normal lowercase CUID/UUID values remain readable. Any other value
 * is encoded completely as lowercase hexadecimal. The `id-`/`hex-` namespace
 * markers make the mapping injective and filesystem-safe without replacing or
 * truncating characters, even on a case-insensitive filesystem.
 */
export function buildPipelineRunFolder(
  pipelineRunDir: string,
  runNumber: string,
  runId: string
): string {
  const normalizedRunNumber = runNumber.trim();
  if (
    !normalizedRunNumber ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedRunNumber)
  ) {
    throw new Error(`Invalid pipeline run number: ${runNumber}`);
  }

  if (!runId) {
    throw new Error("Pipeline run ID is required");
  }
  const encodedRunId = /^[a-z0-9_-]+$/.test(runId)
    ? `id-${runId}`
    : `hex-${Buffer.from(runId, "utf8").toString("hex")}`;

  return path.resolve(
    pipelineRunDir,
    `${normalizedRunNumber}--${encodedRunId}`
  );
}

/**
 * Create one run directory and return its canonical on-disk identity.
 *
 * `pipelineRunDir` may itself be a symlink to shared storage. Persisting the
 * configured alias makes scheduler WorkDir checks fail when SLURM reports the
 * physical path instead. Resolve only after creation so every path component
 * exists, then use the canonical folder for scripts, database writes, and logs.
 */
export async function preparePipelineRunDirectory(
  pipelineRunDir: string,
  runNumber: string,
  runId: string
): Promise<string> {
  const requestedRoot = path.resolve(pipelineRunDir);
  const requestedRunFolder = buildPipelineRunFolder(
    requestedRoot,
    runNumber,
    runId
  );
  let createdRunFolder = false;

  try {
    await fs.mkdir(requestedRoot, { recursive: true });
    const canonicalRoot = await fs.realpath(requestedRoot);

    try {
      // Create only the generated leaf here. A pre-existing leaf is accepted
      // for safe launch retries only after lstat proves it is a real directory.
      await fs.mkdir(requestedRunFolder);
      createdRunFolder = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const runFolderStat = await fs.lstat(requestedRunFolder);
    if (
      runFolderStat.isSymbolicLink() ||
      !runFolderStat.isDirectory()
    ) {
      throw new Error(
        "Pipeline run folder must be a real directory, not a file or symlink"
      );
    }

    const canonicalRunFolder = await fs.realpath(requestedRunFolder);
    if (path.dirname(canonicalRunFolder) !== canonicalRoot) {
      throw new Error(
        "Pipeline run folder resolved outside the configured run directory"
      );
    }
    await fs.mkdir(path.join(canonicalRunFolder, "logs"), { recursive: true });
    return canonicalRunFolder;
  } catch (error) {
    // Remove only a leaf created by this call. Never follow or delete a
    // pre-existing path that failed the directory/scope checks above.
    if (createdRunFolder) {
      await fs
        .rm(requestedRunFolder, { recursive: true, force: true })
        .catch(() => {});
    }
    throw error;
  }
}

/**
 * Stable SLURM job identity used by launch, cancellation, and orphan cleanup.
 * SLURM job names are deliberately limited to a conservative safe character
 * set and length because the value is written directly into an SBATCH header.
 */
export function buildSeqDeskSlurmJobName(runId: string): string {
  const safeRunId = runId
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 48);
  return `seqdesk-${safeRunId}`;
}
