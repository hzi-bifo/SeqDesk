import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    study: {
      findMany: vi.fn(),
      create: vi.fn(),
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

describe("POST /api/studies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.study.create.mockImplementation(async ({ data }) => ({
      id: "study-1",
      ...data,
    }));
  });

  it("marks studies as E2E-generated when the Playwright header is present", async () => {
    const request = new NextRequest("http://localhost:3000/api/studies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seqdesk-e2e": "playwright",
      },
      body: JSON.stringify({
        title: "Playwright study",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const args = mocks.db.study.create.mock.calls[0][0] as {
      data: { generatedByE2E: boolean; title: string };
    };
    expect(args.data.generatedByE2E).toBe(true);
    expect(args.data.title).toBe("Playwright study");
  });

  it("leaves generatedByE2E false for normal study creation", async () => {
    const request = new NextRequest("http://localhost:3000/api/studies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Manual study",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const args = mocks.db.study.create.mock.calls[0][0] as {
      data: { generatedByE2E: boolean };
    };
    expect(args.data.generatedByE2E).toBe(false);
  });
});
