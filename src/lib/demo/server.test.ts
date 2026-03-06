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
      deleteMany: vi.fn(),
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
    mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) =>
      callback(mocks.db)
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

    mocks.db.user.create.mockResolvedValue({ id: "user-1" });
    mocks.db.demoWorkspace.create.mockResolvedValue({ id: "workspace-1" });
    mocks.db.study.create
      .mockResolvedValueOnce({ id: "study-ready" })
      .mockResolvedValueOnce({ id: "study-pilot" });
    mocks.db.order.create
      .mockResolvedValueOnce({ id: "order-draft" })
      .mockResolvedValueOnce({ id: "order-submitted" })
      .mockResolvedValueOnce({ id: "order-completed" });
    mocks.db.statusNote.create.mockResolvedValue({});

    mocks.db.demoWorkspace.findUnique.mockResolvedValue(null);
    mocks.db.demoWorkspace.update.mockResolvedValue({});
    mocks.db.demoWorkspace.findMany.mockResolvedValue([]);

    mocks.db.statusNote.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.ticketMessage.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.pipelineRun.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.ticket.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.order.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.study.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.demoWorkspace.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.user.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("bootstraps a seeded demo workspace for a new visitor", async () => {
    const result = await bootstrapDemoWorkspace();

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBe("workspace-1");
    expect(result.userId).toBe("user-1");
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);

    expect(mocks.autoSeedIfNeeded).toHaveBeenCalledTimes(1);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.orderFormConfig.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.study.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.order.create).toHaveBeenCalledTimes(3);
    expect(mocks.db.statusNote.create).toHaveBeenCalledTimes(2);

    const submittedOrderArgs = mocks.db.order.create.mock.calls[1][0] as {
      data: {
        customFields: string;
        samples: {
          create: Array<{ study?: { connect: { id: string } } }>;
        };
      };
    };

    expect(JSON.parse(submittedOrderArgs.data.customFields)).toEqual({
      _projects: "Gut recovery cohort\nTimepoint atlas",
    });
    expect(submittedOrderArgs.data.samples.create[0].study?.connect.id).toBe("study-ready");
  });

  it("reuses an existing active workspace for the same browser token", async () => {
    const existingWorkspace = {
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-existing@seqdesk.local",
        firstName: "Demo",
        lastName: "User",
        role: "RESEARCHER",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(existingWorkspace);

    const result = await bootstrapDemoWorkspace("demo-token");

    expect(result).toMatchObject({
      created: false,
      token: "demo-token",
      workspaceId: "workspace-existing",
      userId: "user-existing",
    });
    expect(mocks.db.demoWorkspace.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.db.order.create).not.toHaveBeenCalled();
  });

  it("refreshes an active workspace token into an auth user", async () => {
    const existingWorkspace = {
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-existing@seqdesk.local",
        firstName: "Demo",
        lastName: "User",
        role: "RESEARCHER",
        isDemo: true,
      },
    };
    mocks.db.demoWorkspace.findUnique.mockResolvedValue(existingWorkspace);

    const result = await authorizeDemoWorkspaceToken("demo-token");

    expect(result).toEqual(existingWorkspace.user);
    expect(mocks.db.demoWorkspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-existing" },
      data: expect.objectContaining({
        lastSeenAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("destroys expired workspaces instead of authorizing them", async () => {
    mocks.db.demoWorkspace.findUnique.mockResolvedValue({
      id: "workspace-expired",
      tokenHash: "hash",
      userId: "user-expired",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-05T08:00:00Z"),
      expiresAt: new Date("2026-03-05T09:00:00Z"),
      user: {
        id: "user-expired",
        email: "expired@seqdesk.local",
        firstName: "Demo",
        lastName: "User",
        role: "RESEARCHER",
        isDemo: true,
      },
    });

    const result = await authorizeDemoWorkspaceToken("expired-token");

    expect(result).toBeNull();
    expect(mocks.db.statusNote.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-expired" },
    });
    expect(mocks.db.order.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-expired" },
    });
    expect(mocks.db.demoWorkspace.deleteMany).toHaveBeenCalledWith({
      where: { id: "workspace-expired" },
    });
    expect(mocks.db.user.deleteMany).toHaveBeenCalledWith({
      where: { id: "user-expired" },
    });
  });

  it("resets a browser workspace by deleting the old records and creating a fresh clone", async () => {
    mocks.db.demoWorkspace.findUnique.mockResolvedValue({
      id: "workspace-existing",
      tokenHash: "hash",
      userId: "user-existing",
      seedVersion: 1,
      lastSeenAt: new Date("2026-03-06T08:00:00Z"),
      expiresAt: new Date("2099-03-06T20:00:00Z"),
      user: {
        id: "user-existing",
        email: "demo-existing@seqdesk.local",
        firstName: "Demo",
        lastName: "User",
        role: "RESEARCHER",
        isDemo: true,
      },
    });

    const result = await resetDemoWorkspace("demo-token");

    expect(result.created).toBe(true);
    expect(mocks.db.order.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-existing" },
    });
    expect(mocks.db.user.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.order.create).toHaveBeenCalledTimes(3);
  });

  it("cleans up all expired or outdated workspaces", async () => {
    mocks.db.demoWorkspace.findMany.mockResolvedValue([
      { id: "workspace-a", userId: "user-a" },
      { id: "workspace-b", userId: "user-b" },
    ]);

    const result = await cleanupExpiredDemoWorkspaces();

    expect(result).toEqual({ deletedWorkspaces: 2 });
    expect(mocks.db.user.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: "user-a" },
    });
    expect(mocks.db.user.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: "user-b" },
    });
  });
});
