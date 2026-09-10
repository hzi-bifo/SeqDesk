import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { extract } from "tar-stream";
import { validateFastqFile } from "./fastq-validation";
import { benchmarkReadOutputBytes, CAMI_MAX_BYTES, requireImportStorage } from "./import-storage-capacity";

const MAX = CAMI_MAX_BYTES;
/** Never materialize archive paths. Only one anonymous reads file is accepted;
 * ancillary benchmark truth is drained, never published as scientific inputs. */
export async function extractBenchmarkReads(archive: string, directory: string, signal?: AbortSignal) {
  await fs.mkdir(directory, { recursive: false });
  const output = path.join(directory, "input.fastq.gz");
  const tar = extract();
  let count = 0, total = 0, found = false;
  let headerBytes = Buffer.alloc(0), remaining = 0, rawEntries = 0;
  const seen = new Set<string>();
  tar.on("entry", (header, stream, next) => {
    void (async () => {
      if (++count > 1000 || !Number.isSafeInteger(header.size) || header.size < 0 ||
          header.name.includes("\\") || header.name.startsWith("/") || /[\x00-\x1f:]/.test(header.name) ||
          header.name.split("/").includes("..") || !["file", "directory"].includes(header.type)) throw new Error("Unsafe benchmark archive entry");
      const key = header.name.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new Error("Duplicate benchmark archive entry");
      seen.add(key);
      if (header.type === "directory") { stream.resume(); await once(stream, "end"); return; }
      if (header.size > MAX) throw new Error("Benchmark archive entry exceeds size limit");
      const reads = /(?:^|\/)anonymous_reads\.(?:fq|fastq)\.gz$/.test(header.name);
      if (reads && found) throw new Error("Multiple reads files require an explicit collection layout");
      if (reads) {
        found = true;
        // Only this entry is written to disk; truth/ancillary entries are drained.
        await requireImportStorage(directory, header.size);
        await pipeline(stream, createWriteStream(output, { flags: "wx" }), { signal });
      } else { for await (const _chunk of stream) { signal?.throwIfAborted(); } }
    })().then(() => next(), error => { tar.destroy(error); });
  });
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    total += chunk.length;
    try {
      if (total > MAX) throw new Error("Benchmark archive expanded size exceeds 100 GiB");
      // Guard headers before tar-stream can buffer GNU/PAX extension bodies.
      let offset = 0;
      while (offset < chunk.length) {
        if (remaining) { const skip = Math.min(remaining, chunk.length - offset); remaining -= skip; offset += skip; continue; }
        const size = Math.min(512 - headerBytes.length, chunk.length - offset);
        headerBytes = Buffer.concat([headerBytes, chunk.subarray(offset, offset + size)]); offset += size;
        if (headerBytes.length !== 512) continue;
        if (headerBytes.some(byte => byte !== 0)) {
          if (++rawEntries > 1000 || ![0, 48, 53].includes(headerBytes[156])) throw new Error("Unsupported tar extension or special entry");
          const sizeField = headerBytes.subarray(124, 136);
          const rawSize = sizeField.toString("ascii");
          if (sizeField.some(byte => byte > 127) || !/^ *[0-7]+[ \0]*$/.test(rawSize)) throw new Error("Unsupported tar size encoding");
          const entrySize = parseInt(rawSize.trim(), 8);
          if (!Number.isSafeInteger(entrySize) || entrySize > MAX || (headerBytes[156] === 53 && entrySize !== 0)) throw new Error("Invalid tar entry size");
          remaining = Math.ceil(entrySize / 512) * 512;
        }
        headerBytes = Buffer.alloc(0);
      }
      callback(null, chunk);
    } catch (error) { callback(error as Error); }
  } });
  await pipeline(createReadStream(archive), createGunzip(), meter, tar, { signal });
  if (!found) throw new Error("Unsupported CAMI layout: expected anonymous_reads.fq.gz");
  return output;
}

export function pairedReadIdentity(header: string, mate: 1 | 2) {
  const match = /^@(\S+)\/([12])(?:\s|$)/.exec(header);
  if (!match || Number(match[2]) !== mate) throw new Error("Unsupported or mismatched interleaved mate identifiers");
  return match[1];
}

export async function prepareBenchmarkReads(input: string, technology: "short" | "long", signal?: AbortSignal) {
  const validated = await validateFastqFile(input, { gzip: true, maxExpandedBytes: MAX, signal });
  if (technology === "long") return [{ ...await describeRead(input), records: validated.records }];
  await requireImportStorage(path.dirname(input), benchmarkReadOutputBytes(validated.expandedBytes));
  const outputs = [path.join(path.dirname(input), "R1.fastq.gz"), path.join(path.dirname(input), "R2.fastq.gz")];
  const writers = outputs.map(() => createGzip({ level: 1 }));
  const tasks = writers.map((writer, i) => pipeline(writer, createWriteStream(outputs[i], { flags: "wx" }), { signal }));
  // Attach handlers immediately so a disk error cannot become unhandled while parsing.
  let writeError: unknown;
  tasks.forEach(task => { void task.catch(error => { writeError = error; }); });
  const source = createReadStream(input), gunzip = createGunzip();
  const incoming = pipeline(source, gunzip, { signal });
  void incoming.catch(() => {});
  let pending = "", record: string[] = [], records = 0, firstId = "";
  const buffers = ["", ""];
  async function flush(i: number) {
    if (writeError) throw writeError;
    if (!buffers[i]) return;
    // Preserve input bytes, including non-ASCII read names. UTF-8 re-encoding
    // here would corrupt those names and invalidate the measured output bound.
    if (!writers[i].write(buffers[i], "latin1")) await once(writers[i], "drain");
    buffers[i] = "";
  }
  async function line(text: string) {
    record.push(text.endsWith("\r") ? text.slice(0, -1) : text);
    if (record.length !== 4) return;
    const mate = records % 2;
    const identity = pairedReadIdentity(record[0], mate === 0 ? 1 : 2);
    if (mate === 0) firstId = identity;
    else if (identity !== firstId) throw new Error("Interleaved read pair IDs do not match");
    buffers[mate] += record.join("\n") + "\n";
    if (buffers[mate].length >= 256 * 1024) await flush(mate);
    records++; record = [];
  }
  try {
    for await (const chunk of gunzip) {
      signal?.throwIfAborted();
      if (writeError) throw writeError;
      pending += chunk.toString("latin1");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) { await line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      if (pending.length > 16 * 1024 ** 2) throw new Error("FASTQ line too long");
    }
    await incoming;
    if (pending) await line(pending);
    if (!records || record.length || records % 2) throw new Error("Incomplete interleaved read pair");
    await flush(0); await flush(1);
    writers.forEach(writer => writer.end());
    await Promise.all(tasks);
    await fs.unlink(input);
    return Promise.all(outputs.map(async file => ({ ...await describeRead(file), records: records / 2 })));
  } catch (error) {
    source.destroy(); gunzip.destroy(); writers.forEach(writer => writer.destroy(error as Error));
    await Promise.allSettled(tasks); throw error;
  }
}

async function describeRead(file: string) {
  const hash = createHash("sha256");
  const md5 = createHash("md5");
  for await (const chunk of createReadStream(file)) { hash.update(chunk); md5.update(chunk); }
  return { path: file, sha256: hash.digest("hex"), md5: md5.digest("hex"), bytes: (await fs.stat(file)).size };
}
