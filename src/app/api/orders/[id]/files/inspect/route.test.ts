import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  hasAllowedExtension: vi.fn(),
  safeJoin: vi.fn(),
  db: {
    read: {
      findFirst: vi.fn(),
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

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/files/paths", () => ({
  hasAllowedExtension: mocks.hasAllowedExtension,
  safeJoin: mocks.safeJoin,
}));

import { GET } from "./route";

describe("GET /api/orders/[id]/files/inspect", () => {
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
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: "sample_R1.fastq",
      file2: null,
      readCount1: null,
      readCount2: null,
    });
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq", ".txt"],
      },
    });
    mocks.hasAllowedExtension.mockReturnValue(true);
    mocks.safeJoin.mockImplementation((basePath: string, relativePath: string) =>
      path.join(basePath, relativePath)
    );
    mocks.db.read.update.mockResolvedValue(null);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("blocks file inspection in demo mode", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "File inspection is disabled in the public demo.",
    });
  });

  it("requires a path parameter", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/files/inspect"),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing path parameter",
    });
  });

  it("rejects reads outside the caller's accessible order scope", async () => {
    mocks.db.read.findFirst.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Access denied" });
  });

  it("returns validation errors before touching the filesystem", async () => {
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: null,
      config: {
        allowedExtensions: [".fastq"],
      },
    });

    const missingBasePath = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    expect(missingBasePath.status).toBe(400);
    expect(await missingBasePath.json()).toEqual({
      error: "Data base path not configured",
    });

    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq"],
      },
    });
    mocks.hasAllowedExtension.mockReturnValue(false);

    const disallowed = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    expect(disallowed.status).toBe(400);
    expect(await disallowed.json()).toEqual({
      error: "File type not allowed",
    });

    mocks.hasAllowedExtension.mockReturnValue(true);
    mocks.safeJoin.mockImplementation(() => {
      throw new Error("escape");
    });

    const invalidPath = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=../../secret.txt"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    expect(invalidPath.status).toBe(400);
    expect(await invalidPath.json()).toEqual({
      error: "Invalid file path",
    });
  });

  it("returns 404 when the referenced file is missing", async () => {
    mocks.safeJoin.mockReturnValue("/does/not/exist.fastq");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/orders/order-1/files/inspect?path=sample_R1.fastq"
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "File not found",
    });
  });

  it("returns a preview and computed read count for FASTQ files", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "seqdesk-order-file-inspect-"));
    tempDirs.push(tempDir);

    const relativePath = "sample_R1.fastq";
    const absolutePath = path.join(tempDir, relativePath);
    const contents = [
      "@read1",
      "ACGT",
      "+",
      "!!!!",
      "@read2",
      "TGCA",
      "+",
      "####",
    ].join("\n");
    await writeFile(absolutePath, contents, "utf8");

    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: tempDir,
      config: {
        allowedExtensions: [".fastq"],
      },
    });
    mocks.safeJoin.mockReturnValue(absolutePath);
    mocks.db.read.findFirst.mockResolvedValue({
      id: "read-1",
      file1: relativePath,
      file2: null,
      readCount1: null,
      readCount2: null,
    });

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/orders/order-1/files/inspect?path=${encodeURIComponent(relativePath)}&lines=3`
      ),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      filePath: relativePath,
      fileName: "sample_R1.fastq",
      readCount: 2,
      readCountSource: "computed",
      readCountError: null,
      preview: {
        supported: true,
        truncated: true,
        error: null,
        lines: ["@read1", "ACGT", "+"],
      },
    });
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { readCount1: 2 },
    });
  });
});
