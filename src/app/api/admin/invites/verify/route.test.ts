import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: {
    adminInvite: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { POST } from "./route";

describe("POST /api/admin/invites/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no code provided", async () => {
    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("Invite code is required");
  });

  it("returns 404 when invite not found", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: "BADCODE" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("Invalid invite code");
  });

  it("returns 400 when invite already used", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      code: "ABC123",
      email: "test@example.com",
      usedAt: new Date("2024-01-01"),
      expiresAt: new Date("2025-01-01"),
    });

    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("This invite has already been used");
  });

  it("returns 400 when invite expired", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      code: "ABC123",
      email: "test@example.com",
      usedAt: null,
      expiresAt: new Date("2020-01-01"),
    });

    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("This invite has expired");
  });

  it("returns 200 with valid invite", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      code: "ABC123",
      email: "test@example.com",
      usedAt: null,
      expiresAt: new Date("2099-01-01"),
    });

    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: "abc123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.email).toBe("test@example.com");
    // Code should be uppercased for lookup
    expect(mocks.db.adminInvite.findUnique).toHaveBeenCalledWith({
      where: { code: "ABC123" },
    });
  });

  it("returns 500 on database error", async () => {
    mocks.db.adminInvite.findUnique.mockRejectedValue(new Error("DB error"));

    const req = new NextRequest("http://localhost/api/admin/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("Failed to verify invite");
  });
});
