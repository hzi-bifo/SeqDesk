/**
 * A file named .gz must start with the gzip signature (1f 8b). Plain text saved as reads.fastq.gz used to be
 * accepted on upload and only failed hours later inside a pipeline step; now the upload says so at once.
 */
export const GZIP_NAME = /\.gz$/i;

export function looksLikeGzip(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/** The message to refuse an upload with, or null when the name and the first bytes agree (or the file is empty). */
export function gzipMismatch(name: string, head: Uint8Array): string | null {
  if (!GZIP_NAME.test(name.trim()) || head.length === 0 || looksLikeGzip(head)) return null;
  return "This file is named .gz but is not gzip-compressed. Compress it with gzip or remove the .gz ending, then upload it again.";
}
