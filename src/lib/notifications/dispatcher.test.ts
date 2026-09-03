import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    ticket: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    siteSettings: { findUnique: vi.fn() },
  },
  getEffectiveConfig: vi.fn(),
  getNotificationSettings: vi.fn(),
  getNotificationRelayCredentials: vi.fn(),
  isEventEnabled: vi.fn(),
  canNotifyRecipient: vi.fn(),
  getRecipientName: vi.fn(),
  isRealNotificationEmail: vi.fn(),
  sendViaSeqDeskRelay: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/config", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig,
}));
vi.mock("./settings", () => ({
  getNotificationSettings: mocks.getNotificationSettings,
  getNotificationRelayCredentials: mocks.getNotificationRelayCredentials,
  isEventEnabled: mocks.isEventEnabled,
}));
vi.mock("./recipients", () => ({
  canNotifyRecipient: mocks.canNotifyRecipient,
  getRecipientName: mocks.getRecipientName,
  isRealNotificationEmail: mocks.isRealNotificationEmail,
}));
vi.mock("./relay", () => ({
  sendViaSeqDeskRelay: mocks.sendViaSeqDeskRelay,
}));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  dispatchNotification,
  notifyOrderStatusChanged,
  notifyOrderSubmitted,
  notifySamplesMarkedSent,
  notifyTicketCreated,
  notifyTicketReply,
  sendTestNotification,
} from "./dispatcher";

const enabledSettings = {
  enabled: true,
  hasRelayToken: true,
  userDefaults: { orders: true, support: true },
  events: {
    order: { submitted: true, statusChanged: true, samplesSent: true },
    ticket: { created: true, reply: true },
  },
};

const credentials = {
  relayUrl: "https://relay.example/api",
  relayToken: "tok",
  profileId: "ci-runner",
};

const recipient = {
  email: "researcher@example.org",
  role: "user" as const,
  isDemo: false,
  preferences: null,
};

const baseInput = {
  event: "order.submitted" as const,
  recipient,
  context: { orderNumber: "ORD-1", linkPath: "/orders/abc" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getNotificationSettings.mockResolvedValue(enabledSettings);
  mocks.getNotificationRelayCredentials.mockResolvedValue(credentials);
  mocks.isEventEnabled.mockReturnValue(true);
  mocks.canNotifyRecipient.mockReturnValue(true);
  mocks.isRealNotificationEmail.mockReturnValue(true);
  mocks.getRecipientName.mockReturnValue("Researcher");
  mocks.getServerDeploymentProfile.mockReturnValue(
    getDeploymentProfileDefinition("sequencing-center")
  );
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.getEffectiveConfig.mockResolvedValue({
    config: {
      site: { name: "SeqDesk", contactEmail: "facility@example.org" },
      runtime: { nextAuthUrl: "https://lab.example.org" },
    },
  });
  mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });
  mocks.sendViaSeqDeskRelay.mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete process.env.NEXTAUTH_URL;
});

describe("dispatchNotification", () => {
  it("returns false when notifications are disabled", async () => {
    mocks.getNotificationSettings.mockResolvedValue({
      ...enabledSettings,
      enabled: false,
    });

    expect(await dispatchNotification(baseInput)).toBe(false);
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
  });

  it("returns false when relay token is missing on settings", async () => {
    mocks.getNotificationSettings.mockResolvedValue({
      ...enabledSettings,
      hasRelayToken: false,
    });

    expect(await dispatchNotification(baseInput)).toBe(false);
  });

  it("returns false when the event is disabled", async () => {
    mocks.isEventEnabled.mockReturnValue(false);

    expect(await dispatchNotification(baseInput)).toBe(false);
  });

  it("returns false when the recipient cannot be notified", async () => {
    mocks.canNotifyRecipient.mockReturnValue(false);

    expect(await dispatchNotification(baseInput)).toBe(false);
  });

  it("returns false when credentials lack a relay token", async () => {
    mocks.getNotificationRelayCredentials.mockResolvedValue({
      ...credentials,
      relayToken: "",
    });

    expect(await dispatchNotification(baseInput)).toBe(false);
  });

  it("sends via the relay when all preconditions are met", async () => {
    expect(await dispatchNotification(baseInput)).toBe(true);
    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    const call = mocks.sendViaSeqDeskRelay.mock.calls[0][0];
    expect(call.relayUrl).toBe(credentials.relayUrl);
    expect(call.relayToken).toBe(credentials.relayToken);
    expect(call.installation.profileId).toBeUndefined();
    expect(call.installation.siteName).toBe("SeqDesk");
  });

  it("trims the recipient email before sending", async () => {
    await dispatchNotification({
      ...baseInput,
      recipient: { ...recipient, email: "  trim@example.org  " },
    });
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].recipient.email).toBe(
      "trim@example.org",
    );
  });

  it("forwards a real replyTo address but drops fake ones", async () => {
    mocks.isRealNotificationEmail.mockImplementation(
      (e) => typeof e === "string" && !e.endsWith("@seqdesk.local"),
    );

    await dispatchNotification({ ...baseInput, replyTo: "real@example.org" });
    expect(mocks.sendViaSeqDeskRelay.mock.calls.at(-1)![0].replyTo).toBe(
      "real@example.org",
    );

    mocks.sendViaSeqDeskRelay.mockClear();
    await dispatchNotification({ ...baseInput, replyTo: "fake@seqdesk.local" });
    expect(mocks.sendViaSeqDeskRelay.mock.calls.at(-1)![0].replyTo).toBeUndefined();
  });

  it("returns false and warns when sendViaSeqDeskRelay throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sendViaSeqDeskRelay.mockRejectedValue(new Error("relay down"));

    expect(await dispatchNotification(baseInput)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rethrows when throwOnError is set", async () => {
    mocks.sendViaSeqDeskRelay.mockRejectedValue(new Error("relay down"));
    await expect(
      dispatchNotification(baseInput, { throwOnError: true }),
    ).rejects.toThrow(/relay down/);
  });

  it("uses NEXTAUTH_URL for the installation baseUrl when present", async () => {
    process.env.NEXTAUTH_URL = "https://override.example";
    await dispatchNotification(baseInput);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].installation.baseUrl).toBe(
      "https://override.example",
    );
  });

  it("reads installProfile.id from extraSettings JSON", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ installProfile: { id: "prof-1" } }),
    });

    await dispatchNotification(baseInput);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].installation.profileId).toBe(
      "prof-1",
    );
  });

  it("ignores invalid extraSettings JSON gracefully", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: "{garbled" });

    await dispatchNotification(baseInput);
    expect(
      mocks.sendViaSeqDeskRelay.mock.calls[0][0].installation.profileId,
    ).toBeUndefined();
  });
});

describe("notifyOrderSubmitted", () => {
  it("does nothing when the order does not exist", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    await notifyOrderSubmitted("missing", {
      id: "actor-1",
      role: "RESEARCHER",
      email: "actor@example.org",
    });

    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("dispatches to the order user and facility operators (excluding the actor)", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      name: "Sample order",
      status: "SUBMITTED",
      user: {
        email: "researcher@example.org",
        firstName: "R",
        lastName: "K",
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "actor-1",
        email: "self@example.org",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        firstName: "Self",
        lastName: null,
        isDemo: false,
        notificationPreferences: null,
      },
      {
        id: "operator-1",
        email: "operator@example.org",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "OPERATOR",
        firstName: "O",
        lastName: null,
        isDemo: false,
        notificationPreferences: null,
      },
      {
        id: "settings-admin-1",
        email: "settings-admin@example.org",
        role: "FACILITY_ADMIN",
        systemRole: "ADMIN",
        facilityWorkflowRole: "REQUESTER",
        firstName: "Settings",
        lastName: "Admin",
        isDemo: false,
        notificationPreferences: null,
      },
    ]);

    await notifyOrderSubmitted("order-1", {
      id: "actor-1",
      role: "RESEARCHER",
      email: "actor@example.org",
      name: "Actor",
    });

    // 1 dispatch for the order user + 1 for each operator (minus self) = 2
    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(2);
    const recipients = mocks.sendViaSeqDeskRelay.mock.calls.map(
      ([call]) =>
        (call as { recipient: { email: string } }).recipient.email,
    );
    expect(recipients).toContain("researcher@example.org");
    expect(recipients).toContain("operator@example.org");
    expect(recipients).not.toContain("settings-admin@example.org");
    expect(recipients).not.toContain("self@example.org");
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
  });

  it("swallows errors from loadOrderForNotification (best-effort)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.db.order.findUnique.mockRejectedValue(new Error("DB down"));

    await expect(
      notifyOrderSubmitted("order-1", { id: "actor-1" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("suppresses requester/facility handoff mail outside Sequencing Center", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );

    await notifyOrderSubmitted("order-1", {
      id: "member-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
    });

    expect(mocks.db.order.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
  });
});

describe("notifyOrderStatusChanged", () => {
  it("does not fire for requester actors", async () => {
    await notifyOrderStatusChanged("order-1", "PENDING", "IN_PROGRESS", {
      id: "u-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "REQUESTER",
    });
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
    expect(mocks.db.order.findUnique).not.toHaveBeenCalled();
  });

  it("does not treat an installation administrator as a facility operator", async () => {
    await notifyOrderStatusChanged("order-1", "PENDING", "IN_PROGRESS", {
      id: "settings-admin-1",
      role: "FACILITY_ADMIN",
      systemRole: "ADMIN",
      facilityWorkflowRole: "REQUESTER",
    });

    expect(mocks.db.order.findUnique).not.toHaveBeenCalled();
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
  });

  it("dispatches to the order user when a facility operator changes status", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      name: "X",
      status: "IN_PROGRESS",
      user: {
        email: "u@example.org",
        firstName: "U",
        lastName: null,
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });

    await notifyOrderStatusChanged("order-1", "PENDING", "IN_PROGRESS", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
      email: "operator@example.org",
    });

    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    const sent = mocks.sendViaSeqDeskRelay.mock.calls[0][0];
    expect(sent.recipient.email).toBe("u@example.org");
    expect(sent.event).toBe("order.status_changed");
    expect(sent.context.statusFrom).toBe("PENDING");
    expect(sent.context.statusTo).toBe("IN_PROGRESS");
  });

  it("does not deliver order-owner mail to a deactivated account", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      name: "X",
      status: "IN_PROGRESS",
      user: {
        email: "inactive@example.org",
        firstName: "Former",
        lastName: "Member",
        isActive: false,
        isDemo: false,
        notificationPreferences: null,
      },
    });

    await notifyOrderStatusChanged("order-1", "PENDING", "IN_PROGRESS", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });

    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
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
});

describe("notifySamplesMarkedSent", () => {
  it("does not fire when the actor is a facility operator", async () => {
    await notifySamplesMarkedSent("order-1", {
      id: "admin-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
  });

  it("notifies facility operators when a researcher marks samples sent", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      name: null,
      status: "SUBMITTED",
      user: {
        email: "u@example.org",
        firstName: null,
        lastName: null,
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "operator-1",
        email: "operator@example.org",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "OPERATOR",
        firstName: "O",
        lastName: null,
        isDemo: false,
        notificationPreferences: null,
      },
    ]);

    await notifySamplesMarkedSent("order-1", {
      id: "u-1",
      role: "RESEARCHER",
      email: "u@example.org",
    });

    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].event).toBe(
      "order.samples_sent",
    );
  });
});

describe("notifyTicketCreated", () => {
  it("does not fire when the actor is a facility operator", async () => {
    await notifyTicketCreated("t-1", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });
    expect(mocks.db.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("notifies facility operators on ticket creation", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "t-1",
      subject: "Help",
      userId: "u-1",
      user: {
        email: "u@example.org",
        firstName: null,
        lastName: null,
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "operator-1",
        email: "operator@example.org",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "OPERATOR",
        firstName: null,
        lastName: null,
        isDemo: false,
        notificationPreferences: null,
      },
    ]);

    await notifyTicketCreated("t-1", { id: "u-1", role: "RESEARCHER" });

    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].event).toBe("ticket.created");
  });
});

describe("notifyTicketReply", () => {
  it("dispatches to the ticket user when a facility operator replies", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "t-1",
      subject: "Help",
      userId: "u-1",
      user: {
        email: "u@example.org",
        firstName: null,
        lastName: null,
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });

    await notifyTicketReply("t-1", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });

    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].recipient.email).toBe(
      "u@example.org",
    );
  });

  it("does not deliver ticket-owner mail to a deactivated account", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "t-1",
      subject: "Help",
      userId: "u-1",
      user: {
        email: "inactive@example.org",
        firstName: "Former",
        lastName: "Member",
        isActive: false,
        isDemo: false,
        notificationPreferences: null,
      },
    });

    await notifyTicketReply("t-1", {
      id: "operator-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
    });

    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
    expect(mocks.db.ticket.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          user: {
            select: expect.objectContaining({ isActive: true }),
          },
        }),
      }),
    );
  });

  it("notifies facility operators when a researcher replies", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "t-1",
      subject: "Help",
      userId: "u-1",
      user: {
        email: "u@example.org",
        firstName: null,
        lastName: null,
        isActive: true,
        isDemo: false,
        notificationPreferences: null,
      },
    });
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "operator-1",
        email: "operator@example.org",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "OPERATOR",
        firstName: null,
        lastName: null,
        isDemo: false,
        notificationPreferences: null,
      },
    ]);

    await notifyTicketReply("t-1", { id: "u-1", role: "RESEARCHER" });

    expect(mocks.sendViaSeqDeskRelay).toHaveBeenCalledTimes(1);
    expect(mocks.sendViaSeqDeskRelay.mock.calls[0][0].recipient.role).toBe("admin");
  });

  it("does nothing when the ticket does not exist", async () => {
    mocks.db.ticket.findUnique.mockResolvedValue(null);

    await notifyTicketReply("missing", { id: "u-1", role: "RESEARCHER" });
    expect(mocks.sendViaSeqDeskRelay).not.toHaveBeenCalled();
  });
});

describe("sendTestNotification", () => {
  it("dispatches a ticket.reply event with throwOnError=true", async () => {
    const result = await sendTestNotification({
      email: "test@example.org",
      role: "user",
    });

    expect(result).toBe(true);
    const call = mocks.sendViaSeqDeskRelay.mock.calls.at(-1)![0];
    expect(call.event).toBe("ticket.reply");
    expect(call.context.ticketSubject).toBe("SeqDesk notification test");
  });

  it("rethrows transport failures", async () => {
    mocks.sendViaSeqDeskRelay.mockRejectedValue(new Error("network"));
    await expect(
      sendTestNotification({ email: "test@example.org", role: "user" }),
    ).rejects.toThrow(/network/);
  });
});
