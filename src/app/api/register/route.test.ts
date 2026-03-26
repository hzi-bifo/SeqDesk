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

  it("creates admin with valid invite code and returns 201", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "VALIDCODE",
      usedAt: null,
      expiresAt: new Date(Date.now() + 86400000), // tomorrow
      email: null,
    });
    mocks.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          create: vi.fn().mockResolvedValue({
            id: "admin-1",
            email: "admin@example.com",
            firstName: "Admin",
            lastName: "User",
            role: "FACILITY_ADMIN",
          }),
        },
        adminInvite: { update: vi.fn() },
      };
      return fn(tx);
    });

    const response = await POST(
      makeRequest({
        ...validBody,
        email: "admin@example.com",
        role: "FACILITY_ADMIN",
        inviteCode: "validcode",
        facilityName: "Core Lab",
      })
    );

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.user.role).toBe("FACILITY_ADMIN");
  });

  it("returns 400 for invalid invite code", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        ...validBody,
        role: "FACILITY_ADMIN",
        inviteCode: "BADCODE",
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid invite code");
  });

  it("returns 400 for already-used invite", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "USEDCODE",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      email: null,
    });

    const response = await POST(
      makeRequest({
        ...validBody,
        role: "FACILITY_ADMIN",
        inviteCode: "USEDCODE",
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("This invite has already been used");
  });

  it("returns 400 for expired invite", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "EXPIRED",
      usedAt: null,
      expiresAt: new Date(Date.now() - 86400000), // yesterday
      email: null,
    });

    const response = await POST(
      makeRequest({
        ...validBody,
        role: "FACILITY_ADMIN",
        inviteCode: "EXPIRED",
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("This invite has expired");
  });

  it("returns 400 when invite email restriction does not match", async () => {
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "RESTRICTED",
      usedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      email: "specific@example.com",
    });

    const response = await POST(
      makeRequest({
        ...validBody,
        email: "other@example.com",
        role: "FACILITY_ADMIN",
        inviteCode: "RESTRICTED",
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("This invite is for a different email address");
  });

  it("returns 400 for non-existent department", async () => {
    mocks.db.department.findUnique.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ ...validBody, departmentId: "bad-dept" })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid department selected");
  });

  it("returns 400 for inactive department", async () => {
    mocks.db.department.findUnique.mockResolvedValue({
      id: "dept-1",
      isActive: false,
    });

    const response = await POST(
      makeRequest({ ...validBody, departmentId: "dept-1" })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid department selected");
  });

  it("creates researcher with valid department", async () => {
    mocks.db.department.findUnique.mockResolvedValue({
      id: "dept-1",
      isActive: true,
    });

    const response = await POST(
      makeRequest({ ...validBody, departmentId: "dept-1", institution: "HZI" })
    );

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.user.email).toBe("new@example.com");
  });

  it("returns 400 when email domain is restricted", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "account-validation": true },
        globalDisabled: false,
      }),
      extraSettings: JSON.stringify({
        accountValidationSettings: JSON.stringify({
          allowedDomains: ["allowed.org"],
          enforceValidation: true,
        }),
      }),
    });

    const response = await POST(
      makeRequest({ ...validBody, email: "user@blocked.com" })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.code).toBe("INVALID_EMAIL_DOMAIN");
  });

  it("returns 500 on unexpected error", async () => {
    mocks.db.$transaction.mockRejectedValue(new Error("DB crash"));

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Something went wrong");
  });
});
