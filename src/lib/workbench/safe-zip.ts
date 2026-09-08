import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Open } from "unzipper";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export function safeZipEntryPath(value: string): string {
  const clean = value.endsWith("/") ? value.slice(0, -1) : value;
  if (!clean || clean.includes("\\") || /[\x00-\x1f\x7f:]/.test(clean) ||
      clean.split("/").some((part) => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255)) {
    throw new Error("Unsafe ZIP entry path");
  }
  return clean;
}

/** Extract into a new private directory only. No symlinks, ZIP64, overwrites or unbounded expansion. */
export async function extractWorkbenchZip(zipPath: string, destination: string, maxBytes = 20 * 1024 ** 3) {
  const handle = await fs.open(zipPath, "r");
  try {
    const { size } = await handle.stat();
    const tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > tail.length || end + 22 + tail.readUInt16LE(end + 20) !== tail.length) {
      throw new Error("Invalid ZIP directory");
    }
    const count = tail.readUInt16LE(end + 10);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) ||
        count !== tail.readUInt16LE(end + 8) || count > 10000 ||
        tail.readUInt32LE(end + 12) > 16 * 1024 ** 2 || tail.readUInt32LE(end + 16) === 0xffffffff) {
      throw new Error("Unsupported or oversized ZIP directory (ZIP64 is not supported)");
    }
  } finally { await handle.close(); }
  const archive = await Open.file(zipPath);
  const names = new Set<string>();
  let declared = 0;
  for (const entry of archive.files) {
    const name = safeZipEntryPath(entry.path);
    const key = name.normalize("NFC").toLowerCase();
    if (names.has(key)) throw new Error("Colliding ZIP entry paths");
    names.add(key);
    const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
    if ((kind && kind !== 0x8000 && kind !== 0x4000) || (entry.flags & 1)) {
      throw new Error("ZIP links, special files and encrypted entries are unsupported");
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
        entry.uncompressedSize > Math.max(1, entry.compressedSize) * 2000) {
      throw new Error("ZIP entry exceeds expansion limits");
    }
    declared += entry.uncompressedSize;
    if (declared > maxBytes) throw new Error("ZIP expanded size exceeds limit");
  }
  // A caller may not give us a previously published/cache directory to replace.
  await fs.mkdir(destination, { mode: 0o700 });
  let written = 0;
  try {
    for (const entry of archive.files) {
      const output = path.join(destination, safeZipEntryPath(entry.path));
      if (entry.type === "Directory") { await fs.mkdir(output, { recursive: true, mode: 0o700 }); continue; }
      await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      let bytes = 0;
      let crc = 0xffffffff;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        written += chunk.length;
        if (written > maxBytes || bytes > entry.uncompressedSize) return callback(new Error("ZIP expanded size exceeds limit"));
        for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
        callback(null, chunk);
      } });
      await pipeline(entry.stream(), meter, createWriteStream(output, { flags: "wx", mode: 0o600 }));
      if (bytes !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
        throw new Error("ZIP entry integrity verification failed");
      }
    }
  } catch (error) {
    // This directory was created exclusively above and was never published.
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { bytes: written, entries: archive.files.length };
}
