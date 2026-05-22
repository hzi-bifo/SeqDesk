import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listWorkbenchStoreItems: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/store", () => ({
  listWorkbenchStoreItems: mocks.listWorkbenchStoreItems,
}));

import { GET } from "./route";

describe("GET /api/workbench/store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.listWorkbenchStoreItems.mockResolvedValue([
      { id: "ncbi-datasets-cli", status: { state: "missing" } },
    ]);
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("lists curated Workbench Store items for authenticated users", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ id: "ncbi-datasets-cli", status: { state: "missing" } }],
    });
  });
});
