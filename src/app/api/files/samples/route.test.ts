import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    sample: {
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

describe("GET /api/files/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.sample.findMany.mockResolvedValue([]);
  });

  it("uses case-insensitive filters for interactive search", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/files/samples?search=AbC123"
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.db.sample.findMany).toHaveBeenCalledTimes(1);
    const args = mocks.db.sample.findMany.mock.calls[0][0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(args.where.OR).toEqual([
      { sampleId: { contains: "AbC123", mode: "insensitive" } },
      { sampleAlias: { contains: "AbC123", mode: "insensitive" } },
      { sampleTitle: { contains: "AbC123", mode: "insensitive" } },
      { order: { name: { contains: "AbC123", mode: "insensitive" } } },
      {
        order: {
          orderNumber: { contains: "AbC123", mode: "insensitive" },
        },
      },
    ]);
  });
});
