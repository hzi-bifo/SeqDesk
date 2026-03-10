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
    },
    study: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    order: {
      create: vi.fn(),
      deleteMany: vi.fn(),
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

    mocks.db.demoWorkspace.findUnique.mockResolvedValue(null);
    mocks.db.demoWorkspace.update.mockResolvedValue({});
    mocks.db.demoWorkspace.findMany.mockResolvedValue([]);
    mocks.db.study.findMany.mockResolvedValue([]);

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
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledTimes(1);
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
});
