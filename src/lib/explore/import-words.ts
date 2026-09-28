/**
 * What a person reads when reading a file failed for a reason of the machine, not of the table: a compressed file
 * that is not what its name says, or a disk with no room left. No closing full stop: callers put one after it.
 */
export function readFailureWords(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR" || code === "Z_STREAM_END") {
    return "This .gz file is damaged or is not gzip data. Upload it again, or without the .gz ending if it is plain text";
  }
  if (code === "ENOSPC" || code === "EDQUOT") return "The server has no space left to store this";
  return null;
}
