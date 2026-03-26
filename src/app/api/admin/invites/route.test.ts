import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    adminInvite: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
  randomBytes: vi.fn(),
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

vi.mock("crypto", () => ({
  randomBytes: mocks.randomBytes,
}));

// Mock Prisma error class
vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { GET, POST } from "./route";

describe("GET /api/admin/invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns invites for admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const invites = [
      {
        id: "inv-1",
        code: "ABCD1234",
        email: null,
        createdBy: { firstName: "Admin", lastName: "User" },
        usedBy: null,
      },
    ];
    mocks.db.adminInvite.findMany.mockResolvedValue(invites);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].code).toBe("ABCD1234");
  });
});

describe("POST /api/admin/invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.randomBytes.mockReturnValue({
      toString: () => "abcd1234",
    });
  });

  it("returns 401 when not admin", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("creates invite with email", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const createdInvite = {
      id: "inv-1",
      code: "ABCD1234",
      email: "test@example.com",
      createdBy: { firstName: "Admin", lastName: "User" },
    };
    mocks.db.adminInvite.create.mockResolvedValue(createdInvite);

    const request = new NextRequest("http://localhost:3000/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Test@Example.com", expiresInDays: 7 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.code).toBe("ABCD1234");
    // Verify email was normalized to lowercase
    const createCall = mocks.db.adminInvite.create.mock.calls[0][0];
    expect(createCall.data.email).toBe("test@example.com");
  });

  it("creates invite without email", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    const createdInvite = {
      id: "inv-1",
      code: "ABCD1234",
      email: null,
      createdBy: { firstName: "Admin", lastName: "User" },
    };
    mocks.db.adminInvite.create.mockResolvedValue(createdInvite);

    const request = new NextRequest("http://localhost:3000/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it("returns 400 for invalid email", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("email");
  });

  it("returns 400 for invalid expiresInDays", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresInDays: 999 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("expiresInDays");
  });
});
