import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: "sequencing-center" as "sequencing-center" | "shared-lab" | "research-workbench",
  db: {
    study: { findUnique: vi.fn(), findMany: vi.fn() },
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    workbenchWorkspace: { findUnique: vi.fn() },
    exploreProject: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/server", async () => {
  const { getDeploymentProfileDefinition } = await import("@/lib/deployment-profile");
  return { getServerDeploymentProfile: () => getDeploymentProfileDefinition(mocks.profile) };
});

import {
  ExploreAuthorizationError,
  listExploreScopes,
  requireTargetAccess,
  resolveTargetAccess,
  canManageExplore,
  exploreBuildContext,
} from "./authorization";

const researcher = { user: { id: "user-1", role: "RESEARCHER" } } as never;
const admin = { user: { id: "admin-1", role: "FACILITY_ADMIN" } } as never;

describe("explore authorization", () => {
  beforeEach(() => {
    mocks.profile = "sequencing-center";
    mocks.db.exploreProject.findMany.mockResolvedValue([]);
    mocks.db.exploreProject.findUnique.mockResolvedValue(null);
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

  it("preserves scientific access for legacy facility operators", async () => {
    expect((await resolveTargetAccess(admin, "order:o1")).level).toBe("write");
  });

  it.each([
    ["sequencing-center", "ADMIN", "REQUESTER", false, true],
    ["sequencing-center", "MEMBER", "OPERATOR", true, false],
    ["sequencing-center", "MEMBER", "REQUESTER", false, false],
    ["shared-lab", "MEMBER", "REQUESTER", true, false],
    ["shared-lab", "ADMIN", "REQUESTER", true, true],
    ["research-workbench", "ADMIN", "OPERATOR", false, true],
    ["research-workbench", "MEMBER", "REQUESTER", false, false],
  ] as const)("separates %s %s/%s scientific access (%s) from configuration (%s)", async (profile, systemRole, facilityWorkflowRole, scientific, config) => {
    mocks.profile = profile;
    // Explicit new roles must override even a legacy FACILITY_ADMIN value.
    const session = { user: { id: "user-1", role: "FACILITY_ADMIN", systemRole, facilityWorkflowRole } } as never;
    expect((await resolveTargetAccess(session, "study:s1")).level).toBe("write");
    expect((await resolveTargetAccess(session, "order:foreign")).level).toBe(scientific ? "write" : "none");
    expect(canManageExplore(session)).toBe(config);
    expect(exploreBuildContext(session, { type: "study", id: "s1" }, "study:s1")).toMatchObject({
      userId: "user-1", installation: scientific,
      isFacilityAdmin: profile === "shared-lab" || (profile === "sequencing-center" && facilityWorkflowRole === "OPERATOR"),
    });
    mocks.db.workbenchWorkspace.findUnique.mockResolvedValue({ ownerId: "someone-else" });
    mocks.db.exploreProject.findUnique.mockResolvedValue({ ownerId: "someone-else" });
    expect((await resolveTargetAccess(session, "workspace:private")).level).toBe("none");
    expect((await resolveTargetAccess(session, "project:private")).level).toBe("none");
    mocks.db.exploreProject.findUnique.mockResolvedValue({ ownerId: "user-1" });
    expect((await resolveTargetAccess(session, "project:own")).level).toBe("write");

    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
    await listExploreScopes(session);
    expect(mocks.db.study.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scientific ? {} : { userId: "user-1" } }));
    expect(mocks.db.exploreProject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "user-1" } }));
  });

  it.each([
    null,
    { user: { id: "user-1", role: "FACILITY_ADMIN", authorizationValid: false } },
    { user: { id: "user-1", role: "UNKNOWN" } },
    { user: { id: "", role: "FACILITY_ADMIN" } },
  ])("rejects absent or invalidated identities before database access", async session => {
    expect((await resolveTargetAccess(session as never, "study:s1")).level).toBe("none");
    await expect(requireTargetAccess(session as never, "study:s1", "write")).rejects.toMatchObject({ status: 401 });
    expect(await listExploreScopes(session as never)).toEqual([]);
    expect(canManageExplore(session as never)).toBe(false);
    expect(() => exploreBuildContext(session as never, { type: "study", id: "s1" }, "study:s1")).toThrow();
    expect(mocks.db.study.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.study.findMany).not.toHaveBeenCalled();
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
    expect(scopes[0].label).toBe("Cohort");
    expect(scopes[0].detail).toBe("COH");
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
