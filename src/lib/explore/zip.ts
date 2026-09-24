/**
 * A small ZIP writer for capsules: deflated entries written one after the
 * other to a file, then the central directory. No ZIP64, so a capsule stays
 * under 4 GB (the caller withholds large inputs by hash instead).
 */
import fs from "fs/promises";
import zlib from "zlib";

export interface ZipEntryInfo {
  path: string;
  size: number;
  sha256: string;
}

const LIMIT = 0xffffffff;

function crc32(data: Buffer): number {
  return zlib.crc32(data) >>> 0;
}

function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export class ZipWriter {
  private handle: fs.FileHandle | null = null;
  private offset = 0;
  private central: Buffer[] = [];
  private names = new Set<string>();

  constructor(private readonly target: string, private readonly when = new Date()) {}

  async open(): Promise<void> {
    this.handle = await fs.open(this.target, "w");
  }

  /** Add one file; `executable` sets the Unix mode 0755 (else 0644). */
  async add(name: string, content: Buffer | string, options: { executable?: boolean } = {}): Promise<void> {
    if (!this.handle) throw new Error("ZipWriter is not open");
    if (!name || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === "")) throw new Error(`Invalid zip entry name: ${name}`);
    if (this.names.has(name)) throw new Error(`Duplicate zip entry: ${name}`);
    this.names.add(name);
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const nameBytes = Buffer.from(name, "utf8");
    if (data.length >= LIMIT || compressed.length >= LIMIT || this.offset + compressed.length + 30 + nameBytes.length >= LIMIT) throw new Error("The capsule is larger than 4 GB");
    const crc = crc32(data);
    const { time, date } = dosTime(this.when);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    await this.handle.write(Buffer.concat([local, nameBytes, compressed]));
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((((options.executable ? 0o100755 : 0o100644) << 16) >>> 0), 38);
    header.writeUInt32LE(this.offset, 42);
    this.central.push(Buffer.concat([header, nameBytes]));
    this.offset += local.length + nameBytes.length + compressed.length;
  }

  async close(): Promise<void> {
    if (!this.handle) return;
    const directory = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20);
    await this.handle.write(Buffer.concat([directory, end]));
    await this.handle.close();
    this.handle = null;
  }

  async abort(): Promise<void> {
    await this.handle?.close().catch(() => undefined);
    this.handle = null;
    await fs.rm(this.target, { force: true });
  }
}
