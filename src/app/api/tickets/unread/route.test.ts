import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    ticket: {
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

const adminSession = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const userSession = { user: { id: "user-1", role: "RESEARCHER" } };

describe("GET /api/tickets/unread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns unread count for admin based on lastUserMessageAt vs adminReadAt", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "t1",
        lastUserMessageAt: new Date("2024-01-02"),
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: new Date("2024-01-01"),
      },
      {
        id: "t2",
        lastUserMessageAt: new Date("2024-01-01"),
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: new Date("2024-01-02"),
      },
      {
        id: "t3",
        lastUserMessageAt: null,
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: null,
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    // t1: lastUserMessageAt > adminReadAt => unread
    // t2: lastUserMessageAt < adminReadAt => read
    // t3: no lastUserMessageAt => not unread
    expect(data.count).toBe(1);
  });

  it("returns unread count for admin when adminReadAt is null", async () => {
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "t1",
        lastUserMessageAt: new Date("2024-01-02"),
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: null,
      },
    ]);

    const res = await GET();
    const data = await res.json();
    expect(data.count).toBe(1);
  });

  it("returns unread count for researcher based on lastAdminMessageAt vs userReadAt", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "t1",
        lastUserMessageAt: null,
        lastAdminMessageAt: new Date("2024-01-02"),
        userReadAt: new Date("2024-01-01"),
        adminReadAt: null,
      },
      {
        id: "t2",
        lastUserMessageAt: null,
        lastAdminMessageAt: new Date("2024-01-01"),
        userReadAt: new Date("2024-01-02"),
        adminReadAt: null,
      },
    ]);

    const res = await GET();
    const data = await res.json();
    // t1: lastAdminMessageAt > userReadAt => unread
    // t2: lastAdminMessageAt < userReadAt => read
    expect(data.count).toBe(1);
  });

  it("returns unread count for researcher when userReadAt is null", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findMany.mockResolvedValue([
      {
        id: "t1",
        lastUserMessageAt: null,
        lastAdminMessageAt: new Date("2024-01-02"),
        userReadAt: null,
        adminReadAt: null,
      },
    ]);

    const res = await GET();
    const data = await res.json();
    expect(data.count).toBe(1);
  });

  it("returns 0 when no unread tickets", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.count).toBe(0);
  });

  it("returns 500 on database error", async () => {
    mocks.getServerSession.mockResolvedValue(userSession);
    mocks.db.ticket.findMany.mockRejectedValue(new Error("DB error"));

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to get count" });
  });
});
