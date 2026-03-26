import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: { findMany: vi.fn() },
    study: { findMany: vi.fn() },
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

describe("GET /api/sidebar/entities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost:3000/api/sidebar/entities"
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns mapped orders and studies", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    mocks.db.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        orderNumber: "ORD-001",
        name: "Test Order",
        status: "PENDING",
      },
    ]);

    mocks.db.study.findMany.mockResolvedValue([
      {
        id: "study-1",
        title: "Test Study",
        alias: "TS-1",
        submitted: false,
        readyForSubmission: true,
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/sidebar/entities"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.orders).toEqual([
      { id: "order-1", label: "Test Order", sublabel: "ORD-001", status: "PENDING" },
    ]);
    expect(body.studies).toEqual([
      { id: "study-1", label: "Test Study", sublabel: "TS-1", status: "READY" },
    ]);
  });

  it("passes search query to database filters", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.study.findMany.mockResolvedValue([]);

    const request = new NextRequest(
      "http://localhost:3000/api/sidebar/entities?q=MySearch"
    );
    await GET(request);

    const orderCall = mocks.db.order.findMany.mock.calls[0][0];
    expect(orderCall.where.OR).toBeDefined();
    expect(orderCall.where.OR[0].name.contains).toBe("mysearch");
  });
});
