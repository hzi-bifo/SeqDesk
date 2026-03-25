import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  scanDirectory: vi.fn(),
  db: {
    read: {
      findMany: vi.fn(),
      update: vi.fn(),
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

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/files", () => ({
  scanDirectory: mocks.scanDirectory,
}));

import { GET } from "./route";

describe("GET /api/files", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq", ".fq.gz"],
        scanDepth: 4,
        ignorePatterns: [],
      },
    });
    mocks.scanDirectory.mockResolvedValue([]);
    mocks.db.read.findMany.mockResolvedValue([]);
    mocks.db.read.update.mockResolvedValue(null);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost:3000/api/files"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects non-admin requests", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });

    const response = await GET(new NextRequest("http://localhost:3000/api/files"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only facility admins can access the file browser",
    });
  });

  it("returns an empty payload when the base path is not configured", async () => {
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: null,
      config: {
        allowedExtensions: [".fastq"],
        scanDepth: 3,
        ignorePatterns: [],
      },
    });

    const response = await GET(new NextRequest("http://localhost:3000/api/files"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [],
      total: 0,
      assigned: 0,
      unassigned: 0,
      presentOnDisk: 0,
      missingOnDisk: 0,
      error: "Data base path not configured",
    });
  });

  it("returns scan errors without throwing", async () => {
    mocks.scanDirectory.mockRejectedValue(new Error("permission denied"));

    const response = await GET(new NextRequest("http://localhost:3000/api/files?force=true"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [],
      total: 0,
      assigned: 0,
      unassigned: 0,
      presentOnDisk: 0,
      missingOnDisk: 0,
      error: "Failed to scan directory: permission denied",
    });
  });

  it("enriches scanned files, includes missing assignments, and applies filters", async () => {
    const modifiedAt = new Date("2025-02-03T04:05:06.000Z");
    mocks.scanDirectory.mockResolvedValue([
      {
        absolutePath: "/data/base/alpha_R1.fastq",
        relativePath: "alpha_R1.fastq",
        filename: "alpha_R1.fastq",
        size: 123,
        modifiedAt,
      },
      {
        absolutePath: "/data/base/alpha_R2.fastq",
        relativePath: "alpha_R2.fastq",
        filename: "alpha_R2.fastq",
        size: 124,
        modifiedAt,
      },
      {
        absolutePath: "/data/base/orphan.fastq",
        relativePath: "orphan.fastq",
        filename: "orphan.fastq",
        size: 99,
        modifiedAt,
      },
    ]);
    mocks.db.read.findMany.mockResolvedValue([
      {
        id: "read-1",
        file1: "alpha_R1.fastq",
        file2: "alpha_R2.fastq",
        checksum1: "aaa",
        checksum2: "bbb",
        readCount1: 12,
        readCount2: 12,
        avgQuality1: 36.5,
        avgQuality2: 35.8,
        fastqcReport1: "alpha_R1_fastqc.html",
        fastqcReport2: "alpha_R2_fastqc.html",
        sample: {
          sampleId: "S1",
          sampleAlias: "Alpha",
          orderId: "order-1",
          order: {
            name: "Order One",
          },
          studyId: "study-1",
          study: {
            id: "study-1",
            title: "Study One",
          },
        },
      },
      {
        id: "read-2",
        file1: "missing_R1.fastq",
        file2: null,
        checksum1: "missing-md5",
        checksum2: null,
        readCount1: null,
        readCount2: null,
        avgQuality1: null,
        avgQuality2: null,
        fastqcReport1: null,
        fastqcReport2: null,
        sample: {
          sampleId: "S1",
          sampleAlias: "Alpha",
          orderId: "order-1",
          order: {
            name: "Order One",
          },
          studyId: "study-1",
          study: {
            id: "study-1",
            title: "Study One",
          },
        },
      },
    ]);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/files?filter=assigned&search=study%20one&extension=.fastq"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.assigned).toBe(3);
    expect(body.unassigned).toBe(1);
    expect(body.presentOnDisk).toBe(3);
    expect(body.missingOnDisk).toBe(1);
    expect(body.filtered).toBe(3);
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "alpha_R1.fastq",
          assigned: true,
          existsOnDisk: true,
          readType: "R1",
          pairStatus: "paired",
          checksum: "aaa",
          assignedTo: expect.objectContaining({
            sampleId: "S1",
            orderName: "Order One",
            studyTitle: "Study One",
            readField: "file1",
          }),
          quality: expect.objectContaining({
            readCount: 12,
            avgQuality: 36.5,
            fastqcReport: "alpha_R1_fastqc.html",
          }),
        }),
        expect.objectContaining({
          relativePath: "missing_R1.fastq",
          assigned: true,
          existsOnDisk: false,
          readType: "R1",
          pairStatus: null,
          checksum: "missing-md5",
        }),
      ])
    );
    expect(body.files.some((file: { absolutePath?: string }) => "absolutePath" in file)).toBe(
      false
    );
  });

  it("computes missing checksums for a bounded set of scanned files", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "seqdesk-files-route-"));
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, "beta_R1.fastq");
    const contents = "@read1\nACGT\n+\n!!!!\n";
    await writeFile(filePath, contents, "utf8");

    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: tempDir,
      config: {
        allowedExtensions: [".fastq"],
        scanDepth: 2,
        ignorePatterns: [],
      },
    });
    mocks.scanDirectory.mockResolvedValue([
      {
        absolutePath: filePath,
        relativePath: "beta_R1.fastq",
        filename: "beta_R1.fastq",
        size: contents.length,
        modifiedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);
    mocks.db.read.findMany.mockResolvedValue([
      {
        id: "read-1",
        file1: "beta_R1.fastq",
        file2: null,
        checksum1: null,
        checksum2: null,
        readCount1: null,
        readCount2: null,
        avgQuality1: null,
        avgQuality2: null,
        fastqcReport1: null,
        fastqcReport2: null,
        sample: {
          sampleId: "S2",
          sampleAlias: null,
          orderId: "order-2",
          order: {
            name: "Order Two",
          },
          studyId: null,
          study: null,
        },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/files?force=true&autoChecksum=true")
    );
    const body = await response.json();
    const expectedChecksum = createHash("md5").update(contents).digest("hex");

    expect(response.status).toBe(200);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: expectedChecksum },
    });
    expect(body.autoChecksum).toEqual({
      requested: true,
      attempted: 1,
      updated: 1,
      failed: 0,
      skippedMissingFiles: 0,
      remaining: 0,
      limit: 50,
    });
    expect(body.files[0]).toMatchObject({
      relativePath: "beta_R1.fastq",
      checksum: expectedChecksum,
    });
  });
});
