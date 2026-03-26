import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  ticketReferencesSupported: vi.fn(),
  db: {
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

import { GET, PATCH } from "./route";

const userSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};

const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const sampleTicket = {
  id: "ticket-1",
  subject: "Help",
  status: "OPEN",
  priority: "NORMAL",
  lastUserMessageAt: null,
  lastAdminMessageAt: null,
  userReadAt: null,
  adminReadAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  closedAt: null,
  userId: "user-1",
  user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
  messages: [],
  order: null,
  study: null,
};

describe("GET /api/tickets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.ticketReferencesSupported.mockResolvedValue(true);
    mocks.db.ticket.update.mockResolvedValue({ id: "ticket-1" });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1");
    const response = await GET(request, makeParams("ticket-1"));

    expect(response.status).toBe(401);
  });

  it("returns ticket with messages for the owner", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue(sampleTicket);

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1");
    const response = await GET(request, makeParams("ticket-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("ticket-1");
    // Should mark as read
    expect(mocks.db.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ticket-1" },
        data: expect.objectContaining({ userReadAt: expect.any(Date) }),
      })
    );
  });

  it("returns 404 when ticket does not exist", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets/nonexistent");
    const response = await GET(request, makeParams("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("returns 403 when non-owner non-admin tries to access", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      ...sampleTicket,
      userId: "other-user",
    });

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1");
    const response = await GET(request, makeParams("ticket-1"));

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/tickets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(adminSession);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    const response = await PATCH(request, makeParams("ticket-1"));

    expect(response.status).toBe(401);
  });

  it("admin can update status and priority", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      status: "OPEN",
    });
    const updatedTicket = {
      id: "ticket-1",
      subject: "Help",
      status: "IN_PROGRESS",
      priority: "HIGH",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      closedAt: null,
      userId: "user-1",
      user: { id: "user-1", firstName: "Test", lastName: "User", email: "test@example.com" },
    };
    mocks.db.ticket.update.mockResolvedValue(updatedTicket);

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS", priority: "HIGH" }),
    });
    const response = await PATCH(request, makeParams("ticket-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("IN_PROGRESS");
  });

  it("regular user cannot change status to anything other than CLOSED", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      status: "OPEN",
    });

    const request = new NextRequest("http://localhost:3000/api/tickets/ticket-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    const response = await PATCH(request, makeParams("ticket-1"));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Users can only close tickets");
  });
});
