import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    department: {
      findUnique: vi.fn(),
    },
    adminInvite: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  hash: mocks.hash,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/modules/types", () => ({
  DEFAULT_MODULE_STATES: {},
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS: {
    allowedDomains: [],
    enforceValidation: false,
  },
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: "new@example.com",
  password: "securepassword",
  firstName: "Jane",
  lastName: "Doe",
  role: "RESEARCHER",
};

describe("POST /api/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue("hashed-pw");
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.user.findUnique.mockResolvedValue(null);
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          create: vi.fn().mockResolvedValue({
            id: "user-1",
            email: "new@example.com",
            firstName: "Jane",
            lastName: "Doe",
            role: "RESEARCHER",
          }),
        },
        adminInvite: { update: vi.fn() },
      };
      return fn(tx);
    });
  });

  it("creates a researcher and returns 201", async () => {
    const response = await POST(makeRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.user.email).toBe("new@example.com");
    expect(mocks.hash).toHaveBeenCalledWith("securepassword", 12);
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(makeRequest({ email: "a@b.com" }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required fields");
  });

  it("returns 400 for invalid role", async () => {
    const response = await POST(makeRequest({ ...validBody, role: "SUPERADMIN" }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid role");
  });

  it("returns 400 when email already exists", async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: "existing" });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("User with this email already exists");
  });

  it("returns 400 when FACILITY_ADMIN lacks invite code", async () => {
    const response = await POST(
      makeRequest({ ...validBody, role: "FACILITY_ADMIN" })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Admin registration requires an invite code");
  });
});
