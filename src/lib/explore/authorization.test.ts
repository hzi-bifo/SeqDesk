import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    study: { findUnique: vi.fn(), findMany: vi.fn() },
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    workbenchWorkspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import {
  ExploreAuthorizationError,
  listExploreScopes,
  requireTargetAccess,
  resolveTargetAccess,
} from "./authorization";

const researcher = { user: { id: "user-1", role: "RESEARCHER" } } as never;
const admin = { user: { id: "admin-1", role: "FACILITY_ADMIN" } } as never;

describe("explore authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.study.findUnique.mockResolvedValue({ userId: "user-1" });
    mocks.db.order.findUnique.mockResolvedValue({ userId: "someone-else" });
    mocks.db.workbenchWorkspace.findUnique.mockResolvedValue({ ownerId: "user-1" });
  });

  it("grants owners write access and denies others without revealing existence", async () => {
    expect((await resolveTargetAccess(researcher, "study:s1")).level).toBe("write");
    expect((await resolveTargetAccess(researcher, "order:o1")).level).toBe("none");
    expect((await resolveTargetAccess(researcher, "workspace:w1")).level).toBe("write");
    expect((await resolveTargetAccess(researcher, "bogus")).level).toBe("none");
  });

  it("grants facility admins write access everywhere", async () => {
    expect((await resolveTargetAccess(admin, "order:o1")).level).toBe("write");
  });

  it("maps denials to 401/404/403", async () => {
    await expect(requireTargetAccess(null, "study:s1", "read")).rejects.toMatchObject({
      status: 401,
    });
    await expect(requireTargetAccess(researcher, "order:o1", "read")).rejects.toMatchObject({
      status: 404,
    });
    mocks.db.study.findUnique.mockResolvedValue(null);
    await expect(requireTargetAccess(researcher, "study:missing", "read")).rejects.toBeInstanceOf(
      ExploreAuthorizationError
    );
  });

  it("lists scopes from owned studies, orders and the workspace", async () => {
    mocks.db.study.findMany.mockResolvedValue([{ id: "s1", title: "Cohort", alias: "COH" }]);
    mocks.db.order.findMany.mockResolvedValue([{ id: "o1", orderNumber: "ORD-1", name: null }]);
    mocks.db.workbenchWorkspace.findUnique.mockResolvedValue({ id: "w1", name: "Private Workbench" });

    const scopes = await listExploreScopes(researcher);

    expect(scopes.map((scope) => scope.targetKey)).toEqual(["study:s1", "order:o1", "workspace:w1"]);
    expect(scopes[0].label).toBe("Cohort (COH)");
    expect(mocks.db.study.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1" });
  });

  it("does not filter by owner for facility admins", async () => {
    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.workbenchWorkspace.findUnique.mockResolvedValue(null);

    await listExploreScopes(admin);

    expect(mocks.db.study.findMany.mock.calls[0][0].where).toEqual({});
  });
});
