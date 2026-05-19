import { db } from "@/lib/db";

export type InAppNotificationSeverity = "info" | "success" | "warning" | "error";

export interface InAppNotificationDTO {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  sourceType: string;
  sourceId: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InAppNotificationList {
  notifications: InAppNotificationDTO[];
  unreadCount: number;
}

interface Actor {
  id?: string | null;
  role?: string | null;
  email?: string | null;
  name?: string | null;
}

interface Recipient {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface NotificationContent {
  eventType: string;
  severity: InAppNotificationSeverity;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  sourceType: string;
  sourceId?: string | null;
  dedupeKey: (recipient: Recipient) => string;
}

type NotificationRow = {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  sourceType: string;
  sourceId: string | null;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const TERMINAL_PIPELINE_STATUSES = new Set(["completed", "failed", "cancelled"]);

type UpdateProgressLike = {
  status: string;
  progress?: number;
  message?: string;
  error?: string;
};

function toDto(notification: NotificationRow): InAppNotificationDTO {
  return {
    id: notification.id,
    eventType: notification.eventType,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    linkPath: notification.linkPath,
    sourceType: notification.sourceType,
    sourceId: notification.sourceId,
    readAt: notification.readAt?.toISOString() ?? null,
    archivedAt: notification.archivedAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

function clampLimit(limit?: number | null): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.floor(Number(limit))));
}

function recipientName(user: Recipient): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.email || "Unknown user";
}

function actorName(actor?: Actor | null): string {
  return actor?.name?.trim() || actor?.email?.trim() || "Someone";
}

function uniqueRecipients(recipients: Recipient[], actor?: Actor | null): Recipient[] {
  const seen = new Set<string>();
  const actorId = actor?.id ?? null;
  const result: Recipient[] = [];

  for (const recipient of recipients) {
    if (!recipient.id || recipient.id === actorId || seen.has(recipient.id)) continue;
    seen.add(recipient.id);
    result.push(recipient);
  }

  return result;
}

async function loadFacilityAdmins(): Promise<Recipient[]> {
  return db.user.findMany({
    where: { role: "FACILITY_ADMIN" },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}

async function createNotifications(
  recipients: Recipient[],
  content: NotificationContent
): Promise<number> {
  if (recipients.length === 0) return 0;

  const rows = recipients.map((recipient) => ({
    userId: recipient.id,
    eventType: content.eventType,
    severity: content.severity,
    title: content.title,
    body: content.body ?? null,
    linkPath: content.linkPath ?? null,
    sourceType: content.sourceType,
    sourceId: content.sourceId ?? null,
    dedupeKey: content.dedupeKey(recipient),
  }));

  const result = await db.inAppNotification.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

function updateEventSourceId(targetVersion?: string | null): string {
  return targetVersion?.trim() || "unknown";
}

async function bestEffort(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn(`[in-app notifications] Failed to create ${label} notification`, error);
  }
}

export async function listInAppNotifications(
  userId: string,
  options: { limit?: number | null; archived?: boolean } = {}
): Promise<InAppNotificationList> {
  const where = {
    userId,
    ...(options.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
  };
  const [notifications, unreadCount] = await Promise.all([
    db.inAppNotification.findMany({
      where,
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: clampLimit(options.limit),
    }),
    db.inAppNotification.count({
      where: {
        userId,
        archivedAt: null,
        readAt: null,
      },
    }),
  ]);

  return {
    notifications: notifications.map(toDto),
    unreadCount,
  };
}

export async function markInAppNotificationRead(
  userId: string,
  notificationId: string
): Promise<boolean> {
  const result = await db.inAppNotification.updateMany({
    where: {
      id: notificationId,
      userId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function archiveInAppNotification(
  userId: string,
  notificationId: string
): Promise<boolean> {
  const result = await db.inAppNotification.updateMany({
    where: {
      id: notificationId,
      userId,
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllInAppNotificationsRead(userId: string): Promise<number> {
  const result = await db.inAppNotification.updateMany({
    where: {
      userId,
      archivedAt: null,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function notifyOrderCreatedInApp(
  orderId: string,
  actor?: Actor | null
): Promise<void> {
  await bestEffort("order.created", async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        name: true,
        generatedByE2E: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!order || order.generatedByE2E) return;

    const recipients = uniqueRecipients(await loadFacilityAdmins(), actor);
    await createNotifications(recipients, {
      eventType: "order.created",
      severity: "info",
      title: `New order ${order.orderNumber}`,
      body: `${actorName(actor)} created ${order.name || "a new order"} for ${recipientName(order.user)}.`,
      linkPath: `/orders/${order.id}`,
      sourceType: "order",
      sourceId: order.id,
      dedupeKey: (recipient) => `order.created:${order.id}:${recipient.id}`,
    });
  });
}

export async function notifyOrderUpdatedInApp(
  orderId: string,
  actor?: Actor | null,
  summary?: string | null
): Promise<void> {
  await bestEffort("order.updated", async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        name: true,
        status: true,
        generatedByE2E: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!order || order.generatedByE2E) return;

    const admins = await loadFacilityAdmins();
    const recipients = uniqueRecipients([order.user, ...admins], actor);
    const eventId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    await createNotifications(recipients, {
      eventType: "order.updated",
      severity: "info",
      title: `Order ${order.orderNumber} updated`,
      body:
        summary ||
        `${actorName(actor)} updated ${order.name || "this order"}. Current status: ${order.status}.`,
      linkPath: `/orders/${order.id}`,
      sourceType: "order",
      sourceId: order.id,
      dedupeKey: (recipient) => `order.updated:${order.id}:${eventId}:${recipient.id}`,
    });
  });
}

export async function notifyPipelineRunTerminalInApp(
  runId: string,
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined
): Promise<void> {
  const normalizedNext = nextStatus?.toLowerCase();
  if (!normalizedNext || !TERMINAL_PIPELINE_STATUSES.has(normalizedNext)) return;
  if (previousStatus?.toLowerCase() === normalizedNext) return;

  await bestEffort(`pipeline.${normalizedNext}`, async () => {
    const run = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        runNumber: true,
        pipelineId: true,
        status: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        order: {
          select: { id: true, orderNumber: true, name: true, generatedByE2E: true },
        },
        study: {
          select: { id: true, title: true, generatedByE2E: true },
        },
      },
    });
    if (!run) return;
    if (run.order?.generatedByE2E || run.study?.generatedByE2E) return;

    const admins = await loadFacilityAdmins();
    const recipients = uniqueRecipients([run.user, ...admins]);
    const eventType = `pipeline.${normalizedNext}`;
    const targetLabel =
      run.order?.orderNumber ||
      run.study?.title ||
      run.runNumber ||
      run.pipelineId;
    const titleStatus =
      normalizedNext === "completed"
        ? "completed"
        : normalizedNext === "cancelled"
          ? "cancelled"
          : "failed";
    const severity =
      normalizedNext === "completed"
        ? "success"
        : normalizedNext === "cancelled"
          ? "warning"
          : "error";

    await createNotifications(recipients, {
      eventType,
      severity,
      title: `Pipeline ${run.pipelineId} ${titleStatus}`,
      body: `Run ${run.runNumber} for ${targetLabel} ${titleStatus}.`,
      linkPath: `/analysis/${run.id}`,
      sourceType: "pipelineRun",
      sourceId: run.id,
      dedupeKey: (recipient) => `${eventType}:${run.id}:${recipient.id}`,
    });
  });
}

export async function notifyAppUpdateStartedInApp(options: {
  targetVersion?: string | null;
  repair?: boolean;
}): Promise<void> {
  await bestEffort("app.update.started", async () => {
    const recipients = await loadFacilityAdmins();
    const eventType = options.repair ? "app.update.repair_started" : "app.update.started";
    const sourceId = updateEventSourceId(options.targetVersion);
    const eventId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    await createNotifications(recipients, {
      eventType,
      severity: "info",
      title: options.repair ? "Update repair started" : "SeqDesk update started",
      body: options.repair
        ? `Update repair for v${sourceId} started. SeqDesk will attempt an automatic restart.`
        : `SeqDesk update to v${sourceId} started. SeqDesk will attempt an automatic restart.`,
      linkPath: "/admin/settings",
      sourceType: "appUpdate",
      sourceId,
      dedupeKey: (recipient) => `${eventType}:${sourceId}:${eventId}:${recipient.id}`,
    });
  });
}

export async function notifyAppUpdateProgressInApp(
  progress: UpdateProgressLike,
  options: { targetVersion?: string | null; repair?: boolean } = {}
): Promise<void> {
  if (progress.status !== "complete" && progress.status !== "error") return;

  await bestEffort("app.update.progress", async () => {
    const recipients = await loadFacilityAdmins();
    const sourceId = updateEventSourceId(options.targetVersion);
    const failed = progress.status === "error";
    const eventType = failed ? "app.update.failed" : "app.update.completed";
    const errorKey = failed
      ? `:${(progress.error || progress.message || "unknown").slice(0, 120)}`
      : "";
    await createNotifications(recipients, {
      eventType,
      severity: failed ? "error" : "success",
      title: failed ? "SeqDesk update failed" : "SeqDesk update complete",
      body: failed
        ? progress.error || progress.message || "The update failed. Check Platform Info for details."
        : progress.message || `SeqDesk update to v${sourceId} completed.`,
      linkPath: "/admin/settings",
      sourceType: "appUpdate",
      sourceId,
      dedupeKey: (recipient) => `${eventType}:${sourceId}${errorKey}:${recipient.id}`,
    });
  });
}
