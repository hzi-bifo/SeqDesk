import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    sample: {
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    statusNote: {
      findMany: vi.fn(),
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

import { DELETE } from "./route";

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
