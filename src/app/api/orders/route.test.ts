import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findFirst: vi.fn(),
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

import { POST } from "./route";

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
});
