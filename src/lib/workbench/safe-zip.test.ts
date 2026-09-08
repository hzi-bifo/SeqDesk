import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { extractWorkbenchZip, safeZipEntryPath } from "./safe-zip";

// Tiny local ZIP fixtures, unrelated to any external repository/API.
function zip(names: string[], options: { attributes?: number; crc?: number } = {}) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name), data = Buffer.from("abc");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(options.crc ?? 0x352441c2, 14);
    header.writeUInt32LE(3, 18); header.writeUInt32LE(3, 22); header.writeUInt16LE(n.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(options.crc ?? 0x352441c2, 16);
    record.writeUInt32LE(3, 20); record.writeUInt32LE(3, 24); record.writeUInt16LE(n.length, 28);
    record.writeUInt32LE(options.attributes ?? 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, n, data); central.push(record, n); offset += header.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
let root: string;
describe("bounded local ZIP extraction", () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-safe-zip-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  async function extract(data: Buffer, max = 100) {
    const file = path.join(root, "input.zip"); await fs.writeFile(file, data);
    return extractWorkbenchZip(file, path.join(root, "output"), max);
  }
  it("extracts a regular file and verifies its CRC", async () => {
    expect(await extract(zip(["data/file.txt"]))).toEqual({ bytes: 3, entries: 1 });
    expect(await fs.readFile(path.join(root, "output/data/file.txt"), "utf8")).toBe("abc");
  });
  it.each(["../escape", "/absolute", "C:/file", "dir\\file", "dir/../file"])("rejects path %s", (value) => {
    expect(() => safeZipEntryPath(value)).toThrow();
  });
  it("rejects case-folded collisions", async () => {
    await expect(extract(zip(["file", "FILE"]))).rejects.toThrow("Colliding");
  });
  it("rejects symlinks", async () => {
    await expect(extract(zip(["link"], { attributes: (0xa1ff << 16) >>> 0 }))).rejects.toThrow("links");
  });
  it("rejects corrupt CRC and removes unpublished extraction", async () => {
    await expect(extract(zip(["file"], { crc: 1 }))).rejects.toThrow("integrity");
    await expect(fs.stat(path.join(root, "output"))).rejects.toThrow();
  });
  it("rejects oversized extraction", async () => {
    await expect(extract(zip(["file"]), 2)).rejects.toThrow("size exceeds");
  });
  it("will not replace an existing destination", async () => {
    await fs.mkdir(path.join(root, "output"));
    await expect(extract(zip(["file"]))).rejects.toThrow();
    expect((await fs.stat(path.join(root, "output"))).isDirectory()).toBe(true);
  });
});
