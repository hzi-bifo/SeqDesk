import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  createSequencingUploadSession: vi.fn(),
  appendSequencingUploadChunk: vi.fn(),
  cancelSequencingUpload: vi.fn(),
  completeSequencingUpload: vi.fn(),
  linkOrderSequencingArtifact: vi.fn(),
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  createSequencingUploadSession: mocks.createSequencingUploadSession,
  appendSequencingUploadChunk: mocks.appendSequencingUploadChunk,
  cancelSequencingUpload: mocks.cancelSequencingUpload,
  completeSequencingUpload: mocks.completeSequencingUpload,
  linkOrderSequencingArtifact: mocks.linkOrderSequencingArtifact,
}));

vi.mock("@/lib/sequencing/server", () => {
  class SequencingApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "SequencingApiError";
      this.status = status;
    }
  }

  return {
    requireFacilityAdminSequencingSession:
      mocks.requireFacilityAdminSequencingSession,
    SequencingApiError,
  };
});

import { POST as createUpload } from "./uploads/route";
import { PATCH as appendUploadChunk, DELETE as cancelUpload } from "./uploads/[uploadId]/route";
import { POST as completeUpload } from "./uploads/[uploadId]/complete/route";
import { POST as linkArtifact } from "./artifacts/link/route";

function orderParams(id = "order-1") {
  return { params: Promise.resolve({ id }) };
}

function uploadParams(id = "order-1", uploadId = "upload-1") {
  return { params: Promise.resolve({ id, uploadId }) };
}

describe("sequencing upload and artifact route quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1" },
    });
    mocks.createSequencingUploadSession.mockResolvedValue({
      uploadId: "upload-1",
      uploadUrl: "https://example.test/upload-1",
    });
    mocks.appendSequencingUploadChunk.mockResolvedValue({
      nextOffset: "8",
      completed: false,
    });
    mocks.cancelSequencingUpload.mockResolvedValue(undefined);
    mocks.completeSequencingUpload.mockResolvedValue({
      readId: "read-1",
      filePath: "reads/sample_R1.fastq.gz",
    });
    mocks.linkOrderSequencingArtifact.mockResolvedValue({
      id: "artifact-1",
      path: "results/sample.bam",
    });
  });

  it("creates upload sessions and validates required fields", async () => {
    const body = {
      sampleId: "sample-1",
      targetKind: "read",
      targetRole: "R1",
      originalName: "sample_R1.fastq.gz",
      expectedSize: 123,
      checksumProvided: "sha256:abc",
      mimeType: "application/gzip",
      metadata: {
        stage: "reads",
        sequencingRunId: "run-1",
      },
    };

    const success = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );

    expect(success.status).toBe(200);
    expect(mocks.createSequencingUploadSession).toHaveBeenCalledWith(
      "order-1",
      "admin-1",
      body
    );
    expect(await success.json()).toEqual({
      success: true,
      uploadId: "upload-1",
      uploadUrl: "https://example.test/upload-1",
    });

    const invalid = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify({ targetKind: "read" }),
      }),
      orderParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "targetKind, targetRole, originalName, and expectedSize are required",
    });
  });

  it("maps upload session route failures", async () => {
    const body = {
      targetKind: "read",
      targetRole: "R1",
      originalName: "sample_R1.fastq.gz",
      expectedSize: 123,
    };
    const { SequencingApiError } = await import("@/lib/sequencing/server");

    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );
    const forbidden = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.createSequencingUploadSession.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.createSequencingUploadSession.mockRejectedValueOnce(
      new Error("Order is configured as submitted or completed")
    );
    const invalid = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Order is configured as submitted or completed",
    });

    mocks.createSequencingUploadSession.mockRejectedValueOnce(new Error("boom"));
    const failed = await createUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to create upload session",
    });
  });

  it("appends upload chunks and validates headers and body", async () => {
    const chunkRequest = new Request(
      "http://localhost/api/orders/order-1/sequencing/uploads/upload-1",
      {
        method: "PATCH",
        headers: {
          "x-seqdesk-offset": "5",
          "Content-Type": "application/octet-stream",
        },
        body: "chunk-data",
      }
    );
    const expectedBody = chunkRequest.body;

    const success = await appendUploadChunk(chunkRequest, uploadParams());
    expect(success.status).toBe(200);
    expect(mocks.appendSequencingUploadChunk).toHaveBeenCalledWith(
      "order-1",
      "upload-1",
      5n,
      expectedBody
    );
    expect(await success.json()).toEqual({
      success: true,
      nextOffset: "8",
      completed: false,
    });

    const missingOffset = await appendUploadChunk(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1", {
        method: "PATCH",
        body: "chunk-data",
      }),
      uploadParams()
    );
    expect(missingOffset.status).toBe(400);
    expect(await missingOffset.json()).toEqual({
      error: "x-seqdesk-offset header is required",
    });

    const missingBody = await appendUploadChunk(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1", {
        method: "PATCH",
        headers: { "x-seqdesk-offset": "0" },
      }),
      uploadParams()
    );
    expect(missingBody.status).toBe(400);
    expect(await missingBody.json()).toEqual({
      error: "Upload chunk body is required",
    });
  });

  it("maps chunk upload failures", async () => {
    const validRequest = new Request(
      "http://localhost/api/orders/order-1/sequencing/uploads/upload-1",
      {
        method: "PATCH",
        headers: { "x-seqdesk-offset": "0" },
        body: "chunk-data",
      }
    );
    const { SequencingApiError } = await import("@/lib/sequencing/server");

    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Unauthorized", 401)
    );
    const unauthorized = await appendUploadChunk(validRequest.clone(), uploadParams());
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.appendSequencingUploadChunk.mockRejectedValueOnce(new Error("invalid offset"));
    const invalid = await appendUploadChunk(validRequest.clone(), uploadParams());
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid offset" });

    mocks.appendSequencingUploadChunk.mockRejectedValueOnce(new Error("disk failure"));
    const failed = await appendUploadChunk(validRequest.clone(), uploadParams());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to upload chunk" });
  });

  it("cancels uploads and maps delete failures", async () => {
    const success = await cancelUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1", {
        method: "DELETE",
      }),
      uploadParams()
    );
    expect(success.status).toBe(200);
    expect(mocks.cancelSequencingUpload).toHaveBeenCalledWith("order-1", "upload-1");
    expect(await success.json()).toEqual({ success: true });

    mocks.cancelSequencingUpload.mockRejectedValueOnce(new Error("Upload not found"));
    const missing = await cancelUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1", {
        method: "DELETE",
      }),
      uploadParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Upload not found" });

    mocks.cancelSequencingUpload.mockRejectedValueOnce(new Error("explode"));
    const failed = await cancelUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1", {
        method: "DELETE",
      }),
      uploadParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to cancel upload" });
  });

  it("completes uploads and maps completion failures", async () => {
    const success = await completeUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1/complete", {
        method: "POST",
      }),
      uploadParams()
    );
    expect(success.status).toBe(200);
    expect(mocks.completeSequencingUpload).toHaveBeenCalledWith("order-1", "upload-1");
    expect(await success.json()).toEqual({
      success: true,
      readId: "read-1",
      filePath: "reads/sample_R1.fastq.gz",
    });

    mocks.completeSequencingUpload.mockRejectedValueOnce(
      new Error("upload incomplete")
    );
    const invalid = await completeUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1/complete", {
        method: "POST",
      }),
      uploadParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "upload incomplete" });

    mocks.completeSequencingUpload.mockRejectedValueOnce(new Error("explode"));
    const failed = await completeUpload(
      new Request("http://localhost/api/orders/order-1/sequencing/uploads/upload-1/complete", {
        method: "POST",
      }),
      uploadParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to finalize upload" });
  });

  it("links sequencing artifacts and validates required fields", async () => {
    const body = {
      sampleId: "sample-1",
      sequencingRunId: "run-1",
      stage: "alignment",
      artifactType: "bam",
      path: "results/sample.bam",
      originalName: "sample.bam",
      checksum: "sha256:def",
      mimeType: "application/octet-stream",
      metadata: "{\"lane\":1}",
      visibility: "internal",
      source: "manual",
    };

    const success = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );

    expect(success.status).toBe(200);
    expect(mocks.linkOrderSequencingArtifact).toHaveBeenCalledWith("order-1", {
      ...body,
      createdById: "admin-1",
    });
    expect(await success.json()).toEqual({
      success: true,
      artifact: {
        id: "artifact-1",
        path: "results/sample.bam",
      },
    });

    const invalid = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify({ stage: "alignment" }),
      }),
      orderParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "stage, artifactType, and path are required",
    });
  });

  it("maps artifact link failures", async () => {
    const body = {
      stage: "alignment",
      artifactType: "bam",
      path: "results/sample.bam",
    };
    const { SequencingApiError } = await import("@/lib/sequencing/server");

    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );
    const forbidden = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.linkOrderSequencingArtifact.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.linkOrderSequencingArtifact.mockRejectedValueOnce(
      new Error("required metadata missing")
    );
    const invalid = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "required metadata missing" });

    mocks.linkOrderSequencingArtifact.mockRejectedValueOnce(new Error("boom"));
    const failed = await linkArtifact(
      new Request("http://localhost/api/orders/order-1/sequencing/artifacts/link", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      orderParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to link sequencing artifact",
    });
  });
});
