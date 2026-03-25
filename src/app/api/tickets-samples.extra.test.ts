import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  ticketReferencesSupported: vi.fn(),
  db: {
    ticket: {
      findMany: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
    study: {
      findMany: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/tickets/reference-support", () => ({
  ticketReferencesSupported: mocks.ticketReferencesSupported,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET as getUnreadTickets } from "./tickets/unread/route";
import { GET as getReferenceOptions } from "./tickets/reference-options/route";
import { GET as getSamples } from "./samples/route";
import { DELETE as unassignSampleStudy } from "./samples/[id]/study/route";

describe("ticket and sample route quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.ticketReferencesSupported.mockResolvedValue(true);
    mocks.db.ticket.findMany.mockResolvedValue([]);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ departmentSharing: true }),
    });
    mocks.db.user.findUnique.mockResolvedValue({ departmentId: "dep-1" });
    mocks.db.order.findMany.mockResolvedValue([
      { id: "order-1", orderNumber: 42, name: "Order One" },
    ]);
    mocks.db.study.findMany.mockResolvedValue([
      { id: "study-1", title: "Study One" },
    ]);
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "S1",
        sampleTitle: "Sample One",
        studyId: null,
      },
    ]);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-1",
      order: { userId: "user-1" },
    });
    mocks.db.sample.update.mockResolvedValue({ id: "sample-1", studyId: null });
  });

  it("counts unread tickets for users and admins and maps failures", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getUnreadTickets();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.ticket.findMany.mockResolvedValueOnce([
      {
        id: "ticket-1",
        lastUserMessageAt: null,
        lastAdminMessageAt: new Date("2026-03-20T10:00:00.000Z"),
        userReadAt: null,
        adminReadAt: null,
      },
      {
        id: "ticket-2",
        lastUserMessageAt: null,
        lastAdminMessageAt: new Date("2026-03-20T09:00:00.000Z"),
        userReadAt: new Date("2026-03-20T11:00:00.000Z"),
        adminReadAt: null,
      },
    ]);
    const userResult = await getUnreadTickets();
    expect(userResult.status).toBe(200);
    expect(await userResult.json()).toEqual({ count: 1 });
    expect(mocks.db.ticket.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: { not: "CLOSED" } },
      select: {
        id: true,
        lastUserMessageAt: true,
        lastAdminMessageAt: true,
        userReadAt: true,
        adminReadAt: true,
      },
    });

    mocks.getServerSession.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.ticket.findMany.mockResolvedValueOnce([
      {
        id: "ticket-1",
        lastUserMessageAt: new Date("2026-03-20T10:00:00.000Z"),
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: null,
      },
      {
        id: "ticket-2",
        lastUserMessageAt: new Date("2026-03-20T09:00:00.000Z"),
        lastAdminMessageAt: null,
        userReadAt: null,
        adminReadAt: new Date("2026-03-20T11:00:00.000Z"),
      },
    ]);
    const adminResult = await getUnreadTickets();
    expect(adminResult.status).toBe(200);
    expect(await adminResult.json()).toEqual({ count: 1 });

    mocks.db.ticket.findMany.mockRejectedValueOnce(new Error("db down"));
    const failed = await getUnreadTickets();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to get count" });
  });

  it("serves ticket reference options for unsupported, admin, and department-sharing users", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getReferenceOptions();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.ticketReferencesSupported.mockResolvedValueOnce(false);
    const unsupported = await getReferenceOptions();
    expect(unsupported.status).toBe(200);
    expect(await unsupported.json()).toEqual({
      enabled: false,
      orders: [],
      studies: [],
    });

    const userResult = await getReferenceOptions();
    expect(userResult.status).toBe(200);
    expect(mocks.db.order.findMany).toHaveBeenCalledWith({
      where: { user: { departmentId: "dep-1" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        name: true,
      },
    });
    expect(mocks.db.study.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
      },
    });
    expect(await userResult.json()).toEqual({
      enabled: true,
      orders: [{ id: "order-1", orderNumber: 42, name: "Order One" }],
      studies: [{ id: "study-1", title: "Study One" }],
    });

    mocks.getServerSession.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    const adminResult = await getReferenceOptions();
    expect(adminResult.status).toBe(200);
    expect(mocks.db.order.findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        name: true,
      },
    });
  });

  it("lists samples with user/admin filters and maps failures", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getSamples(
      new Request("http://localhost/api/samples") as never
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const userResult = await getSamples(
      new Request("http://localhost/api/samples?unassigned=true&orderId=order-1") as never
    );
    expect(userResult.status).toBe(200);
    expect(mocks.db.sample.findMany).toHaveBeenCalledWith({
      where: {
        order: { userId: "user-1" },
        orderId: "order-1",
        studyId: null,
      },
      select: {
        id: true,
        sampleId: true,
        sampleTitle: true,
        studyId: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            name: true,
            status: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        study: {
          select: {
            id: true,
            title: true,
          },
        },
        reads: {
          select: {
            id: true,
            file1: true,
            file2: true,
          },
        },
      },
      orderBy: [{ order: { orderNumber: "desc" } }, { sampleId: "asc" }],
    });
    expect(await userResult.json()).toEqual([
      {
        id: "sample-1",
        sampleId: "S1",
        sampleTitle: "Sample One",
        studyId: null,
      },
    ]);

    mocks.getServerSession.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    await getSamples(new Request("http://localhost/api/samples") as never);
    expect(mocks.db.sample.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {},
      })
    );

    mocks.db.sample.findMany.mockRejectedValueOnce(new Error("db down"));
    const failed = await getSamples(new Request("http://localhost/api/samples") as never);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to fetch samples" });
  });

  it("unassigns sample studies with auth, ownership, and error handling", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await unassignSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.sample.findUnique.mockResolvedValueOnce(null);
    const missing = await unassignSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Sample not found" });

    mocks.db.sample.findUnique.mockResolvedValueOnce({
      id: "sample-1",
      order: { userId: "other-user" },
    });
    const forbidden = await unassignSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    const success = await unassignSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(success.status).toBe(200);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: { studyId: null },
    });
    expect(await success.json()).toEqual({ success: true });

    mocks.db.sample.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await unassignSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to unassign sample" });
  });
});
