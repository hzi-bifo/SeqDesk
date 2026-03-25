import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
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

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

import { POST } from "./route";

describe("POST /api/files/checksum", () => {
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
    mocks.db.read.update.mockResolvedValue(null);
  });

  it("rejects unauthenticated and non-admin requests", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const unauthorized = await POST(
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({ filePaths: ["reads/a.fastq"] }),
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
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({ filePaths: ["reads/a.fastq"] }),
      })
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "Only facility admins can calculate checksums",
    });
  });

  it("validates the payload and configured base path", async () => {
    const invalid = await POST(
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({ filePaths: [] }),
      })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "filePaths array is required",
    });

    const tooMany = await POST(
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({
          filePaths: Array.from({ length: 51 }, (_, index) => `reads/${index}.fastq`),
        }),
      })
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({
      error: "Maximum 50 files at a time",
    });

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: null,
    });

    const missingBase = await POST(
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({ filePaths: ["reads/a.fastq"] }),
      })
    );
    expect(missingBase.status).toBe(400);
    expect(await missingBase.json()).toEqual({
      error: "Data base path not configured",
    });
  });

  it("calculates checksums, updates linked reads, and reports errors", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "seqdesk-files-checksum-"));
    tempDirs.push(tempDir);

    const linkedRelativePath = "reads/linked.fastq";
    const linkedAbsolutePath = path.join(tempDir, linkedRelativePath);
    const linkedContents = "@read1\nACGT\n+\n!!!!\n";

    const orphanRelativePath = "reads/orphan.fastq";
    const orphanAbsolutePath = path.join(tempDir, orphanRelativePath);
    const orphanContents = "@read2\nTGCA\n+\n####\n";

    await mkdir(path.dirname(linkedAbsolutePath), { recursive: true });
    await writeFile(linkedAbsolutePath, linkedContents, "utf8");
    await writeFile(orphanAbsolutePath, orphanContents, "utf8");

    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: tempDir,
    });
    mocks.db.read.findFirst.mockImplementation(
      async ({ where }: { where: { OR: Array<{ file1?: string; file2?: string }> } }) => {
        const relativePath = where.OR[0].file1 ?? where.OR[1].file2;
        if (relativePath === linkedRelativePath) {
          return {
            id: "read-1",
            file1: linkedRelativePath,
            file2: null,
          };
        }
        return null;
      }
    );

    const response = await POST(
      new NextRequest("http://localhost:3000/api/files/checksum", {
        method: "POST",
        body: JSON.stringify({
          filePaths: [
            linkedRelativePath,
            orphanRelativePath,
            "missing.fastq",
            "../escape.fastq",
          ],
        }),
      })
    );
    const body = await response.json();

    const linkedChecksum = createHash("md5").update(linkedContents).digest("hex");
    const orphanChecksum = createHash("md5").update(orphanContents).digest("hex");

    expect(response.status).toBe(200);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: linkedChecksum },
    });
    expect(body.summary).toEqual({
      total: 4,
      successful: 2,
      failed: 2,
      updatedReadRecords: 1,
      notLinkedToRead: 1,
    });
    expect(body.results).toEqual([
      {
        filePath: linkedRelativePath,
        checksum: linkedChecksum,
        updatedReadRecord: true,
      },
      {
        filePath: orphanRelativePath,
        checksum: orphanChecksum,
        updatedReadRecord: false,
        warning: "No assigned read record found; checksum was not stored in database",
      },
      {
        filePath: "missing.fastq",
        error: "File not found",
      },
      {
        filePath: "../escape.fastq",
        error: "Path is outside configured data base path",
      },
    ]);
  });
});
