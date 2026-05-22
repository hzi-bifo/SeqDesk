import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  listWorkbenchDatasets: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/workspaces", () => ({
  listWorkbenchDatasets: mocks.listWorkbenchDatasets,
}));

import { GET } from "./route";

describe("GET /api/workbench/data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.listWorkbenchDatasets.mockResolvedValue([{ id: "dataset-a" }]);
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("lists only datasets linked to the current user's workspace", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.listWorkbenchDatasets).toHaveBeenCalledWith("user-a");
    expect(await response.json()).toEqual({ datasets: [{ id: "dataset-a" }] });
  });
});
