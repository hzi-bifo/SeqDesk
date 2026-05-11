import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import readline from "readline";

/**
 * Count reads and total bases in a FASTQ file. FASTQ is 4 lines per record:
 *   @header  /  sequence  /  +  /  quality
 * so reads = lineCount / 4 and bases = sum of every-4n+1 (0-indexed: 1) line lengths.
 *
 * Supports plain `.fastq` and gzipped `.fastq.gz` (or `.fq.gz`).
 * Returns null on parse error (malformed file, partial write, etc.) so callers
 * can fall back to byte-size estimates.
 */
export async function countFastqStats(
  filePath: string,
): Promise<{ reads: number; bases: number } | null> {
  try {
    const rawStream = createReadStream(filePath);
    const isGz = filePath.endsWith(".gz");
    const stream = isGz ? rawStream.pipe(createGunzip()) : rawStream;
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineIdx = 0;
    let reads = 0;
    let bases = 0;
    for await (const line of rl) {
      if (lineIdx % 4 === 1) {
        bases += line.length;
        reads += 1;
      }
      lineIdx += 1;
    }
    if (lineIdx % 4 !== 0) return null;
    return { reads, bases };
  } catch {
    return null;
  }
}
