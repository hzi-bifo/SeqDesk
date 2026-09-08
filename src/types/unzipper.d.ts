declare module "unzipper" {
  import type { Readable } from "node:stream";
  interface ZipEntry {
    path: string;
    type: "File" | "Directory";
    compressedSize: number;
    uncompressedSize: number;
    externalFileAttributes: number;
    flags: number;
    crc32: number;
    stream(): Readable;
  }
  export const Open: { file(path: string): Promise<{ files: ZipEntry[] }> };
}
