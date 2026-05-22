import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  startWorkbenchStoreInstall: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/store", () => ({
  startWorkbenchStoreInstall: mocks.startWorkbenchStoreInstall,
}));

import { POST } from "./route";

function params(itemId = "ncbi-datasets-cli") {
  return { params: Promise.resolve({ itemId }) };
}

describe("POST /api/workbench/store/[itemId]/install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-a", role: "FACILITY_ADMIN" },
    });
    mocks.startWorkbenchStoreInstall.mockResolvedValue({
      itemId: "ncbi-datasets-cli",
      state: "running",
    });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost"), params());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("requires facility admin permissions for server tool setup", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-a", role: "RESEARCHER" },
    });

    const response = await POST(new Request("http://localhost"), params());

    expect(response.status).toBe(403);
    expect(mocks.startWorkbenchStoreInstall).not.toHaveBeenCalled();
  });

  it("starts curated Store item setup for admins", async () => {
    const response = await POST(new Request("http://localhost"), params());

    expect(response.status).toBe(202);
    expect(mocks.startWorkbenchStoreInstall).toHaveBeenCalledWith("ncbi-datasets-cli");
    expect(await response.json()).toEqual({
      job: { itemId: "ncbi-datasets-cli", state: "running" },
    });
  });
});
