import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveDataBasePathFromStoredValue: vi.fn(),
  checkAndCompleteOrder: vi.fn(),
  fs: {
    access: vi.fn(),
  },
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
    sample: {
      findUnique: vi.fn(),
    },
    read: {
      findFirst: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue: mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("fs/promises", () => ({
  access: mocks.fs.access,
}));

vi.mock("@/lib/orders/auto-complete", () => ({
  checkAndCompleteOrder: mocks.checkAndCompleteOrder,
}));

import { POST } from "./route";

describe("POST /api/files/assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/stored/path",
      extraSettings: null,
    });
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/data/base",
    });
    mocks.fs.access.mockResolvedValue(undefined);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-db-1",
      sampleId: "S1",
      order: {
        id: "order-1",
        status: "COMPLETED",
        name: "Order One",
      },
      reads: [],
    });
    mocks.db.read.findFirst.mockResolvedValue(null);
    mocks.db.read.create.mockResolvedValue(null);
    mocks.db.read.update.mockResolvedValue(null);
    mocks.db.read.findUnique.mockResolvedValue({
      id: "old-read",
      file1: null,
      file2: null,
    });
    mocks.db.read.delete.mockResolvedValue(null);
    mocks.checkAndCompleteOrder.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated, non-admin, and invalid payloads", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const unauthorized = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({ filePath: "reads/S1_R1.fastq", sampleId: "sample-db-1" }),
      })
    );
    expect(unauthorized.status).toBe(401);

    mocks.getServerSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        role: "USER",
      },
    });

    const forbidden = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({ filePath: "reads/S1_R1.fastq", sampleId: "sample-db-1" }),
      })
    );
    expect(forbidden.status).toBe(403);

    const invalid = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({ filePath: "", sampleId: "" }),
      })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "filePath and sampleId are required",
    });
  });

  it("creates a new read assignment with auto-detected read type", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/S1_R2.fastq",
          sampleId: "sample-db-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.read.create).toHaveBeenCalledWith({
      data: {
        sampleId: "sample-db-1",
        file2: "reads/S1_R2.fastq",
      },
    });
    expect(mocks.checkAndCompleteOrder).toHaveBeenCalledWith("order-1");
    expect(await response.json()).toEqual({
      success: true,
      message: "File assigned to S1 as Read 2",
      sampleId: "S1",
      readField: "file2",
    });
  });

  it("returns a success response when the file is already assigned to the same sample", async () => {
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "reads/S1_R1.fastq",
      file2: null,
      sample: {
        id: "sample-db-1",
        sampleId: "S1",
      },
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/S1_R1.fastq",
          sampleId: "sample-db-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.read.create).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      success: true,
      message: "File is already assigned to S1",
      sampleId: "S1",
      readField: "file1",
    });
  });

  it("rejects re-assignment without force and supports forced re-assignment", async () => {
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-db-1",
      sampleId: "S1",
      order: {
        id: "order-1",
        status: "COMPLETED",
        name: "Order One",
      },
      reads: [
        {
          id: "current-read",
          file1: null,
          file2: null,
        },
      ],
    });
    mocks.db.read.findFirst
      .mockResolvedValueOnce({
        id: "old-read",
        file1: "reads/old.fastq",
        file2: null,
        sample: {
          id: "sample-db-2",
          sampleId: "S2",
        },
      })
      .mockResolvedValueOnce({
        id: "old-read",
        file1: "reads/old.fastq",
        file2: null,
        sample: {
          id: "sample-db-2",
          sampleId: "S2",
        },
      });

    const rejected = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/old.fastq",
          sampleId: "sample-db-1",
        }),
      })
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      error: "File is already assigned to sample S2",
      assignedTo: "S2",
      requiresForce: true,
    });

    const forced = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/old.fastq",
          sampleId: "sample-db-1",
          force: true,
        }),
      })
    );

    expect(forced.status).toBe(200);
    expect(mocks.db.read.update).toHaveBeenNthCalledWith(1, {
      where: { id: "old-read" },
      data: { file1: null },
    });
    expect(mocks.db.read.delete).toHaveBeenCalledWith({
      where: { id: "old-read" },
    });
    expect(mocks.db.read.update).toHaveBeenNthCalledWith(2, {
      where: { id: "current-read" },
      data: { file1: "reads/old.fastq" },
    });
    expect(await forced.json()).toEqual({
      success: true,
      message: "File assigned to S1 as Read 1",
      sampleId: "S1",
      readField: "file1",
    });
  });

  it("maps order-status and filesystem validation failures", async () => {
    mocks.db.sample.findUnique.mockResolvedValueOnce({
      id: "sample-db-1",
      sampleId: "S1",
      order: {
        id: "order-1",
        status: "DRAFT",
        name: "Order One",
      },
      reads: [],
    });

    const statusError = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/S1_R1.fastq",
          sampleId: "sample-db-1",
        }),
      })
    );
    expect(statusError.status).toBe(400);
    expect(await statusError.json()).toEqual({
      error: "Order status 'DRAFT' does not allow file assignment",
    });

    mocks.fs.access.mockRejectedValueOnce(new Error("missing"));

    const missingFile = await POST(
      new NextRequest("http://localhost:3000/api/files/assign", {
        method: "POST",
        body: JSON.stringify({
          filePath: "reads/missing.fastq",
          sampleId: "sample-db-1",
        }),
      })
    );
    expect(missingFile.status).toBe(404);
    expect(await missingFile.json()).toEqual({
      error: "File not found",
    });
  });
});
