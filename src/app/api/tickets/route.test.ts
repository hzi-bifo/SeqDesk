import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  ticketReferencesSupported: vi.fn(),
  db: {
    ticket: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    siteSettings: {
      findUnique: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    study: {
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

vi.mock("@/lib/tickets/reference-support", () => ({
  ticketReferencesSupported: mocks.ticketReferencesSupported,
}));

import { GET, POST } from "./route";

const userSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

describe("GET /api/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.ticketReferencesSupported.mockResolvedValue(true);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns tickets for authenticated user", async () => {
    const ticketData = [
      {
        id: "ticket-1",
        subject: "Help needed",
        status: "OPEN",
        priority: "NORMAL",
        lastUserMessageAt: "2024-01-01T00:00:00Z",
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        closedAt: null,
        userId: "user-1",
        user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
        _count: { messages: 1 },
        order: null,
        study: null,
      },
    ];
    mocks.db.ticket.findMany.mockResolvedValue(ticketData);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("ticket-1");
    expect(body[0].hasUnread).toBeDefined();
  });

  it("returns 500 on unexpected error", async () => {
    mocks.db.ticket.findMany.mockRejectedValue(new Error("DB down"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to fetch tickets");
  });

  it("user sees unread when admin sent message after userReadAt", async () => {
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "ticket-3",
        subject: "User unread",
        status: "OPEN",
        priority: "NORMAL",
        lastUserMessageAt: null,
        lastAdminMessageAt: "2024-01-03T00:00:00Z",
        userReadAt: "2024-01-01T00:00:00Z",
        adminReadAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-03T00:00:00Z",
        closedAt: null,
        userId: "user-1",
        user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
        _count: { messages: 2 },
        order: null,
        study: null,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(body[0].hasUnread).toBe(true);
  });

  it("user has no unread when no admin message exists", async () => {
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "ticket-4",
        subject: "No admin message",
        status: "OPEN",
        priority: "NORMAL",
        lastUserMessageAt: "2024-01-01T00:00:00Z",
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        closedAt: null,
        userId: "user-1",
        user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
        _count: { messages: 1 },
        order: null,
        study: null,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(body[0].hasUnread).toBe(false);
  });

  it("admin sees unread when user sent message after adminReadAt", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "ticket-2",
        subject: "Unread ticket",
        status: "OPEN",
        priority: "NORMAL",
        lastUserMessageAt: "2024-01-02T00:00:00Z",
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: "2024-01-01T00:00:00Z",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        closedAt: null,
        userId: "user-1",
        user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
        _count: { messages: 2 },
        order: null,
        study: null,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(body[0].hasUnread).toBe(true);
  });
});

describe("POST /api/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.ticketReferencesSupported.mockResolvedValue(false);
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ticket: {
          create: vi.fn().mockResolvedValue({
            id: "ticket-new",
            subject: "Test ticket",
            status: "OPEN",
            priority: "NORMAL",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userId: "user-1",
          }),
        },
        ticketMessage: {
          create: vi.fn().mockResolvedValue({ id: "msg-1" }),
        },
      };
      return fn(tx);
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Test", message: "Hello" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("creates a ticket and returns 201", async () => {
    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Test ticket", message: "Need help" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("ticket-new");
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when both orderId and studyId are provided", async () => {
    mocks.ticketReferencesSupported.mockResolvedValue(true);

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Test",
        message: "Hello",
        orderId: "order-1",
        studyId: "study-1",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Please select either an order or a study");
  });

  it("returns 404 when orderId user cannot access", async () => {
    mocks.ticketReferencesSupported.mockResolvedValue(true);
    mocks.db.order.findUnique.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Test",
        message: "Hello",
        orderId: "order-nonexistent",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Selected order could not be found");
  });

  it("defaults priority to NORMAL when not provided", async () => {
    mocks.ticketReferencesSupported.mockResolvedValue(false);
    let capturedData: Record<string, unknown> | null = null;
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ticket: {
          create: vi.fn().mockImplementation(({ data }) => {
            capturedData = data;
            return {
              id: "ticket-new",
              subject: "Test",
              status: "OPEN",
              priority: data.priority,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              userId: "user-1",
            };
          }),
        },
        ticketMessage: {
          create: vi.fn().mockResolvedValue({ id: "msg-1" }),
        },
      };
      return fn(tx);
    });

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Test", message: "No priority" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(capturedData).toMatchObject({ priority: "NORMAL" });
  });

  it("creates a ticket with studyId reference", async () => {
    mocks.ticketReferencesSupported.mockResolvedValue(true);
    mocks.db.study.findUnique.mockResolvedValue({ id: "study-1", userId: "user-1" });
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ticket: {
          create: vi.fn().mockResolvedValue({
            id: "ticket-study",
            subject: "Study ticket",
            status: "OPEN",
            priority: "NORMAL",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userId: "user-1",
            study: { id: "study-1", title: "My Study" },
            order: null,
          }),
        },
        ticketMessage: {
          create: vi.fn().mockResolvedValue({ id: "msg-1" }),
        },
      };
      return fn(tx);
    });

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Study ticket",
        message: "About my study",
        studyId: "study-1",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("ticket-study");
  });

  it("returns 500 when transaction fails", async () => {
    mocks.db.$transaction.mockRejectedValue(new Error("DB down"));

    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Test", message: "Hello" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to create ticket");
  });

  it("returns 400 when subject or message is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "", message: "" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Subject and message are required");
  });
});
