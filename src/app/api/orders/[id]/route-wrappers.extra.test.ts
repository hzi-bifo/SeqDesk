import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingReadSession: vi.fn(),
  requireFacilityAdminSequencingSession: vi.fn(),
  getOrderSequencingSummary: vi.fn(),
  browseSequencingStorageFiles: vi.fn(),
  computeOrderSequencingChecksums: vi.fn(),
  discoverOrderSequencingFiles: vi.fn(),
  assignOrderSequencingReads: vi.fn(),
  setOrderSequencingStatuses: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
    },
    read: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  getOrderSequencingSummary: mocks.getOrderSequencingSummary,
  computeOrderSequencingChecksums: mocks.computeOrderSequencingChecksums,
  discoverOrderSequencingFiles: mocks.discoverOrderSequencingFiles,
  assignOrderSequencingReads: mocks.assignOrderSequencingReads,
  setOrderSequencingStatuses: mocks.setOrderSequencingStatuses,
}));

vi.mock("@/lib/sequencing/browse", () => ({
  browseSequencingStorageFiles: mocks.browseSequencingStorageFiles,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
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
    requireFacilityAdminSequencingReadSession:
      mocks.requireFacilityAdminSequencingReadSession,
    requireFacilityAdminSequencingSession:
      mocks.requireFacilityAdminSequencingSession,
    SequencingApiError,
  };
});

import { GET as getSequencingSummary } from "./sequencing/route";
import { GET as browseSequencing } from "./sequencing/browse/route";
import { POST as computeChecksums } from "./sequencing/checksums/route";
import { POST as discoverSequencing } from "./sequencing/discover/route";
import { PUT as updateSequencingReads, PATCH as clearSequencingReadFields } from "./sequencing/reads/route";
import { PUT as updateSequencingStatuses } from "./sequencing/status/route";
import { POST as discoverLegacyFiles } from "./files/discover/route";

function routeParams(id = "order-1") {
  return { params: Promise.resolve({ id }) };
}

describe("order route coverage quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireFacilityAdminSequencingReadSession.mockResolvedValue(undefined);
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue(undefined);
    mocks.getOrderSequencingSummary.mockResolvedValue({
      orderId: "order-1",
      orderName: "Order One",
      samples: [],
    });
    mocks.computeOrderSequencingChecksums.mockResolvedValue({
      processedReads: 2,
      processedArtifacts: 1,
    });
    mocks.discoverOrderSequencingFiles.mockResolvedValue({
      discoveredFiles: 3,
      matchedSamples: 2,
    });
    mocks.assignOrderSequencingReads.mockResolvedValue([
      { sampleId: "sample-1", success: true },
      { sampleId: "sample-2", success: false, error: "Missing read 2" },
    ]);
    mocks.setOrderSequencingStatuses.mockResolvedValue([
      { sampleId: "sample-1", success: true },
    ]);
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/seq/base",
      config: {
        scanDepth: 2,
        ignorePatterns: ["*.tmp"],
      },
    });
    mocks.browseSequencingStorageFiles.mockResolvedValue([
      {
        relativePath: "reads/sample_R1.fastq.gz",
        fileName: "sample_R1.fastq.gz",
        modifiedAt: new Date("2026-03-01T12:00:00.000Z"),
        size: 1234,
      },
      {
        relativePath: "reads/sample_R2.fastq.gz",
        fileName: "sample_R2.fastq.gz",
        modifiedAt: new Date("2026-03-01T12:30:00.000Z"),
        size: 2345,
      },
    ]);
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1" });
    mocks.db.read.findMany.mockResolvedValue([
      {
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        sample: {
          sampleId: "S1",
          orderId: "order-1",
          order: { name: "Order One" },
        },
      },
    ]);
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-1" });
    mocks.db.read.update.mockResolvedValue({ id: "read-1" });
  });

  it("returns the sequencing summary and maps read-session failures", async () => {
    const success = await getSequencingSummary(
      new Request("http://localhost/api/orders/order-1/sequencing"),
      routeParams()
    );

    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      orderId: "order-1",
      orderName: "Order One",
      samples: [],
    });
    expect(mocks.getOrderSequencingSummary).toHaveBeenCalledWith("order-1");

    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingReadSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );

    const forbidden = await getSequencingSummary(
      new Request("http://localhost/api/orders/order-1/sequencing"),
      routeParams()
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.getOrderSequencingSummary.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await getSequencingSummary(
      new Request("http://localhost/api/orders/order-1/sequencing"),
      routeParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.getOrderSequencingSummary.mockRejectedValueOnce(new Error("boom"));
    const failed = await getSequencingSummary(
      new Request("http://localhost/api/orders/order-1/sequencing"),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to load sequencing data" });
  });

  it("browses storage files, normalizes limit input, and enriches assignments", async () => {
    const response = await browseSequencing(
      new NextRequest(
        "http://localhost/api/orders/order-1/sequencing/browse?search=sample&limit=oops"
      ),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.browseSequencingStorageFiles).toHaveBeenCalledWith("/seq/base", {
      search: "sample",
      maxDepth: 5,
      ignorePatterns: ["*.tmp"],
      limit: 250,
    });
    expect(await response.json()).toEqual({
      files: [
        {
          relativePath: "reads/sample_R1.fastq.gz",
          fileName: "sample_R1.fastq.gz",
          modifiedAt: "2026-03-01T12:00:00.000Z",
          size: 1234,
          assignedTo: {
            sampleId: "S1",
            orderId: "order-1",
            orderName: "Order One",
            role: "R1",
          },
        },
        {
          relativePath: "reads/sample_R2.fastq.gz",
          fileName: "sample_R2.fastq.gz",
          modifiedAt: "2026-03-01T12:30:00.000Z",
          size: 2345,
          assignedTo: {
            sampleId: "S1",
            orderId: "order-1",
            orderName: "Order One",
            role: "R2",
          },
        },
      ],
    });
  });

  it("maps browse precondition and unexpected failures", async () => {
    mocks.db.order.findUnique.mockResolvedValueOnce(null);
    const missingOrder = await browseSequencing(
      new NextRequest("http://localhost/api/orders/order-1/sequencing/browse"),
      routeParams()
    );
    expect(missingOrder.status).toBe(404);
    expect(await missingOrder.json()).toEqual({ error: "Order not found" });

    mocks.getSequencingFilesConfig.mockResolvedValueOnce({
      dataBasePath: null,
      config: {
        scanDepth: 2,
        ignorePatterns: [],
      },
    });
    const missingPath = await browseSequencing(
      new NextRequest("http://localhost/api/orders/order-1/sequencing/browse"),
      routeParams()
    );
    expect(missingPath.status).toBe(400);
    expect(await missingPath.json()).toEqual({
      error: "Data base path not configured",
    });

    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Unauthorized", 401)
    );
    const unauthorized = await browseSequencing(
      new NextRequest("http://localhost/api/orders/order-1/sequencing/browse"),
      routeParams()
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.browseSequencingStorageFiles.mockRejectedValueOnce(new Error("disk offline"));
    const failed = await browseSequencing(
      new NextRequest("http://localhost/api/orders/order-1/sequencing/browse"),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to browse sequencing storage",
    });
  });

  it("computes checksums and tolerates invalid JSON payloads", async () => {
    const response = await computeChecksums(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.computeOrderSequencingChecksums).toHaveBeenCalledWith("order-1", {});
    expect(await response.json()).toEqual({
      success: true,
      summary: {
        processedReads: 2,
        processedArtifacts: 1,
      },
    });
  });

  it("maps checksum route validation and unexpected failures", async () => {
    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );

    const forbidden = await computeChecksums(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeParams()
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.computeOrderSequencingChecksums.mockRejectedValueOnce(
      new Error("Sequencing files not configured")
    );
    const invalid = await computeChecksums(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({ readIds: ["read-1"] }),
      }),
      routeParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Sequencing files not configured",
    });

    mocks.computeOrderSequencingChecksums.mockRejectedValueOnce(new Error("crash"));
    const failed = await computeChecksums(
      new Request("http://localhost/api/orders/order-1/sequencing/checksums", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to compute sequencing checksums",
    });
  });

  it("discovers sequencing files for both sequencing and legacy endpoints", async () => {
    const body = { autoAssign: true, force: true };

    const sequencing = await discoverSequencing(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      routeParams()
    );
    expect(sequencing.status).toBe(200);
    expect(await sequencing.json()).toEqual({
      success: true,
      discoveredFiles: 3,
      matchedSamples: 2,
    });

    const legacy = await discoverLegacyFiles(
      new Request("http://localhost/api/orders/order-1/files/discover", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      routeParams()
    );
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({
      success: true,
      discoveredFiles: 3,
      matchedSamples: 2,
    });
    expect(mocks.discoverOrderSequencingFiles).toHaveBeenNthCalledWith(1, "order-1", body);
    expect(mocks.discoverOrderSequencingFiles).toHaveBeenNthCalledWith(2, "order-1", body);
  });

  it("maps discover route validation failures", async () => {
    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await discoverSequencing(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(
      new Error("Order is configured as submitted or completed")
    );
    const invalid = await discoverLegacyFiles(
      new Request("http://localhost/api/orders/order-1/files/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Order is configured as submitted or completed",
    });

    mocks.discoverOrderSequencingFiles.mockRejectedValueOnce(new Error("explode"));
    const failed = await discoverSequencing(
      new Request("http://localhost/api/orders/order-1/sequencing/discover", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to discover sequencing files",
    });
  });

  it("updates sequencing read assignments and maps workflow errors", async () => {
    const assignments = [
      {
        sampleId: "sample-1",
        read1: "reads/sample_R1.fastq.gz",
        read2: "reads/sample_R2.fastq.gz",
      },
    ];

    const success = await updateSequencingReads(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PUT",
        body: JSON.stringify({ assignments }),
      }),
      routeParams()
    );

    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      success: false,
      results: [
        { sampleId: "sample-1", success: true },
        { sampleId: "sample-2", success: false, error: "Missing read 2" },
      ],
      message: "Sequencing read assignments updated",
    });

    const invalidPayload = await updateSequencingReads(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PUT",
        body: JSON.stringify({ assignments: { sampleId: "sample-1" } }),
      }),
      routeParams()
    );
    expect(invalidPayload.status).toBe(400);
    expect(await invalidPayload.json()).toEqual({
      error: "Invalid assignments data",
    });

    mocks.assignOrderSequencingReads.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await updateSequencingReads(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PUT",
        body: JSON.stringify({ assignments }),
      }),
      routeParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.assignOrderSequencingReads.mockRejectedValueOnce(
      new Error("Sequencing files not configured")
    );
    const invalid = await updateSequencingReads(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PUT",
        body: JSON.stringify({ assignments }),
      }),
      routeParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Sequencing files not configured",
    });

    mocks.assignOrderSequencingReads.mockRejectedValueOnce(new Error("boom"));
    const failed = await updateSequencingReads(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PUT",
        body: JSON.stringify({ assignments }),
      }),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to update sequencing reads",
    });
  });

  it("clears read fields after validating patch requests", async () => {
    const missingFields = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({ sampleId: "", clearFields: [] }),
      }),
      routeParams()
    );
    expect(missingFields.status).toBe(400);
    expect(await missingFields.json()).toEqual({
      error: "Missing sampleId or clearFields",
    });

    const invalidFields = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({
          sampleId: "sample-1",
          clearFields: ["checksum1", "unsupported"],
        }),
      }),
      routeParams()
    );
    expect(invalidFields.status).toBe(400);
    expect(await invalidFields.json()).toEqual({
      error: "Invalid fields: unsupported",
    });

    mocks.db.read.findFirst.mockResolvedValueOnce(null);
    const missingRead = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({
          sampleId: "sample-1",
          clearFields: ["checksum1"],
        }),
      }),
      routeParams()
    );
    expect(missingRead.status).toBe(404);
    expect(await missingRead.json()).toEqual({
      error: "Read record not found",
    });

    const success = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({
          sampleId: "sample-1",
          clearFields: ["checksum1", "fastqcReport2"],
        }),
      }),
      routeParams()
    );
    expect(success.status).toBe(200);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: {
        checksum1: null,
        fastqcReport2: null,
      },
    });
    expect(await success.json()).toEqual({ success: true });

    const { SequencingApiError } = await import("@/lib/sequencing/server");
    mocks.requireFacilityAdminSequencingSession.mockRejectedValueOnce(
      new SequencingApiError("Forbidden", 403)
    );
    const forbidden = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({
          sampleId: "sample-1",
          clearFields: ["checksum1"],
        }),
      }),
      routeParams()
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.db.read.findFirst.mockRejectedValueOnce(new Error("db exploded"));
    const failed = await clearSequencingReadFields(
      new Request("http://localhost/api/orders/order-1/sequencing/reads", {
        method: "PATCH",
        body: JSON.stringify({
          sampleId: "sample-1",
          clearFields: ["checksum1"],
        }),
      }),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to clear read fields",
    });
  });

  it("updates sample sequencing statuses and maps validation failures", async () => {
    const updates = [{ sampleId: "sample-1", facilityStatus: "READY" }];

    const success = await updateSequencingStatuses(
      new Request("http://localhost/api/orders/order-1/sequencing/status", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      }),
      routeParams()
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      success: true,
      results: [{ sampleId: "sample-1", success: true }],
    });

    const missingUpdates = await updateSequencingStatuses(
      new Request("http://localhost/api/orders/order-1/sequencing/status", {
        method: "PUT",
        body: JSON.stringify({ updates: [] }),
      }),
      routeParams()
    );
    expect(missingUpdates.status).toBe(400);
    expect(await missingUpdates.json()).toEqual({
      error: "No status updates provided",
    });

    mocks.setOrderSequencingStatuses.mockRejectedValueOnce(new Error("Order not found"));
    const missing = await updateSequencingStatuses(
      new Request("http://localhost/api/orders/order-1/sequencing/status", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      }),
      routeParams()
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Order not found" });

    mocks.setOrderSequencingStatuses.mockRejectedValueOnce(
      new Error("Order is configured as submitted or completed")
    );
    const invalid = await updateSequencingStatuses(
      new Request("http://localhost/api/orders/order-1/sequencing/status", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      }),
      routeParams()
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Order is configured as submitted or completed",
    });

    mocks.setOrderSequencingStatuses.mockRejectedValueOnce(new Error("kaboom"));
    const failed = await updateSequencingStatuses(
      new Request("http://localhost/api/orders/order-1/sequencing/status", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      }),
      routeParams()
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to update sample statuses",
    });
  });
});
