import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    read: {
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
  getResolvedDataBasePath: vi.fn(),
  ensureWithinBase: vi.fn(),
  rm: vi.fn(),
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

vi.mock("@/lib/files", () => ({
  ensureWithinBase: mocks.ensureWithinBase,
}));

vi.mock("fs/promises", () => ({
  default: { rm: mocks.rm },
  rm: mocks.rm,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/files/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/files/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "/data",
    });
    mocks.ensureWithinBase.mockImplementation(
      (_base: string, rel: string) => `/data/${rel}`
    );
    mocks.db.read.findMany.mockResolvedValue([]);
    mocks.rm.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ filePaths: ["a.txt"] }));

    expect(response.status).toBe(401);
  });

  it("deletes files and returns count", async () => {
    const response = await POST(makeRequest({ filePaths: ["a.fastq", "b.fastq"] }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.deletedCount).toBe(2);
    expect(data.total).toBe(2);
    expect(mocks.rm).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when filePaths is empty", async () => {
    const response = await POST(makeRequest({ filePaths: [] }));

    expect(response.status).toBe(400);
  });
});
