import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Readable } from "stream";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  safeJoin: vi.fn(),
  hasAllowedExtension: vi.fn(),
  isDemoSession: vi.fn(),
  fs: {
    statSync: vi.fn(),
    createReadStream: vi.fn(),
  },
  db: {
    read: {
      findFirst: vi.fn(),
    },
    assembly: {
      findFirst: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
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

vi.mock("@/lib/files/paths", () => ({
  safeJoin: mocks.safeJoin,
  hasAllowedExtension: mocks.hasAllowedExtension,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("fs", () => ({
  statSync: mocks.fs.statSync,
  createReadStream: mocks.fs.createReadStream,
}));

import { GET } from "./route";

describe("GET /api/files/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data/base",
      config: {
        allowedExtensions: [".fastq", ".fq.gz"],
      },
    });
    mocks.safeJoin.mockReturnValue("/data/base/reads/sample_R1.fastq");
    mocks.hasAllowedExtension.mockReturnValue(true);
    mocks.db.read.findFirst.mockResolvedValue({
      sample: {
        order: {
          userId: "user-1",
          status: "COMPLETED",
        },
        study: null,
      },
    });
    mocks.db.assembly.findFirst.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.fs.statSync.mockReturnValue({
      size: 3,
      isFile: () => true,
    });
    mocks.fs.createReadStream.mockReturnValue(Readable.from([Buffer.from("abc")]));
  });

  it("rejects unauthenticated and demo downloads", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const unauthorized = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=reads/sample_R1.fastq")
    );
    expect(unauthorized.status).toBe(401);

    mocks.getServerSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.isDemoSession.mockReturnValueOnce(true);

    const demo = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=reads/sample_R1.fastq")
    );
    expect(demo.status).toBe(403);
    expect(await demo.json()).toEqual({
      error: "Downloads are disabled in the public demo.",
    });
  });

  it("blocks assembly downloads for regular users when the facility disallows them", async () => {
    mocks.db.read.findFirst.mockResolvedValue(null);
    mocks.db.assembly.findFirst.mockResolvedValue({
      sample: {
        order: {
          userId: "user-1",
          status: "COMPLETED",
        },
        study: {
          userId: "user-1",
        },
      },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        allowUserAssemblyDownload: false,
      }),
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=assemblies/sample.fa")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Assembly downloads are disabled by the facility administrator.",
    });
  });

  it("streams readable files for authorized users", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=reads/sample_R1.fastq")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="sample_R1.fastq"'
    );
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(await response.text()).toBe("abc");
  });

  it("rejects invalid paths and missing files", async () => {
    mocks.safeJoin.mockImplementationOnce(() => {
      throw new Error("bad path");
    });

    const invalid = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=../../secret")
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Invalid file path",
    });

    mocks.safeJoin.mockReturnValue("/data/base/reads/sample_R1.fastq");
    mocks.fs.statSync.mockImplementationOnce(() => {
      throw new Error("missing");
    });

    const missing = await GET(
      new NextRequest("http://localhost:3000/api/files/download?path=reads/sample_R1.fastq")
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "File not found",
    });
  });
});
