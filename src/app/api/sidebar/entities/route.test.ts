import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findMany: vi.fn(),
    },
    study: {
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

describe("GET /api/sidebar/entities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.db.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        orderNumber: "ORD-001",
        name: "Alpha Order",
        status: "COMPLETED",
      },
    ]);
    mocks.db.study.findMany.mockResolvedValue([
      {
        id: "study-1",
        title: "Alpha Study",
        alias: "AS-1",
        submitted: false,
        readyForSubmission: true,
      },
      {
        id: "study-2",
        title: "Beta Study",
        alias: null,
        submitted: false,
        readyForSubmission: false,
      },
    ]);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost:3000/api/sidebar/entities"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("applies case-folded search filters for non-admins and maps entities", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/sidebar/entities?q=Alpha")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.order.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { name: { contains: "alpha" } },
          { orderNumber: { contains: "alpha" } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        name: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    expect(mocks.db.study.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { title: { contains: "alpha" } },
          { alias: { contains: "alpha" } },
        ],
      },
      select: {
        id: true,
        title: true,
        alias: true,
        submitted: true,
        readyForSubmission: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    expect(body).toEqual({
      orders: [
        {
          id: "order-1",
          label: "Alpha Order",
          sublabel: "ORD-001",
          status: "COMPLETED",
        },
      ],
      studies: [
        {
          id: "study-1",
          label: "Alpha Study",
          sublabel: "AS-1",
          status: "READY",
        },
        {
          id: "study-2",
          label: "Beta Study",
          sublabel: "",
          status: "DRAFT",
        },
      ],
    });
  });

  it("drops the owner filter for admins and marks submitted studies as published", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.study.findMany.mockResolvedValue([
      {
        id: "study-3",
        title: "Published Study",
        alias: "PUB-1",
        submitted: true,
        readyForSubmission: true,
      },
    ]);

    const response = await GET(
      new Request("http://localhost:3000/api/sidebar/entities")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect((mocks.db.order.findMany.mock.calls[0][0] as { where: object }).where).toEqual({});
    expect((mocks.db.study.findMany.mock.calls[0][0] as { where: object }).where).toEqual({});
    expect(body.studies).toEqual([
      {
        id: "study-3",
        label: "Published Study",
        sublabel: "PUB-1",
        status: "PUBLISHED",
      },
    ]);
  });
});
