import { db } from "@/lib/db";
import { getEffectiveConfig } from "@/lib/config";
import {
  getCapabilityGrant,
  principalFromSession,
  type Capability,
} from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import {
  getNotificationRelayCredentials,
  getNotificationSettings,
  isEventEnabled,
} from "./settings";
import { canNotifyRecipient, getRecipientName, isRealNotificationEmail } from "./recipients";
import { sendViaSeqDeskRelay } from "./relay";
import type {
  NotificationContext,
  NotificationDispatchInput,
  NotificationRecipient,
} from "./types";

type Actor = {
  id: string;
  role?: string | null;
  systemRole?: string | null;
  facilityWorkflowRole?: string | null;
  email?: string | null;
  name?: string | null;
};

type OrderForNotification = {
  id: string;
  orderNumber: string;
  name: string | null;
  status: string;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    isDemo?: boolean | null;
    notificationPreferences?: string | null;
  };
};

type TicketForNotification = {
  id: string;
  subject: string;
  userId: string;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    isDemo?: boolean | null;
    notificationPreferences?: string | null;
  };
};

export async function dispatchNotification(
  input: NotificationDispatchInput,
  options?: { throwOnError?: boolean }
): Promise<boolean> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.enabled || !settings.hasRelayToken || !isEventEnabled(settings, input.event)) {
      return false;
    }
    if (!canNotifyRecipient(input.recipient, input.event, settings.userDefaults)) {
      return false;
    }

    const [credentials, installation] = await Promise.all([
      getNotificationRelayCredentials(),
      getInstallationContext(),
    ]);
    if (!credentials.relayToken) return false;

    await sendViaSeqDeskRelay({
      ...input,
      recipient: {
        ...input.recipient,
        email: input.recipient.email.trim(),
      },
      relayUrl: credentials.relayUrl,
      relayToken: credentials.relayToken,
      installation,
      replyTo: input.replyTo && isRealNotificationEmail(input.replyTo) ? input.replyTo : undefined,
    });
    return true;
  } catch (error) {
    console.warn("[notifications] Failed to send notification", {
      event: input.event,
      recipient: input.recipient.email,
      error,
    });
    if (options?.throwOnError) throw error;
    return false;
  }
}

export async function notifyOrderSubmitted(orderId: string, actor: Actor): Promise<void> {
  await bestEffort("order submitted", async () => {
    const profile = getServerDeploymentProfile();
    if (profile.id !== "sequencing-center") return;
    const order = await loadOrderForNotification(orderId);
    if (!order) return;
    const context = orderContext(order, {
      snippet: "The sequencing order was submitted and is ready for facility review.",
    });

    const ownerDelivery = order.user.isActive
      ? dispatchNotification({
          event: "order.submitted",
          recipient: userRecipient(order.user),
          context,
          replyTo: await getFacilityReplyTo(),
        })
      : Promise.resolve(false);

    await Promise.all([
      ownerDelivery,
      notifyOperationalRecipients({
        event: "order.submitted",
        actor,
        capability: "orders.process",
        context: {
          ...context,
          actorName: actorName(actor),
          snippet: "A researcher submitted a new sequencing order.",
        },
        replyTo: order.user.email,
      }),
    ]);
  });
}

export async function notifyOrderStatusChanged(
  orderId: string,
  statusFrom: string,
  statusTo: string,
  actor: Actor
): Promise<void> {
  await bestEffort("order status change", async () => {
    const profile = getServerDeploymentProfile();
    if (profile.id !== "sequencing-center") return;
    if (!actorHasCapability(actor, "orders.process", profile)) return;
    const order = await loadOrderForNotification(orderId);
    if (!order || !order.user.isActive) return;

    await dispatchNotification({
      event: "order.status_changed",
      recipient: userRecipient(order.user),
      context: orderContext(order, {
        statusFrom,
        statusTo,
        actorName: actorName(actor),
        snippet: "The facility updated your sequencing order status.",
      }),
      replyTo: await getFacilityReplyTo(),
    });
  });
}

export async function notifySamplesMarkedSent(orderId: string, actor: Actor): Promise<void> {
  await bestEffort("samples marked sent", async () => {
    const profile = getServerDeploymentProfile();
    if (profile.id !== "sequencing-center") return;
    if (actorHasCapability(actor, "orders.process", profile)) return;
    const order = await loadOrderForNotification(orderId);
    if (!order) return;

    await notifyOperationalRecipients({
      event: "order.samples_sent",
      actor,
      capability: "orders.process",
      context: orderContext(order, {
        actorName: actorName(actor),
        snippet: "Samples were marked as sent to the facility.",
      }),
      replyTo: order.user.email,
    });
  });
}

export async function notifyTicketCreated(ticketId: string, actor: Actor): Promise<void> {
  await bestEffort("ticket created", async () => {
    const profile = getServerDeploymentProfile();
    if (profile.id !== "sequencing-center") return;
    if (actorHasCapability(actor, "support.tickets.manage", profile)) return;
    const ticket = await loadTicketForNotification(ticketId);
    if (!ticket) return;

    await notifyOperationalRecipients({
      event: "ticket.created",
      actor,
      capability: "support.tickets.manage",
      context: ticketContext(ticket, {
        actorName: actorName(actor),
        snippet: "A new support request was opened.",
      }),
      replyTo: ticket.user.email,
    });
  });
}

export async function notifyTicketReply(ticketId: string, actor: Actor): Promise<void> {
  await bestEffort("ticket reply", async () => {
    const profile = getServerDeploymentProfile();
    if (profile.id !== "sequencing-center") return;
    const ticket = await loadTicketForNotification(ticketId);
    if (!ticket) return;

    if (actorHasCapability(actor, "support.tickets.manage", profile)) {
      if (!ticket.user.isActive) return;
      await dispatchNotification({
        event: "ticket.reply",
        recipient: userRecipient(ticket.user),
        context: ticketContext(ticket, {
          actorName: actorName(actor),
          snippet: "The facility replied to your support request.",
        }),
        replyTo: await getFacilityReplyTo(),
      });
      return;
    }

    await notifyOperationalRecipients({
      event: "ticket.reply",
      actor,
      capability: "support.tickets.manage",
      context: ticketContext(ticket, {
        actorName: actorName(actor),
        snippet: "A researcher replied to a support request.",
      }),
      replyTo: ticket.user.email,
    });
  });
}

export async function sendTestNotification(recipient: NotificationRecipient): Promise<boolean> {
  return dispatchNotification(
    {
      event: "ticket.reply",
      recipient,
      context: {
        ticketSubject: "SeqDesk notification test",
        actorName: "SeqDesk",
        snippet: "This confirms that hosted email notifications are configured.",
        linkPath: "/settings",
      },
      replyTo: await getFacilityReplyTo(),
    },
    { throwOnError: true }
  );
}

async function notifyOperationalRecipients(input: {
  event: NotificationDispatchInput["event"];
  actor: Actor;
  capability: Capability;
  context: NotificationContext;
  replyTo?: string | null;
}): Promise<void> {
  const profile = getServerDeploymentProfile();
  const candidates = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      email: true,
      role: true,
      systemRole: true,
      facilityWorkflowRole: true,
      firstName: true,
      lastName: true,
      isDemo: true,
      notificationPreferences: true,
    },
  });

  await Promise.all(
    candidates
      .filter((candidate) => candidate.id !== input.actor.id)
      .filter((candidate) =>
        actorHasCapability(candidate, input.capability, profile)
      )
      .map((candidate) =>
        dispatchNotification({
          event: input.event,
          recipient: {
            email: candidate.email,
            name: getRecipientName(candidate),
            role: "admin",
            isDemo: candidate.isDemo,
            preferences: candidate.notificationPreferences,
          },
          context: input.context,
          replyTo: input.replyTo,
        })
      )
  );
}

function actorHasCapability(
  actor: Actor,
  capability: Capability,
  profile = getServerDeploymentProfile()
): boolean {
  const principal = principalFromSession({ user: actor });
  return Boolean(principal && getCapabilityGrant(profile, principal, capability));
}

async function loadOrderForNotification(orderId: string): Promise<OrderForNotification | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      name: true,
      status: true,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          isDemo: true,
          notificationPreferences: true,
        },
      },
    },
  });
  return order?.user ? order : null;
}

async function loadTicketForNotification(ticketId: string): Promise<TicketForNotification | null> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      subject: true,
      userId: true,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          isDemo: true,
          notificationPreferences: true,
        },
      },
    },
  });
  return ticket?.user ? ticket : null;
}

function userRecipient(user: OrderForNotification["user"] | TicketForNotification["user"]): NotificationRecipient {
  return {
    email: user.email,
    name: getRecipientName(user),
    role: "user",
    isDemo: user.isDemo,
    preferences: user.notificationPreferences,
  };
}

function orderContext(
  order: OrderForNotification,
  extra: Partial<NotificationContext>
): NotificationContext {
  return {
    orderNumber: order.orderNumber,
    orderName: order.name,
    linkPath: `/orders/${order.id}`,
    ...extra,
  };
}

function ticketContext(
  ticket: TicketForNotification,
  extra: Partial<NotificationContext>
): NotificationContext {
  return {
    ticketSubject: ticket.subject,
    linkPath: `/messages/${ticket.id}`,
    ...extra,
  };
}

async function getInstallationContext(): Promise<{
  siteName?: string;
  baseUrl?: string;
  profileId?: string;
}> {
  const [resolved, settings] = await Promise.all([
    getEffectiveConfig(),
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    }),
  ]);
  const extra = parseJson(settings?.extraSettings);
  const installProfile = parseRecord(extra.installProfile);
  const baseUrl = process.env.NEXTAUTH_URL || resolved.config.runtime?.nextAuthUrl;

  return {
    siteName: resolved.config.site?.name,
    baseUrl,
    profileId: readString(installProfile.id),
  };
}

async function getFacilityReplyTo(): Promise<string | undefined> {
  const resolved = await getEffectiveConfig();
  const email = resolved.config.site?.contactEmail;
  return isRealNotificationEmail(email) ? email : undefined;
}

function actorName(actor: Actor): string | undefined {
  return actor.name || actor.email || undefined;
}

function parseJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parseRecord(parsed);
  } catch {
    return {};
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function bestEffort(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(`[notifications] Failed to prepare ${label} notification`, error);
  }
}
