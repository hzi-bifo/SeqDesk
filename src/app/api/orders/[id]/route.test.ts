import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    statusNote: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    sampleSet: {
      findUnique: vi.fn(),
    },
    sampleMetadataSchema: {
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

import { DELETE, GET, PUT } from "./route";

describe("GET /api/orders/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      name: "Test Order",
      status: "DRAFT",
      statusUpdatedAt: new Date("2024-01-01"),
      createdAt: new Date("2024-01-01"),
      numberOfSamples: 1,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      billingAddress: null,
      platform: null,
      instrumentModel: null,
      librarySelection: null,
      libraryStrategy: null,
      librarySource: null,
      customFields: null,
      userId: "user-1",
      _count: { samples: 1 },
    });
    mocks.db.user.findUnique.mockResolvedValue({
      id: "user-1",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      department: { name: "Biology" },
    });
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.statusNote.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "GET" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when order does not exist", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "GET" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when researcher accesses another user's order", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      name: "Test Order",
      status: "DRAFT",
      statusUpdatedAt: new Date("2024-01-01"),
      createdAt: new Date("2024-01-01"),
      numberOfSamples: 1,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      billingAddress: null,
      platform: null,
      instrumentModel: null,
      librarySelection: null,
      libraryStrategy: null,
      librarySource: null,
      customFields: null,
      userId: "other-user",
      _count: { samples: 0 },
    });
    mocks.db.user.findUnique.mockResolvedValue({
      id: "other-user",
      firstName: "Other",
      lastName: "User",
      email: "other@example.com",
      department: null,
    });
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.statusNote.findMany.mockResolvedValue([]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "GET" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("returns order details for the owner", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "GET" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("order-1");
    expect(data.user.firstName).toBe("Test");
    expect(data.samples).toEqual([]);
    expect(data.statusNotes).toEqual([]);
  });

  it("allows facility admin to view any order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "GET" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
  });
});

describe("DELETE /api/orders/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.sample.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.order.delete.mockResolvedValue({ id: "order-1" });
  });

  it("prevents researchers from deleting submitted orders", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cannot delete order after submission",
    });
    expect(mocks.db.sample.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.order.delete).not.toHaveBeenCalled();
  });

  it("blocks facility admins when submitted-order deletion is disabled", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        allowDeleteSubmittedOrders: false,
      }),
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Deletion of submitted orders is disabled. Enable it in Settings > Data Handling.",
    });
    expect(mocks.db.sample.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.order.delete).not.toHaveBeenCalled();
  });

  it("allows facility admins to delete submitted orders when the setting is enabled", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        allowDeleteSubmittedOrders: true,
      }),
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Order deleted",
    });
    expect(mocks.db.sample.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1" },
      data: { studyId: null },
    });
    expect(mocks.db.order.delete).toHaveBeenCalledWith({
      where: { id: "order-1" },
    });
  });

  it("allows owners to delete draft orders without consulting the setting", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "DRAFT",
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.order.delete).toHaveBeenCalledWith({
      where: { id: "order-1" },
    });
  });
});

describe("PUT /api/orders/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats empty request bodies as a no-op update", async () => {
    const existingOrder = {
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
      name: "Existing order",
    };

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue(existingOrder);

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1", { method: "PUT" }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(existingOrder);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.statusNote.create).not.toHaveBeenCalled();
  });
});
