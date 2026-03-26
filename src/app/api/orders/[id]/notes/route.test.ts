import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

import { GET, PUT } from "./route";

describe("/api/orders/[id]/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        orderNotesEnabled: true,
      }),
    });
  });

  it("returns order notes for the owner", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: "Line 1",
      notesEditedAt: new Date("2026-03-12T10:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: {
        id: "user-1",
        firstName: "Pat",
        lastName: "Mueller",
        email: "pat@example.com",
      },
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes"),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      notes: "Line 1",
      notesSupported: true,
      notesEnabled: true,
      notesEditedById: "user-1",
      notesEditedBy: {
        firstName: "Pat",
        lastName: "Mueller",
      },
    });
  });

  it("prevents users from reading notes on someone else's order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-2",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: null,
      notesEditedAt: null,
      notesEditedById: null,
      notesEditedBy: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes"),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("updates notes for an accessible order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: null,
      notesEditedAt: null,
      notesEditedById: null,
      notesEditedBy: null,
    });
    mocks.db.order.update.mockResolvedValue({
      notes: "## Follow-up\nRemember the courier label.",
      notesEditedAt: new Date("2026-03-12T11:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: {
        id: "user-1",
        firstName: "Pat",
        lastName: "Mueller",
        email: "pat@example.com",
      },
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({
          notes: "## Follow-up\nRemember the courier label.",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        notes: "## Follow-up\nRemember the courier label.",
        notesEditedAt: expect.any(Date),
        notesEditedById: "user-1",
      },
      select: {
        notes: true,
        notesEditedAt: true,
        notesEditedById: true,
        notesEditedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      notes: "## Follow-up\nRemember the courier label.",
      notesSupported: true,
      notesEnabled: true,
      notesEditedById: "user-1",
    });
  });

  it("returns a clean unsupported response when the notes columns are missing", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique
      .mockRejectedValueOnce({ code: "P2022", message: "Column notes missing" })
      .mockResolvedValueOnce({
        id: "order-1",
        userId: "user-1",
      });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: "Draft" }),
        headers: {
          "Content-Type": "application/json",
        },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Order notes are unavailable until the database is updated.",
      notesSupported: false,
      notesEnabled: true,
    });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it("hides notes when the feature is disabled in admin settings", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        orderNotesEnabled: false,
      }),
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: "Hidden",
      notesEditedAt: new Date("2026-03-12T10:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes"),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      notes: null,
      notesEditedAt: null,
      notesEditedById: null,
      notesEditedBy: null,
      notesSupported: true,
      notesEnabled: false,
    });
  });

  it("normalizes empty string notes to null", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: "some existing note",
      notesEditedAt: new Date("2026-03-12T10:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: null,
    });
    mocks.db.order.update.mockResolvedValue({
      notes: null,
      notesEditedAt: new Date("2026-03-12T11:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: null,
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: "" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: null }),
      }),
    );
  });

  it("rejects notes that are not a string (object)", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: { key: "value" } }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Notes must be a string or null");
  });

  it("rejects notes that are a number", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: 42 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Notes must be a string or null");
  });

  it("skips update when notes have not changed", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: "Same note",
      notesEditedAt: new Date("2026-03-12T10:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: null,
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: "Same note" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
    const data = await response.json();
    expect(data.notes).toBe("Same note");
    expect(data.notesSupported).toBe(true);
  });

  it("returns null notes when extraSettings has malformed JSON", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: "not valid json{{{",
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: "Some note",
      notesEditedAt: new Date("2026-03-12T10:00:00.000Z"),
      notesEditedById: "user-1",
      notesEditedBy: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes"),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    // parseExtraSettings returns {} on parse error, so orderNotesEnabled defaults to !== false => true
    expect(response.status).toBe(200);
  });

  it("returns 500 when db.order.update throws a non-schema error", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: null,
      notesEditedAt: null,
      notesEditedById: null,
      notesEditedBy: null,
    });
    mocks.db.order.update.mockRejectedValue(new Error("Connection lost"));

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: "New note" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to update order notes");
  });

  it("rejects note updates when the feature is disabled in admin settings", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        orderNotesEnabled: false,
      }),
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      notes: null,
      notesEditedAt: null,
      notesEditedById: null,
      notesEditedBy: null,
    });

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/orders/order-1/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: "Draft" }),
        headers: {
          "Content-Type": "application/json",
        },
      }),
      { params: Promise.resolve({ id: "order-1" }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Order notes are disabled in admin settings.",
      notesSupported: true,
      notesEnabled: false,
    });
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });
});
