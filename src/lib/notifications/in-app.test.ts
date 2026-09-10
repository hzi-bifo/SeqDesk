import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    pipelineRun: {
      findUnique: vi.fn(),
    },
    inAppNotification: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  getInAppNotificationSettings: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./settings", () => ({
  getInAppNotificationSettings: mocks.getInAppNotificationSettings,
}));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  archiveInAppNotification,
  createUserInAppNotification,
  listInAppNotifications,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  notifyAppUpdateProgressInApp,
  notifyAppUpdateStartedInApp,
  notifyOrderCreatedInApp,
  notifyOrderUpdatedInApp,
  notifyPipelineRunTerminalInApp,
} from "./in-app";

const user = {
  id: "user-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  isActive: true,
};

const systemAdmin = {
  id: "admin-1",
  role: "FACILITY_ADMIN",
  systemRole: "ADMIN",
  facilityWorkflowRole: "REQUESTER",
  firstName: "System",
  lastName: "Admin",
  email: "admin@example.com",
};

const operator = {
  id: "operator-1",
  role: "RESEARCHER",
  systemRole: "MEMBER",
  facilityWorkflowRole: "OPERATOR",
  firstName: "Facility",
  lastName: "Operator",
  email: "operator@example.com",
};

describe("in-app notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findMany.mockResolvedValue([systemAdmin]);
    mocks.db.inAppNotification.createMany.mockResolvedValue({ count: 1 });
    mocks.db.inAppNotification.updateMany.mockResolvedValue({ count: 1 });
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: true });
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("sequencing-center")
    );
  });

  it("lists visible notifications with unread counts", async () => {
    const createdAt = new Date("2026-05-19T10:00:00.000Z");
    mocks.db.inAppNotification.findMany.mockResolvedValue([
      {
        id: "n-1",
        eventType: "order.updated",
        severity: "info",
        title: "Order updated",
        body: "Details changed",
        linkPath: "/orders/order-1",
        sourceType: "order",
        sourceId: "order-1",
        readAt: null,
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    mocks.db.inAppNotification.count.mockResolvedValue(2);

    const result = await listInAppNotifications("user-1", { limit: 5 });

    expect(mocks.db.inAppNotification.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", archivedAt: null },
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 5,
    });
    expect(result.unreadCount).toBe(2);
    expect(result.notifications[0]).toMatchObject({
      id: "n-1",
      createdAt: "2026-05-19T10:00:00.000Z",
    });
  });

  it("returns an empty list when in-app notifications are disabled", async () => {
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: false });

    const result = await listInAppNotifications("user-1", { limit: 5 });

    expect(result).toEqual({ notifications: [], unreadCount: 0 });
    expect(mocks.db.inAppNotification.findMany).not.toHaveBeenCalled();
    expect(mocks.db.inAppNotification.count).not.toHaveBeenCalled();
  });

  it("creates user-scoped client notifications", async () => {
    await createUserInAppNotification("user-1", {
      severity: "success",
      title: "Saved settings",
      body: "The new settings were saved.",
      linkPath: "/settings",
      sourceType: "settings",
      sourceId: "profile",
    });

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      userId: "user-1",
      eventType: "client.success",
      severity: "success",
      title: "Saved settings",
      body: "The new settings were saved.",
      linkPath: "/settings",
      sourceType: "settings",
      sourceId: "profile",
    });
    expect(data[0].dedupeKey).toContain("client:success:");
  });

  it("skips creating rows when in-app notifications are disabled", async () => {
    mocks.getInAppNotificationSettings.mockResolvedValue({ enabled: false });

    await createUserInAppNotification("user-1", {
      severity: "success",
      title: "Saved settings",
    });

    expect(mocks.db.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("creates order-created notifications for facility operators and excludes the actor", async () => {
    const otherOperator = {
      ...operator,
      id: "operator-2",
      email: "operator2@example.com",
    };
    mocks.db.user.findMany.mockResolvedValue([operator, otherOperator]);
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-20260519-0001",
      name: "RNA order",
      generatedByE2E: false,
      user,
    });
    mocks.db.inAppNotification.createMany.mockResolvedValue({ count: 1 });

    await notifyOrderCreatedInApp("order-1", {
      id: "operator-1",
      name: "Facility Operator",
    });

    expect(mocks.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        select: expect.objectContaining({
          role: true,
          systemRole: true,
          facilityWorkflowRole: true,
        }),
      })
    );
    expect(mocks.db.inAppNotification.createMany).toHaveBeenCalledTimes(1);
    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      userId: "operator-2",
      eventType: "order.created",
      dedupeKey: "order.created:order-1:operator-2",
    });
  });

  it("creates order-updated notifications for owner and operators while excluding the actor", async () => {
    mocks.db.user.findMany.mockResolvedValue([operator]);
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-20260519-0001",
      name: "RNA order",
      status: "SUBMITTED",
      generatedByE2E: false,
      user,
    });

    await notifyOrderUpdatedInApp("order-1", { id: "user-1", name: "Ada Lovelace" });

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      userId: "operator-1",
      eventType: "order.updated",
      sourceType: "order",
      sourceId: "order-1",
    });
  });

  it("does not create a direct order notification for a deactivated owner", async () => {
    mocks.db.user.findMany.mockResolvedValue([operator]);
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-20260519-0001",
      name: "RNA order",
      status: "SUBMITTED",
      generatedByE2E: false,
      user: { ...user, isActive: false },
    });

    await notifyOrderUpdatedInApp("order-1", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });

    expect(mocks.db.inAppNotification.createMany).not.toHaveBeenCalled();
    expect(mocks.db.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          user: {
            select: expect.objectContaining({ isActive: true }),
          },
        }),
      }),
    );
  });

  it("does not create requester/facility counterpart notifications in Shared Lab", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );

    await notifyOrderCreatedInApp("order-1", {
      id: "user-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
    });
    await notifyOrderUpdatedInApp("order-1", {
      id: "user-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
    });

    expect(mocks.db.order.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("deduplicates terminal pipeline notifications per run and recipient", async () => {
    mocks.db.user.findMany.mockResolvedValue([operator]);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runNumber: "MAG-20260519-001",
      pipelineId: "mag",
      status: "completed",
      user,
      order: { id: "order-1", orderNumber: "ORD-20260519-0001", name: null, generatedByE2E: false },
      study: null,
    });

    await notifyPipelineRunTerminalInApp("run-1", "running", "completed");

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user-1",
          eventType: "pipeline.completed",
          severity: "success",
          linkPath: "/analysis/run-1?orderId=order-1&pipeline=mag",
          dedupeKey: "pipeline.completed:run-1:user-1",
        }),
        expect.objectContaining({
          userId: "operator-1",
          dedupeKey: "pipeline.completed:run-1:operator-1",
        }),
      ])
    );
  });

  it("notifies only the run owner for Shared Lab pipeline completion", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runNumber: "MAG-20260519-001",
      pipelineId: "mag",
      status: "completed",
      user,
      order: {
        id: "order-1",
        orderNumber: "ORD-20260519-0001",
        name: null,
        generatedByE2E: false,
      },
      study: null,
    });

    await notifyPipelineRunTerminalInApp("run-1", "running", "completed");

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("user-1");
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("does not notify when the terminal status did not change", async () => {
    await notifyPipelineRunTerminalInApp("run-1", "completed", "completed");

    expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("creates update-started notifications for active system administrators", async () => {
    await notifyAppUpdateStartedInApp({ targetVersion: "2.0.0" });

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      userId: "admin-1",
      eventType: "app.update.started",
      severity: "info",
      title: "SeqDesk update started",
      linkPath: "/admin/settings/system",
      sourceType: "appUpdate",
      sourceId: "2.0.0",
    });
    expect(data[0].dedupeKey).toContain("app.update.started:2.0.0:");
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { systemRole: "ADMIN", isActive: true },
      })
    );
  });

  it("creates repair-started notifications for facility admins", async () => {
    await notifyAppUpdateStartedInApp({ targetVersion: "2.0.0", repair: true });

    const data = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({
      eventType: "app.update.repair_started",
      title: "Update repair started",
      sourceType: "appUpdate",
      sourceId: "2.0.0",
    });
  });

  it("ignores non-terminal update progress notifications", async () => {
    await notifyAppUpdateProgressInApp({
      status: "downloading",
      progress: 25,
      message: "Downloading...",
    });

    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.db.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("deduplicates update completion and failure notifications per version and admin", async () => {
    await notifyAppUpdateProgressInApp({
      status: "complete",
      progress: 100,
      message: "Update complete.",
    }, { targetVersion: "2.0.0" });
    await notifyAppUpdateProgressInApp({
      status: "error",
      progress: 0,
      message: "Update failed",
      error: "Migration failed",
    }, { targetVersion: "2.0.0" });

    const completeData = mocks.db.inAppNotification.createMany.mock.calls[0][0].data;
    const failedData = mocks.db.inAppNotification.createMany.mock.calls[1][0].data;
    expect(completeData[0]).toMatchObject({
      eventType: "app.update.completed",
      severity: "success",
      linkPath: "/admin/settings/system",
      dedupeKey: "app.update.completed:2.0.0:admin-1",
    });
    expect(failedData[0]).toMatchObject({
      eventType: "app.update.failed",
      severity: "error",
      linkPath: "/admin/settings/system",
      body: "Migration failed",
      dedupeKey: "app.update.failed:2.0.0:Migration failed:admin-1",
    });
  });

  it("marks read, archives, and marks all visible notifications read by user", async () => {
    await markInAppNotificationRead("user-1", "n-1");
    await archiveInAppNotification("user-1", "n-1");
    await markAllInAppNotificationsRead("user-1");

    expect(mocks.db.inAppNotification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "n-1", userId: "user-1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(mocks.db.inAppNotification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "n-1", userId: "user-1", archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
    expect(mocks.db.inAppNotification.updateMany).toHaveBeenNthCalledWith(3, {
      where: { userId: "user-1", archivedAt: null, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
