import { Buffer } from "node:buffer";
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
