import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isExploreModuleEnabled: vi.fn(),
  listExploreScopes: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, listExploreScopes: mocks.listExploreScopes };
});
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "./route";

describe("/api/explore/scopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isExploreModuleEnabled.mockResolvedValue(true);
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.listExploreScopes.mockResolvedValue([{ targetKey: "study:s1", type: "study", label: "Cohort", access: "write" }]);
  });

  it("answers 404 when the module is disabled", async () => {
    mocks.isExploreModuleEnabled.mockResolvedValue(false);
    expect((await GET()).status).toBe(404);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("lists the scopes of the session", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scopes: [{ targetKey: "study:s1", type: "study", label: "Cohort", access: "write" }],
    });
  });
});
