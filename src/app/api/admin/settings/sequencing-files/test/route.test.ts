import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("fs/promises", () => ({
  stat: mocks.stat,
  access: mocks.access,
  readdir: mocks.readdir,
  constants: { R_OK: 4 },
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
    mocks.stat.mockResolvedValue({ isDirectory: () => false });

    const response = await POST(makeRequest({ basePath: "/data/file.txt" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/not a directory/i);
  });

  it("returns invalid when path does not exist", async () => {
    mocks.stat.mockRejectedValue(new Error("ENOENT"));

    const response = await POST(makeRequest({ basePath: "/nonexistent" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/does not exist/i);
  });

  it("returns invalid when path is not readable", async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockRejectedValue(new Error("EACCES"));

    const response = await POST(makeRequest({ basePath: "/data" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/not readable/i);
  });

  it("returns valid with empty directory message", async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockResolvedValue(undefined);
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
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockResolvedValue(undefined);
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
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockResolvedValue(undefined);
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
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockResolvedValue(undefined);
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
    // Make stat throw something that doesn't get caught by inner try-catch
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockResolvedValue(undefined);
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
