import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    department: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET } from "./route";

describe("GET /api/departments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active departments ordered by name", async () => {
    mocks.db.department.findMany.mockResolvedValue([
      { id: "dept-1", name: "Alpha", description: "First" },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: "dept-1", name: "Alpha", description: "First" },
    ]);
    expect(mocks.db.department.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
  });

  it("returns 500 when fetching departments fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.db.department.findMany.mockRejectedValue(new Error("db down"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch departments",
    });
  });
});
