import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createHash } from "node:crypto";

/** Bounded four-line FASTQ validation. Wrapped/colour-space FASTQ is not supported. */
export async function validateFastqFile(filePath: string, options: {
  gzip: boolean;
  maxExpandedBytes: number;
  maxLineBytes?: number;
  signal?: AbortSignal;
}): Promise<{ records: number; expandedBytes: number; readNamesSha256: string }> {
  const names = createHash("sha256");
  const source = createReadStream(filePath);
  const stream = options.gzip ? source.pipe(createGunzip()) : source;
  const forwardError = (error: Error) => stream.destroy(error);
  if (stream !== source) source.on("error", forwardError);
  let pending = "";
  let lineIndex = 0;
  let sequenceLength = 0;
  let expandedBytes = 0;
  const maxLineBytes = options.maxLineBytes ?? 16 * 1024 * 1024;
  function line(value: string) {
    const text = value.endsWith("\r") ? value.slice(0, -1) : value;
    if (text.length > maxLineBytes) throw new Error("FASTQ line exceeds the supported length");
    switch (lineIndex % 4) {
      case 0:
        if (!/^@\S+/.test(text)) throw new Error("Invalid FASTQ record header");
        names.update(text.slice(1).split(/\s/)[0].replace(/\/[12]$/, "") + "\n");
        break;
      case 1:
        if (!/^[ACGTUNRYKMSWBDHVactgunrykmswbdhv]+$/.test(text)) throw new Error("Invalid or unsupported FASTQ sequence");
        sequenceLength = text.length;
        break;
      case 2:
        if (!text.startsWith("+")) throw new Error("Invalid FASTQ separator");
        break;
      case 3:
        if (text.length !== sequenceLength || !/^[!-~]+$/.test(text)) throw new Error("FASTQ quality length or encoding is invalid");
        break;
    }
    lineIndex += 1;
  }
  try {
    for await (const chunk of stream) {
      options.signal?.throwIfAborted();
      expandedBytes += chunk.length;
      if (expandedBytes > options.maxExpandedBytes) throw new Error("FASTQ expanded size exceeds the configured limit");
      pending += chunk.toString("latin1");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > maxLineBytes) throw new Error("FASTQ line exceeds the supported length");
    }
    if (pending) line(pending);
    if (!lineIndex || lineIndex % 4 !== 0) throw new Error("Empty or truncated FASTQ records");
    return { records: lineIndex / 4, expandedBytes, readNamesSha256: names.digest("hex") };
  } finally {
    source.removeListener("error", forwardError);
    stream.destroy();
    source.destroy();
  }
}
