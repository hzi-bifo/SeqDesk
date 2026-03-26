import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoSeedIfNeeded: vi.fn(),
  hash: vi.fn(),
  db: {
    $transaction: vi.fn(),
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    orderFormConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    demoWorkspace: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    study: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    order: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
    statusNote: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    ticketMessage: {
      deleteMany: vi.fn(),
    },
    pipelineRun: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    pipelineRunStep: {
      create: vi.fn(),
    },
    pipelineRunEvent: {
      create: vi.fn(),
    },
    pipelineArtifact: {
      create: vi.fn(),
    },
    assembly: {
      create: vi.fn(),
    },
    bin: {
      create: vi.fn(),
    },
    read: {
      create: vi.fn(),
    },
    ticket: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  hash: mocks.hash,
}));

vi.mock("@/lib/auto-seed", () => ({
  autoSeedIfNeeded: mocks.autoSeedIfNeeded,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./config", () => ({
  DEMO_SEED_VERSION: 1,
  DEMO_SESSION_TTL_HOURS: 12,
  DEMO_WORKSPACE_COOKIE: "seqdesk-demo-workspace",
  isPublicDemoEnabled: () => true,
}));

import {
  authorizeDemoWorkspaceToken,
  bootstrapDemoWorkspace,
  cleanupExpiredDemoWorkspaces,
  getDemoWorkspaceCookieName,
  getDemoCookieOptions,
  getAuthSessionCookieName,
  getAuthSessionCookieOptions,
  isDemoSession,
  getDemoExperience,
  isResearcherDemoSession,
  isFacilityDemoSession,
  resetDemoWorkspace,
} from "./server";

describe("demo workspace server helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.hash.mockResolvedValue("hashed-demo-password");
    mocks.autoSeedIfNeeded.mockResolvedValue({ seeded: false });
    mocks.db.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db)
    );

    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        studyFormFields: [{ name: "principal_investigator" }],
      }),
    });
    mocks.db.siteSettings.upsert.mockResolvedValue({});

    mocks.db.orderFormConfig.findUnique.mockResolvedValue({
      id: "singleton",
      schema: JSON.stringify({
        fields: [
          {
            id: "name",
            type: "text",
            label: "Order Name",
            name: "name",
            required: true,
            visible: true,
            order: 0,
            groupId: "group_details",
          },
        ],
      }),
    });
    mocks.db.orderFormConfig.update.mockResolvedValue({});

    mocks.db.user.create
      .mockResolvedValueOnce({ id: "user-1" })
      .mockResolvedValueOnce({ id: "admin-1" });
    mocks.db.demoWorkspace.create.mockResolvedValue({ id: "workspace-1" });
    mocks.db.study.create
      .mockResolvedValueOnce({ id: "study-ready" })
      .mockResolvedValueOnce({ id: "study-pilot" });
    mocks.db.order.create
      .mockResolvedValueOnce({ id: "order-draft" })
      .mockResolvedValueOnce({
        id: "order-submitted",
        samples: [
          { id: "sample-sub-1", sampleId: "GR-01" },
          { id: "sample-sub-2", sampleId: "GR-02" },
          { id: "sample-sub-3", sampleId: "GR-03" },
        ],
      })
      .mockResolvedValueOnce({
        id: "order-completed",
        samples: [
          { id: "sample-comp-1", sampleId: "SR-01" },
          { id: "sample-comp-2", sampleId: "SR-02" },
        ],
      });
    mocks.db.statusNote.create.mockResolvedValue({});
    mocks.db.pipelineRun.create.mockResolvedValue({ id: "run-1" });
    mocks.db.pipelineRunStep.create.mockResolvedValue({});
    mocks.db.pipelineRunEvent.create.mockResolvedValue({});
    mocks.db.pipelineArtifact.create.mockResolvedValue({});
    mocks.db.assembly.create.mockResolvedValue({});
    mocks.db.bin.create.mockResolvedValue({});
    mocks.db.read.create.mockResolvedValue({});

    mocks.db.demoWorkspace.findUnique.mockResolvedValue(null);
    mocks.db.demoWorkspace.update.mockResolvedValue({});
    mocks.db.demoWorkspace.findMany.mockResolvedValue([]);
    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.user.findMany.mockResolvedValue([]);

    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.read.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    mocks.db.statusNote.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.ticketMessage.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRun.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.ticket.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.order.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.study.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.demoWorkspace.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.user.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("bootstraps a shared demo workspace with researcher and facility personas", async () => {
    const result = await bootstrapDemoWorkspace(undefined, "researcher");

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBe("workspace-1");
    expect(result.userId).toBe("user-1");
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);

    expect(mocks.autoSeedIfNeeded).toHaveBeenCalledTimes(1);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderFormConfig.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.study.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.order.create).toHaveBeenCalledTimes(3);
    expect(mocks.db.statusNote.create).toHaveBeenCalledTimes(3);
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledTimes(4);
    expect(mocks.db.pipelineRunStep.create).toHaveBeenCalledTimes(3);
    expect(mocks.db.pipelineRunEvent.create).toHaveBeenCalledTimes(3);
  });

  it("reuses an existing active workspace for the facility persona", async () => {
    const existingWorkspace = {
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      adminUserId: "admin-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-existing",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(existingWorkspace);

    const result = await bootstrapDemoWorkspace("demo-token", "facility");

    expect(result).toMatchObject({
      created: false,
      token: "demo-token",
      workspaceId: "workspace-existing",
      userId: "admin-existing",
    });
    expect(mocks.db.demoWorkspace.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.db.order.create).not.toHaveBeenCalled();
  });

  it("authorizes the requested facility persona for an active workspace", async () => {
    mocks.db.demoWorkspace.findUnique.mockResolvedValue({
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      adminUserId: "admin-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-existing",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    const result = await authorizeDemoWorkspaceToken("demo-token", "facility");

    expect(result).toEqual({
      id: "admin-existing",
      email: "demo-facility@seqdesk.local",
      firstName: "Facility",
      lastName: "Admin",
      role: "FACILITY_ADMIN",
      isDemo: true,
      demoExperience: "facility",
    });
    expect(mocks.db.demoWorkspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-existing" },
      data: expect.objectContaining({
        lastSeenAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("resets an existing workspace while preserving its shared workspace token", async () => {
    const existingWorkspace = {
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      adminUserId: "admin-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-existing",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(existingWorkspace);
    mocks.db.study.findMany.mockResolvedValue([{ id: "study-ready" }]);

    const result = await resetDemoWorkspace("demo-token", "facility");

    expect(result.created).toBe(true);
    expect(result.token).toBe("demo-token");
    expect(result.userId).toBe("admin-1");
    expect(mocks.db.demoWorkspace.deleteMany).toHaveBeenCalledWith({
      where: { id: "workspace-existing" },
    });
  });

  it("cleans up expired shared workspaces and both demo users", async () => {
    mocks.db.demoWorkspace.findMany.mockResolvedValue([
      {
        id: "workspace-expired",
        userId: "user-expired",
        adminUserId: "admin-expired",
      },
    ]);
    mocks.db.study.findMany.mockResolvedValue([{ id: "study-expired" }]);

    const result = await cleanupExpiredDemoWorkspaces();

    expect(result).toEqual({ deletedWorkspaces: 1 });
    expect(mocks.db.pipelineRun.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            userId: {
              in: ["user-expired", "admin-expired"],
            },
          },
          {
            studyId: {
              in: ["study-expired"],
            },
          },
        ],
      },
    });
    expect(mocks.db.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["user-expired", "admin-expired"],
        },
      },
    });
  });

  it("cleanupExpiredDemoWorkspaces returns zero when no expired workspaces found", async () => {
    mocks.db.demoWorkspace.findMany.mockResolvedValue([]);

    const result = await cleanupExpiredDemoWorkspaces();

    expect(result).toEqual({ deletedWorkspaces: 0 });
    expect(mocks.db.user.deleteMany).not.toHaveBeenCalled();
  });

  it("authorizeDemoWorkspaceToken returns null for null token", async () => {
    const result = await authorizeDemoWorkspaceToken(null);
    expect(result).toBeNull();
  });

  it("authorizeDemoWorkspaceToken returns null for empty string token", async () => {
    const result = await authorizeDemoWorkspaceToken("");
    expect(result).toBeNull();
  });

  it("authorizeDemoWorkspaceToken returns null for non-existent workspace", async () => {
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(null);

    const result = await authorizeDemoWorkspaceToken("nonexistent-token");
    expect(result).toBeNull();
  });

  it("authorizeDemoWorkspaceToken destroys expired workspace and returns null", async () => {
    const expiredWorkspace = {
      id: "workspace-expired",
      tokenHash: "hash",
      userId: "user-expired",
      adminUserId: "admin-expired",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      user: {
        id: "user-expired",
        email: "demo@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-expired",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(expiredWorkspace);
    mocks.db.study.findMany.mockResolvedValue([]);

    const result = await authorizeDemoWorkspaceToken("expired-token");
    expect(result).toBeNull();
  });

  it("bootstrapDemoWorkspace creates a new workspace when no token is provided", async () => {
    const result = await bootstrapDemoWorkspace(undefined, "facility");

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBe("workspace-1");
    expect(result.userId).toBe("admin-1");
  });

  it("resetDemoWorkspace creates new workspace even without a token", async () => {
    const result = await resetDemoWorkspace(undefined, "researcher");

    expect(result.created).toBe(true);
    expect(result.userId).toBe("user-1");
  });
});

describe("isDemoSession", () => {
  it("returns false for null session", () => {
    expect(isDemoSession(null)).toBe(false);
  });

  it("returns false for undefined session", () => {
    expect(isDemoSession(undefined)).toBe(false);
  });

  it("returns false for non-demo user", () => {
    expect(
      isDemoSession({ user: { isDemo: false } } as never)
    ).toBe(false);
  });

  it("returns true for demo user", () => {
    expect(
      isDemoSession({ user: { isDemo: true } } as never)
    ).toBe(true);
  });
});

describe("getDemoExperience", () => {
  it("returns null for non-demo session", () => {
    expect(getDemoExperience({ user: { isDemo: false } } as never)).toBeNull();
  });

  it("returns null for null session", () => {
    expect(getDemoExperience(null)).toBeNull();
  });

  it("returns researcher for demo session with researcher experience", () => {
    expect(
      getDemoExperience({
        user: { isDemo: true, demoExperience: "researcher" },
      } as never)
    ).toBe("researcher");
  });

  it("returns facility for demo session with facility experience", () => {
    expect(
      getDemoExperience({
        user: { isDemo: true, demoExperience: "facility" },
      } as never)
    ).toBe("facility");
  });
});

describe("isResearcherDemoSession", () => {
  it("returns true for researcher demo session", () => {
    expect(
      isResearcherDemoSession({
        user: { isDemo: true, demoExperience: "researcher" },
      } as never)
    ).toBe(true);
  });

  it("returns false for facility demo session", () => {
    expect(
      isResearcherDemoSession({
        user: { isDemo: true, demoExperience: "facility" },
      } as never)
    ).toBe(false);
  });
});

describe("isFacilityDemoSession", () => {
  it("returns true for facility demo session", () => {
    expect(
      isFacilityDemoSession({
        user: { isDemo: true, demoExperience: "facility" },
      } as never)
    ).toBe(true);
  });

  it("returns false for researcher demo session", () => {
    expect(
      isFacilityDemoSession({
        user: { isDemo: true, demoExperience: "researcher" },
      } as never)
    ).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("getDemoWorkspaceCookieName returns the workspace cookie name", () => {
    expect(getDemoWorkspaceCookieName()).toBe("seqdesk-demo-workspace");
  });

  it("getDemoCookieOptions returns httpOnly lax cookie", () => {
    const options = getDemoCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.expires).toBeInstanceOf(Date);
    expect(options.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("getAuthSessionCookieName returns non-secure name in dev", () => {
    const name = getAuthSessionCookieName();
    expect(name).toBe("next-auth.session-token");
  });

  it("getAuthSessionCookieOptions returns options with expiry", () => {
    const expiresAt = new Date("2099-01-01");
    const options = getAuthSessionCookieOptions(expiresAt);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.expires).toBe(expiresAt);
  });
});

describe("bootstrapDemoWorkspace edge cases", () => {
  it("recreates workspace when existing token has expired (stale seedVersion)", async () => {
    const staleWorkspace = {
      id: "workspace-stale",
      tokenHash: "hash",
      userId: "user-stale",
      adminUserId: "admin-stale",
      seedVersion: 0, // Old seed version
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-stale",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-stale",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    };
    // First call finds the stale workspace, subsequent calls return null (after destroy)
    mocks.db.demoWorkspace.findUnique.mockResolvedValueOnce(staleWorkspace).mockResolvedValue(null);
    mocks.db.study.findMany.mockResolvedValue([]);
    // Re-set user.create mocks for the recreation
    mocks.db.user.create
      .mockResolvedValueOnce({ id: "user-new" })
      .mockResolvedValueOnce({ id: "admin-new" });
    mocks.db.demoWorkspace.create.mockResolvedValue({ id: "workspace-new" });
    mocks.db.study.create
      .mockResolvedValueOnce({ id: "study-1" })
      .mockResolvedValueOnce({ id: "study-2" });
    mocks.db.order.create
      .mockResolvedValueOnce({ id: "order-1" })
      .mockResolvedValueOnce({ id: "order-2", samples: [{ id: "s1", sampleId: "GR-01" }] })
      .mockResolvedValueOnce({ id: "order-3", samples: [{ id: "s2", sampleId: "SR-01" }] });

    const result = await bootstrapDemoWorkspace("stale-token", "researcher");

    expect(result.created).toBe(true);
    expect(result.token).toBe("stale-token");
  });

  it("recreates workspace when existing token has no adminUser", async () => {
    const noAdminWorkspace = {
      id: "workspace-noadmin",
      tokenHash: "hash",
      userId: "user-noadmin",
      adminUserId: null,
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-noadmin",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: null,
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValueOnce(noAdminWorkspace).mockResolvedValue(null);
    mocks.db.study.findMany.mockResolvedValue([]);
    mocks.db.user.create
      .mockResolvedValueOnce({ id: "user-new" })
      .mockResolvedValueOnce({ id: "admin-new" });
    mocks.db.demoWorkspace.create.mockResolvedValue({ id: "workspace-new" });
    mocks.db.study.create
      .mockResolvedValueOnce({ id: "study-1" })
      .mockResolvedValueOnce({ id: "study-2" });
    mocks.db.order.create
      .mockResolvedValueOnce({ id: "order-1" })
      .mockResolvedValueOnce({ id: "order-2", samples: [{ id: "s1", sampleId: "GR-01" }] })
      .mockResolvedValueOnce({ id: "order-3", samples: [{ id: "s2", sampleId: "SR-01" }] });

    const result = await bootstrapDemoWorkspace("noadmin-token", "facility");

    expect(result.created).toBe(true);
    expect(result.token).toBe("noadmin-token");
  });
});

describe("authorizeDemoWorkspaceToken edge cases", () => {
  it("returns null when workspace user lookup fails for the researcher persona", async () => {
    const workspaceNoUser = {
      id: "workspace-nouser",
      tokenHash: "hash",
      userId: "user-exists",
      adminUserId: "admin-exists",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: null as unknown as { id: string; email: string; firstName: string; lastName: string; role: string; isDemo: boolean },
      adminUser: {
        id: "admin-exists",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(workspaceNoUser);

    // workspace.user is null, so isWorkspaceReusable will fail
    // Actually, the null user won't crash isWorkspaceReusable because it checks adminUserId && adminUser && seedVersion && expiry
    // But selectWorkspaceUser returns null for researcher when user is null
    // Actually isWorkspaceReusable doesn't check user, only adminUser. So it will pass the reusable check
    // but then selectWorkspaceUser for researcher returns workspace.user which is null
    const result = await authorizeDemoWorkspaceToken("valid-token", "researcher");
    expect(result).toBeNull();
  });

  it("returns researcher persona for default demoExperience", async () => {
    mocks.db.demoWorkspace.findUnique.mockResolvedValue({
      id: "workspace-default",
      tokenHash: "hash",
      userId: "user-default",
      adminUserId: "admin-default",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-default",
        email: "demo-researcher@seqdesk.local",
        firstName: "Demo",
        lastName: "Researcher",
        role: "RESEARCHER",
        isDemo: true,
      },
      adminUser: {
        id: "admin-default",
        email: "demo-facility@seqdesk.local",
        firstName: "Facility",
        lastName: "Admin",
        role: "FACILITY_ADMIN",
        isDemo: true,
      },
    });

    // Default experience is researcher
    const result = await authorizeDemoWorkspaceToken("demo-token");
    expect(result).toMatchObject({
      id: "user-default",
      role: "RESEARCHER",
      demoExperience: "researcher",
    });
  });
});

describe("cleanupExpiredDemoWorkspaces with multiple workspaces", () => {
  it("cleans up multiple expired workspaces by iterating each", async () => {
    mocks.db.demoWorkspace.findMany.mockResolvedValue([
      {
        id: "ws-1",
        userId: "user-1",
        adminUserId: "admin-1",
      },
      {
        id: "ws-2",
        userId: "user-2",
        adminUserId: "admin-2",
      },
    ]);
    mocks.db.study.findMany.mockResolvedValue([]);

    const result = await cleanupExpiredDemoWorkspaces();

    expect(result).toEqual({ deletedWorkspaces: 2 });
    // user.deleteMany should have been called for each workspace
    expect(mocks.db.user.deleteMany).toHaveBeenCalled();
    // The first call should be for ws-1
    expect(mocks.db.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "admin-1"] } },
    });
    // The second call should be for ws-2
    expect(mocks.db.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-2", "admin-2"] } },
    });
  });

  it("handles workspaces without adminUserId", async () => {
    mocks.db.demoWorkspace.findMany.mockResolvedValue([
      {
        id: "ws-1",
        userId: "user-1",
        adminUserId: null,
      },
    ]);
    mocks.db.study.findMany.mockResolvedValue([]);

    const result = await cleanupExpiredDemoWorkspaces();

    expect(result).toEqual({ deletedWorkspaces: 1 });
    expect(mocks.db.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["user-1"],
        },
      },
    });
  });
});
