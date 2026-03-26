import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Readable } from "stream";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  ensureWithinBase: vi.fn(),
  createReadStream: vi.fn(),
  fs: {
    stat: vi.fn(),
    readFile: vi.fn(),
    open: vi.fn(),
  },
  db: {
    pipelineRun: {
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

vi.mock("@/lib/files", () => ({
  ensureWithinBase: mocks.ensureWithinBase,
}));

vi.mock("fs/promises", () => ({
  default: mocks.fs,
}));

vi.mock("fs", () => ({
  createReadStream: mocks.createReadStream,
}));

import { GET } from "./route";

describe("GET /api/pipelines/runs/[id]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      runFolder: "/tmp/run-1",
      study: null,
      order: null,
    });
    mocks.ensureWithinBase.mockReturnValue("/tmp/run-1/logs/run.log");
    mocks.fs.stat.mockResolvedValue({
      size: 12,
      isFile: () => true,
    });
    mocks.fs.readFile.mockResolvedValue("hello world");
  });

  it("returns 401 without a session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid file paths", async () => {
    mocks.ensureWithinBase.mockImplementation(() => {
      throw new Error("Path escapes base directory");
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=../../secret.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Path escapes base directory",
    });
  });

  it("returns a text preview for supported files", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: "hello world",
      truncated: false,
      size: 12,
    });
  });

  it("rejects previews for non-text files", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=result.bin"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Preview supported for text files only",
    });
  });

  it("returns 404 when run is not found", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 403 when user is not admin and not the owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-other", role: "USER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      runFolder: "/tmp/run-1",
      study: { userId: "user-owner" },
      order: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("allows access when user owns the order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-owner", role: "USER" },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      runFolder: "/tmp/run-1",
      study: null,
      order: { userId: "user-owner" },
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
  });

  it("returns 400 when run folder is not set", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      runFolder: null,
      study: null,
      order: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Run folder not set" });
  });

  it("returns 400 when path query parameter is missing", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Path is required" });
  });

  it("returns 400 when the target is not a file", async () => {
    mocks.fs.stat.mockResolvedValue({
      size: 0,
      isFile: () => false,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=subdir"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Not a file" });
  });

  it("returns truncated content for large files", async () => {
    mocks.fs.stat.mockResolvedValue({
      size: 300 * 1024,
      isFile: () => true,
    });
    const mockHandle = {
      stat: vi.fn().mockResolvedValue({ size: 300 * 1024 }),
      read: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fs.open.mockResolvedValue(mockHandle);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.truncated).toBe(true);
    expect(json.size).toBe(300 * 1024);
  });

  it("supports mode=download query parameter", async () => {
    mocks.ensureWithinBase.mockReturnValue("/tmp/run-1/reports/report.html");
    mocks.fs.stat.mockResolvedValue({
      size: 3,
      isFile: () => true,
    });
    mocks.createReadStream.mockReturnValue(Readable.from([Buffer.from("abc")]));

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/pipelines/runs/run-1/file?path=reports/report.html&mode=download"
      ),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="report.html"'
    );
  });

  it("returns 500 when an unexpected error occurs", async () => {
    mocks.fs.stat.mockRejectedValue(new Error("Disk error"));

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1/file?path=run.log"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load file" });
  });

  it("streams file downloads with attachment headers", async () => {
    mocks.ensureWithinBase.mockReturnValue("/tmp/run-1/reports/report.html");
    mocks.fs.stat.mockResolvedValue({
      size: 3,
      isFile: () => true,
    });
    mocks.createReadStream.mockReturnValue(Readable.from([Buffer.from("abc")]));

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/pipelines/runs/run-1/file?path=reports/report.html&download=1"
      ),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="report.html"'
    );
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(await response.text()).toBe("abc");
  });
});
