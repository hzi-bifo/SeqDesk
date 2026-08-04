import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { downloadEnaFile } from "./ena-download";

const temporaryDirectories: string[] = [];

async function temporaryDestination() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ena-download-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "reads.fastq.gz");
}

function response(body: Uint8Array, status = 200) {
  const arrayBuffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
  return new Response(arrayBuffer, { status });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ENA fixture downloads", () => {
  it("writes a response only after its published MD5 matches", async () => {
    const destination = await temporaryDestination();
    const contents = Buffer.from("compressed-fastq-placeholder");
    const expectedMd5 = createHash("md5").update(contents).digest("hex");

    await expect(
      downloadEnaFile({
        url: "https://ftp.sra.ebi.ac.uk/example.fastq.gz",
        destination,
        expectedMd5,
        fetchImpl: async () => response(contents),
      }),
    ).resolves.toEqual({ bytes: contents.length, md5: expectedMd5 });
    await expect(fs.readFile(destination)).resolves.toEqual(contents);
  });

  it("rejects a checksum mismatch without writing the destination", async () => {
    const destination = await temporaryDestination();

    await expect(
      downloadEnaFile({
        url: "https://ftp.sra.ebi.ac.uk/example.fastq.gz",
        destination,
        expectedMd5: "0".repeat(32),
        fetchImpl: async () => response(Buffer.from("unexpected")),
      }),
    ).rejects.toThrow(/ENA MD5 mismatch/);
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects HTTP failures, empty responses, and malformed expected hashes", async () => {
    const destination = await temporaryDestination();
    const validMd5 = createHash("md5").update("nonempty").digest("hex");

    await expect(
      downloadEnaFile({
        url: "https://ftp.sra.ebi.ac.uk/missing.fastq.gz",
        destination,
        expectedMd5: validMd5,
        fetchImpl: async () => response(Buffer.from("missing"), 404),
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      downloadEnaFile({
        url: "https://ftp.sra.ebi.ac.uk/empty.fastq.gz",
        destination,
        expectedMd5: validMd5,
        fetchImpl: async () => response(Buffer.alloc(0)),
      }),
    ).rejects.toThrow(/Downloaded 0 bytes/);
    await expect(
      downloadEnaFile({
        url: "https://ftp.sra.ebi.ac.uk/example.fastq.gz",
        destination,
        expectedMd5: "not-an-md5",
        fetchImpl: async () => response(Buffer.from("unused")),
      }),
    ).rejects.toThrow(/Invalid expected ENA MD5/);
  });
});
