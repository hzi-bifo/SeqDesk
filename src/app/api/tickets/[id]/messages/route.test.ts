import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    ticket: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
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

import { POST } from "./route";

const userSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/tickets/[id]/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      status: "OPEN",
    });
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ticketMessage: {
          create: vi.fn().mockResolvedValue({
            id: "msg-1",
            content: "Hello",
            userId: "user-1",
            ticketId: "ticket-1",
            user: { id: "user-1", firstName: "Test", lastName: "User", role: "RESEARCHER" },
          }),
        },
        ticket: {
          update: vi.fn().mockResolvedValue({ id: "ticket-1" }),
        },
      };
      return fn(tx);
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const response = await POST(request, makeParams("ticket-1"));

    expect(response.status).toBe(401);
  });

  it("creates a message and returns 201", async () => {
    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const response = await POST(request, makeParams("ticket-1"));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("msg-1");
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when ticket does not exist", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets/nonexistent/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const response = await POST(request, makeParams("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("returns 403 when non-owner non-admin tries to post", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "other-user",
      status: "OPEN",
    });

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const response = await POST(request, makeParams("ticket-1"));

    expect(response.status).toBe(403);
  });

  it("returns 400 when ticket is closed", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      status: "CLOSED",
    });

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const response = await POST(request, makeParams("ticket-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Cannot add messages to closed tickets");
  });

  it("returns 400 when content is empty", async () => {
    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "  " }),
    });
    const response = await POST(request, makeParams("ticket-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Message content is required");
  });
});
