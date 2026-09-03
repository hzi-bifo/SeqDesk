import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  db: { $transaction: vi.fn() },
  getOrCreateDefaultWorkbenchWorkspace: vi.fn(),
  resolveWorkbenchStorageBase: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/workbench/workspaces", () => ({
  getOrCreateDefaultWorkbenchWorkspace:
    mocks.getOrCreateDefaultWorkbenchWorkspace,
}));
vi.mock("@/lib/workbench/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("./storage")>();
  return { ...original, resolveWorkbenchStorageBase: mocks.resolveWorkbenchStorageBase };
});

import {
  normalizeWorkbenchUploadFilename,
  storeWorkbenchUpload,
  WorkbenchUploadError,
} from "./uploads";

let tempDir = "";

function body(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe("Workbench local uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(path.join(os.tmpdir(), "seqdesk-upload-"));
    delete process.env.SEQDESK_WORKBENCH_UPLOAD_MAX_BYTES;
    mocks.getOrCreateDefaultWorkbenchWorkspace.mockResolvedValue({
      id: "workspace-a",
    });
    mocks.resolveWorkbenchStorageBase.mockResolvedValue({
      baseDir: tempDir,
      cacheRoot: path.join(tempDir, "cache"),
      jobsRoot: path.join(tempDir, "jobs"),
    });
  });

  afterEach(() => {
    delete process.env.SEQDESK_WORKBENCH_UPLOAD_MAX_BYTES;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts scientific file names without accepting client paths", () => {
    expect(normalizeWorkbenchUploadFilename("..%2Freads_R1.fastq.gz")).toBe(
      "reads_R1.fastq.gz"
    );
    expect(() => normalizeWorkbenchUploadFilename("script.sh")).toThrow(
      WorkbenchUploadError
    );
  });

  it("streams a private workspace upload, checksums it, and links the dataset", async () => {
    const now = new Date("2026-09-03T12:00:00.000Z");
    const tx = {
      workbenchDataset: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          ...data,
          id: "dataset-a",
          createdAt: now,
          updatedAt: now,
        })),
      },
      workbenchWorkspaceDataset: { create: vi.fn().mockResolvedValue({}) },
    };
    mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));

    const dataset = await storeWorkbenchUpload({
      userId: "user-a",
      filename: "reads.fastq",
      contentType: "application/octet-stream",
      contentLength: 15,
      body: body("@read\nACGT\n+\n!!!!\n"),
    });

    const stored = tx.workbenchDataset.create.mock.calls[0][0].data;
    expect(stored.storagePath.startsWith(tempDir)).toBe(true);
    expect(readFileSync(stored.storagePath, "utf8")).toBe("@read\nACGT\n+\n!!!!\n");
    expect(stored.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.workbenchWorkspaceDataset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-a",
        datasetId: "dataset-a",
      }),
    });
    expect(dataset).not.toHaveProperty("storagePath");
  });

  it("stops a streaming upload at the configured size limit", async () => {
    process.env.SEQDESK_WORKBENCH_UPLOAD_MAX_BYTES = "4";
    await expect(
      storeWorkbenchUpload({
        userId: "user-a",
        filename: "reads.fastq",
        body: body("12345"),
      })
    ).rejects.toMatchObject({ status: 413 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
