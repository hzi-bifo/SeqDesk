import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  inspectDataStoragePath: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("node:fs/promises", () => ({
  readdir: mocks.readdir,
}));

vi.mock("@/lib/files/data-storage-path-validation", () => ({
  inspectDataStoragePath: mocks.inspectDataStoragePath,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/admin/settings/sequencing-files/test",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/settings/sequencing-files/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: true,
      configuredPath: "/data",
      resolvedPath: "/data",
      readable: true,
      writable: true,
    });
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(401);
  });

  it("returns invalid when no basePath provided", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/no path/i);
  });

  it("returns invalid when path is not a directory", async () => {
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: false,
      readable: false,
      writable: false,
      error: "Path exists but is not a directory",
    });

    const response = await POST(makeRequest({ basePath: "/data/file.txt" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/not a directory/i);
  });

  it("returns invalid when path does not exist", async () => {
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: false,
      readable: false,
      writable: false,
      error: "Directory does not exist or is not accessible",
    });

    const response = await POST(makeRequest({ basePath: "/nonexistent" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/does not exist/i);
  });

  it("returns invalid when path is not readable", async () => {
    mocks.inspectDataStoragePath.mockResolvedValue({
      valid: false,
      readable: false,
      writable: false,
      error: "Directory is not readable or searchable (permission denied)",
    });

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/not readable/i);
  });

  it("returns valid with empty directory message", async () => {
    mocks.readdir.mockResolvedValue([]);

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(true);
    expect(data.totalFiles).toBe(0);
    expect(data.matchingFiles).toBe(0);
    expect(data.message).toMatch(/empty/i);
  });

  it("returns valid with matching files count", async () => {
    mocks.readdir.mockResolvedValue([
      { name: "sample_R1.fastq.gz", isFile: () => true },
      { name: "sample_R2.fastq.gz", isFile: () => true },
      { name: "readme.txt", isFile: () => true },
      { name: "subdir", isFile: () => false },
    ]);

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(true);
    expect(data.totalFiles).toBe(3);
    expect(data.matchingFiles).toBe(2);
    expect(data.message).toMatch(/Found 2 sequencing file/i);
  });

  it("returns valid with no matching files", async () => {
    mocks.readdir.mockResolvedValue([
      { name: "readme.txt", isFile: () => true },
      { name: "data.csv", isFile: () => true },
    ]);

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(true);
    expect(data.totalFiles).toBe(2);
    expect(data.matchingFiles).toBe(0);
    expect(data.message).toMatch(/no sequencing files/i);
  });

  it("returns invalid when readdir fails", async () => {
    mocks.readdir.mockRejectedValue(new Error("I/O error"));

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/failed to read directory/i);
  });

  it("returns 500 on unexpected error", async () => {
    // Simulate request.json() failing by making a non-JSON body
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.readdir.mockResolvedValue([]);

    // Trigger the outer catch by passing a request that fails on json()
    const badRequest = new NextRequest(
      "http://localhost:3000/api/admin/settings/sequencing-files/test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }
    );
    const response = await POST(badRequest);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/failed to test path/i);
  });
});
