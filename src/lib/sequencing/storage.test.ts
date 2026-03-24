import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSequencingArtifactUploadRelativePath,
  buildSequencingReadUploadRelativePath,
  buildSequencingUploadTempRelativePath,
  calculateMd5ForRelativePath,
  ensureSequencingParentDirectory,
  finalizeSequencingUpload,
  removeSequencingRelativePath,
  sanitizeSequencingFilename,
  statSequencingRelativePath,
  writeSequencingUploadChunk,
} from "./storage";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function textStream(value: string): ReadableStream<Uint8Array> {
  const payload = new TextEncoder().encode(value);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
}

describe("sequencing storage", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await makeTempDir("seqdesk-storage-");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("sanitizes filenames and builds deterministic upload paths", () => {
    expect(sanitizeSequencingFilename("/tmp/reads 1.fastq.gz")).toBe(
      "reads_1.fastq.gz"
    );
    expect(sanitizeSequencingFilename("  weird name  ")).toBe("weird_name");
    expect(sanitizeSequencingFilename("sample.")).toBe("sample");
    expect(sanitizeSequencingFilename("???")).toBe("file");

    expect(
      buildSequencingUploadTempRelativePath(
        "order-1",
        "upload-1",
        "reads 1.fastq.gz"
      )
    ).toBe(
      path.join(
        "_uploads",
        "orders",
        "order-1",
        "_tmp",
        "upload-1-reads_1.fastq.gz.part"
      )
    );

    expect(
      buildSequencingReadUploadRelativePath(
        "order-1",
        "Sample 01",
        "upload-1",
        "r1",
        "reads 1.fastq.gz"
      )
    ).toBe(
      path.join(
        "_uploads",
        "orders",
        "order-1",
        "samples",
        "Sample_01",
        "reads",
        "upload-1-R1-reads_1.fastq.gz"
      )
    );

    expect(
      buildSequencingArtifactUploadRelativePath(
        "order-1",
        "upload-1",
        "QC reports",
        "report.html",
        "Sample 01"
      )
    ).toBe(
      path.join(
        "_uploads",
        "orders",
        "order-1",
        "samples",
        "Sample_01",
        "artifacts",
        "QC_reports",
        "upload-1-report.html"
      )
    );

    expect(
      buildSequencingArtifactUploadRelativePath(
        "order-1",
        "upload-1",
        "delivery",
        "report.html"
      )
    ).toBe(
      path.join(
        "_uploads",
        "orders",
        "order-1",
        "order-artifacts",
        "delivery",
        "upload-1-report.html"
      )
    );
  });

  it("creates parent directories and writes upload chunks with append and overwrite", async () => {
    const relativePath = path.join("reads", "run-1", "sample.fastq.gz");
    const absolutePath = await ensureSequencingParentDirectory(tempDir, relativePath);

    expect(absolutePath).toBe(path.join(tempDir, relativePath));

    await writeSequencingUploadChunk(tempDir, relativePath, textStream("AAA"), true);
    await writeSequencingUploadChunk(tempDir, relativePath, textStream("BBB"), false);
    expect(await fs.readFile(absolutePath, "utf-8")).toBe("AAABBB");

    await writeSequencingUploadChunk(tempDir, relativePath, textStream("CCC"), true);
    expect(await fs.readFile(absolutePath, "utf-8")).toBe("CCC");
  });

  it("finalizes uploads, reports file metadata, and removes files", async () => {
    const tempRelativePath = buildSequencingUploadTempRelativePath(
      "order-1",
      "upload-1",
      "reads.fastq.gz"
    );
    const finalRelativePath = buildSequencingReadUploadRelativePath(
      "order-1",
      "Sample 01",
      "upload-1",
      "r2",
      "reads.fastq.gz"
    );

    await writeSequencingUploadChunk(tempDir, tempRelativePath, textStream("ACGT"), true);
    await finalizeSequencingUpload(tempDir, tempRelativePath, finalRelativePath);

    const stats = await statSequencingRelativePath(tempDir, finalRelativePath);
    expect(stats.size).toBe(BigInt(4));
    expect(stats.modifiedAt).toBeInstanceOf(Date);

    expect(await calculateMd5ForRelativePath(tempDir, finalRelativePath)).toBe(
      createHash("md5").update("ACGT").digest("hex")
    );

    await removeSequencingRelativePath(tempDir, finalRelativePath);
    await expect(
      fs.access(path.join(tempDir, finalRelativePath))
    ).rejects.toThrow();
  });

  it("rejects relative paths that escape the sequencing storage base", async () => {
    await expect(
      ensureSequencingParentDirectory(tempDir, "../outside.fastq.gz")
    ).rejects.toThrow("Path traversal");
  });
});
