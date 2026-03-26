import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    sample: {
      findMany: vi.fn(),
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

import { GET } from "./route";

describe("GET /api/files/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.sample.findMany.mockResolvedValue([]);
  });

  it("uses case-insensitive filters for interactive search", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?search=AbC123"
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.db.sample.findMany).toHaveBeenCalledTimes(1);
    const args = mocks.db.sample.findMany.mock.calls[0][0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(args.where.OR).toEqual([
      { sampleId: { contains: "AbC123", mode: "insensitive" } },
      { sampleAlias: { contains: "AbC123", mode: "insensitive" } },
      { sampleTitle: { contains: "AbC123", mode: "insensitive" } },
      { order: { name: { contains: "AbC123", mode: "insensitive" } } },
      {
        order: {
          orderNumber: { contains: "AbC123", mode: "insensitive" },
        },
      },
    ]);
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/files/samples");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest("http://localhost:3000/api/files/samples");
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Only facility admins can access this");
  });

  it("filters samples needing R1 files", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "SAMPLE-1",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order 1", status: "SUBMITTED" },
        reads: [{ id: "r1", file1: null, file2: "file2.fastq" }],
      },
      {
        id: "s2",
        sampleId: "SAMPLE-2",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order 1", status: "SUBMITTED" },
        reads: [{ id: "r2", file1: "file1.fastq", file2: null }],
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?needsR1=true"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Only SAMPLE-1 has no R1
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0].sampleId).toBe("SAMPLE-1");
  });

  it("filters samples needing R2 files", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "SAMPLE-1",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order 1", status: "SUBMITTED" },
        reads: [{ id: "r1", file1: "file1.fastq", file2: null }],
      },
      {
        id: "s2",
        sampleId: "SAMPLE-2",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order 1", status: "SUBMITTED" },
        reads: [{ id: "r2", file1: "file1.fastq", file2: "file2.fastq" }],
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?needsR2=true"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Only SAMPLE-1 has no R2
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0].sampleId).toBe("SAMPLE-1");
  });

  it("calculates match scores and sorts by score when filename provided", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "ABC123",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order", status: "SUBMITTED" },
        reads: [],
      },
      {
        id: "s2",
        sampleId: "XYZ789",
        sampleAlias: "ABC123",
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order", status: "SUBMITTED" },
        reads: [],
      },
      {
        id: "s3",
        sampleId: "NOMATCH",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order", status: "SUBMITTED" },
        reads: [],
      },
    ]);

    // Use .fastq extension (not .fastq.gz) so extraction strips cleanly
    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?filename=ABC123_R1.fastq"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Best matches first - exact sampleId match
    expect(data.samples[0].sampleId).toBe("ABC123");
    expect(data.samples[0].matchType).toBe("exact");
    expect(data.samples[0].matchScore).toBe(1.0);
    // Alias exact match
    expect(data.samples[1].sampleId).toBe("XYZ789");
    expect(data.samples[1].matchType).toBe("exact");
    expect(data.samples[1].matchScore).toBe(1.0);
    // No match should be last
    expect(data.samples[2].sampleId).toBe("NOMATCH");
    expect(data.samples[2].matchScore).toBe(0);
  });

  it("scores title matches as partial", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "UNRELATED",
        sampleAlias: null,
        sampleTitle: "mysample",
        order: { id: "o1", orderNumber: "ORD-001", name: "Order", status: "SUBMITTED" },
        reads: [],
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?filename=mysample_R1.fastq"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.samples[0].matchScore).toBe(0.4);
    expect(data.samples[0].matchType).toBe("partial");
  });

  it("scores common prefix matches", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "ABCDEF",
        sampleAlias: null,
        sampleTitle: null,
        order: { id: "o1", orderNumber: "ORD-001", name: "Order", status: "SUBMITTED" },
        reads: [],
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?filename=ABCXYZ_R1.fastq"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.samples[0].matchType).toBe("partial");
    expect(data.samples[0].matchScore).toBeGreaterThan(0.3);
  });

  it("returns empty samples array when no results", async () => {
    mocks.db.sample.findMany.mockResolvedValue([]);

    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?search=nonexistent"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.samples).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns 500 on database failure", async () => {
    mocks.db.sample.findMany.mockRejectedValue(new Error("DB error"));

    const request = new NextRequest("http://localhost:3000/api/files/samples");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to search samples");
  });
});
