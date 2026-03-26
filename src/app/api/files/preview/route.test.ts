import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineRun: {
      findMany: vi.fn(),
    },
  },
  isDemoSession: vi.fn(),
  fs: {
    stat: vi.fn(),
    readFile: vi.fn(),
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

vi.mock("fs/promises", () => ({
  default: {
    stat: mocks.fs.stat,
    readFile: mocks.fs.readFile,
  },
}));

import { GET } from "./route";

function makeRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/files/preview");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString());
}

describe("GET /api/files/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runFolder: "/data/runs/run-1",
        study: { userId: "admin-1" },
      },
    ]);
    mocks.fs.stat.mockResolvedValue({ isFile: () => true });
    mocks.fs.readFile.mockResolvedValue(Buffer.from("<html>report</html>"));
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(401);
  });

  it("serves fastqc R1 report in demo mode", async () => {
    mocks.isDemoSession.mockReturnValue(true);
    mocks.fs.readFile.mockResolvedValue(Buffer.from("<html>fastqc R1</html>"));

    const response = await GET(
      makeRequest({
        path: "/data/runs/run-1/fastqc_reports/SampleName_R1_fastqc.html",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
  });

  it("serves fastqc R2 report in demo mode", async () => {
    mocks.isDemoSession.mockReturnValue(true);
    mocks.fs.readFile.mockResolvedValue(Buffer.from("<html>fastqc R2</html>"));

    const response = await GET(
      makeRequest({
        path: "/data/runs/run-1/fastqc_reports/SampleName_R2_fastqc.html",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
  });

  it("returns 403 in demo mode for non-fastqc path", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when path is missing", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(400);
  });

  it("returns 400 for relative path", async () => {
    const response = await GET(makeRequest({ path: "relative/path.html" }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for unsupported extension", async () => {
    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/file.pdf" })
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when no matching run found", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for non-admin non-owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "other-user", role: "RESEARCHER" },
    });
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runFolder: "/data/runs/run-1",
        study: { userId: "owner-user" },
      },
    ]);

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 when file does not exist on disk", async () => {
    mocks.fs.stat.mockRejectedValue(new Error("ENOENT"));

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 when path is not a file", async () => {
    mocks.fs.stat.mockResolvedValue({ isFile: () => false });

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(400);
  });

  it("serves HTML file with correct headers", async () => {
    const htmlContent = Buffer.from("<html><body>Report</body></html>");
    mocks.fs.readFile.mockResolvedValue(htmlContent);

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Content-Length")).toBe(
      String(htmlContent.length)
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src"
    );
  });

  it("returns 500 on unexpected error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.getServerSession.mockRejectedValue(new Error("session error"));

    const response = await GET(
      makeRequest({ path: "/data/runs/run-1/output/report.html" })
    );

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
