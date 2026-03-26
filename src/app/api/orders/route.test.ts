import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    siteSettings: {
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

import { GET, POST } from "./route";

describe("POST /api/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findFirst.mockResolvedValue(null);
    mocks.db.user.findUnique.mockResolvedValue({
      firstName: "Test",
      lastName: "User",
      email: "user@example.com",
      institution: "HZI",
    });
    mocks.db.order.create.mockImplementation(async ({ data }) => ({
      id: "order-1",
      ...data,
    }));
  });

  it("marks orders as E2E-generated when the Playwright header is present", async () => {
    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seqdesk-e2e": "playwright",
      },
      body: JSON.stringify({
        name: "Playwright order",
        numberOfSamples: 2,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.db.order.create).toHaveBeenCalledTimes(1);
    const args = mocks.db.order.create.mock.calls[0][0] as {
      data: { generatedByE2E: boolean; numberOfSamples: number; name: string | null };
    };
    expect(args.data.generatedByE2E).toBe(true);
    expect(args.data.numberOfSamples).toBe(2);
    expect(args.data.name).toBe("Playwright order");
  });

  it("leaves generatedByE2E false for normal API calls", async () => {
    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Manual order",
        numberOfSamples: 1,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const args = mocks.db.order.create.mock.calls[0][0] as {
      data: { generatedByE2E: boolean };
    };
    expect(args.data.generatedByE2E).toBe(false);
  });

  it("returns 401 when no session (POST)", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("populates contact info from user profile", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      institution: "MIT",
    });

    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My order" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const args = mocks.db.order.create.mock.calls[0][0] as {
      data: { contactName: string; contactEmail: string; billingAddress: string };
    };
    expect(args.data.contactName).toBe("Alice Smith");
    expect(args.data.contactEmail).toBe("alice@example.com");
    expect(args.data.billingAddress).toBe("MIT");
  });

  it("returns 500 on POST db failure", async () => {
    mocks.db.order.create.mockRejectedValue(new Error("DB error"));

    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fail order" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to create order");
  });
});

describe("GET /api/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("FACILITY_ADMIN sees all orders with sharingMode=all", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.order.findMany.mockResolvedValue([{ id: "order-1" }, { id: "order-2" }]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sharingMode).toBe("all");
    expect(data.orders).toHaveLength(2);
    // Admin sees all - where clause should be empty
    const args = mocks.db.order.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({});
  });

  it("regular user sees only own orders when department sharing disabled", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.order.findMany.mockResolvedValue([{ id: "order-1" }]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sharingMode).toBe("personal");
    const args = mocks.db.order.findMany.mock.calls[0][0] as { where: { userId: string } };
    expect(args.where).toEqual({ userId: "user-1" });
  });

  it("department sharing enabled - user with department sees department orders", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ departmentSharing: true }),
    });
    mocks.db.user.findUnique.mockResolvedValue({ departmentId: "dept-1" });
    mocks.db.order.findMany.mockResolvedValue([{ id: "order-1" }]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sharingMode).toBe("department");
    const args = mocks.db.order.findMany.mock.calls[0][0] as {
      where: { user: { departmentId: string } };
    };
    expect(args.where).toEqual({ user: { departmentId: "dept-1" } });
  });

  it("department sharing enabled but user has no department - sees only own orders", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ departmentSharing: true }),
    });
    mocks.db.user.findUnique.mockResolvedValue({ departmentId: null });
    mocks.db.order.findMany.mockResolvedValue([]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sharingMode).toBe("personal");
    const args = mocks.db.order.findMany.mock.calls[0][0] as { where: { userId: string } };
    expect(args.where).toEqual({ userId: "user-1" });
  });

  it("returns 500 on GET db failure", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.order.findMany.mockRejectedValue(new Error("DB error"));

    const response = await GET();

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch orders");
  });
});
