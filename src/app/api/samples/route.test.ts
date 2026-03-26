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

const sampleData = [
  {
    id: "sample-1",
    sampleId: "S001",
    sampleTitle: "Test Sample",
    studyId: null,
    order: {
      id: "order-1",
      orderNumber: 1,
      name: "Order 1",
      status: "SUBMITTED",
      user: { id: "user-1", firstName: "Test", lastName: "User" },
    },
    study: null,
    reads: [],
  },
];

describe("GET /api/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.sample.findMany.mockResolvedValue(sampleData);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/samples");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns samples for authenticated user", async () => {
    const request = new NextRequest("http://localhost:3000/api/samples");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].sampleId).toBe("S001");

    // Researcher should have user ownership filter
    const whereArg = mocks.db.sample.findMany.mock.calls[0][0].where;
    expect(whereArg.order).toEqual({ userId: "user-1" });
  });

  it("does not filter by user for facility admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const request = new NextRequest("http://localhost:3000/api/samples");
    await GET(request);

    const whereArg = mocks.db.sample.findMany.mock.calls[0][0].where;
    expect(whereArg.order).toBeUndefined();
  });

  it("filters by unassigned when query param is set", async () => {
    const request = new NextRequest("http://localhost:3000/api/samples?unassigned=true");
    await GET(request);

    const whereArg = mocks.db.sample.findMany.mock.calls[0][0].where;
    expect(whereArg.studyId).toBeNull();
  });

  it("filters by orderId when query param is set", async () => {
    const request = new NextRequest("http://localhost:3000/api/samples?orderId=order-99");
    await GET(request);

    const whereArg = mocks.db.sample.findMany.mock.calls[0][0].where;
    expect(whereArg.orderId).toBe("order-99");
  });

  it("returns 500 on database error", async () => {
    mocks.db.sample.findMany.mockRejectedValue(new Error("DB error"));

    const request = new NextRequest("http://localhost:3000/api/samples");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch samples");
  });
});
