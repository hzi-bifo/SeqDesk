import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketReferencesSupported } from "@/lib/tickets/reference-support";

type LegacyTicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  lastUserMessageAt: string | null;
  lastAdminMessageAt: string | null;
  userReadAt: string | null;
  adminReadAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  messageCount: number | null;
};

async function isDepartmentSharingEnabled(): Promise<boolean> {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings?.extraSettings) return false;
    const extra = JSON.parse(settings.extraSettings);
    return extra.departmentSharing === true;
  } catch {
    return false;
  }
}

async function canAccessOrder(orderId: string, userId: string, isAdmin: boolean) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          departmentId: true,
        },
      },
    },
  });

  if (!order) {
    return false;
  }

  if (isAdmin || order.userId === userId) {
    return true;
  }

  if (!(await isDepartmentSharingEnabled())) {
    return false;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  });

  return !!user?.departmentId && user.departmentId === order.user.departmentId;
}

async function getLegacyTickets(userId: string, isAdmin: boolean) {
  const whereClause = isAdmin
    ? Prisma.sql``
    : Prisma.sql`WHERE t."userId" = ${userId}`;

  const rows = await db.$queryRaw<LegacyTicketRow[]>(Prisma.sql`
    SELECT
      t."id",
      t."subject",
      t."status",
      t."priority",
      t."lastUserMessageAt",
      t."lastAdminMessageAt",
      t."userReadAt",
      t."adminReadAt",
      t."createdAt",
      t."updatedAt",
      t."closedAt",
      t."userId",
      u."firstName",
      u."lastName",
      u."email",
      COALESCE(tm."messageCount", 0) AS "messageCount"
    FROM "Ticket" t
    INNER JOIN "User" u ON u."id" = t."userId"
    LEFT JOIN (
      SELECT "ticketId", COUNT(*) AS "messageCount"
      FROM "TicketMessage"
      GROUP BY "ticketId"
    ) tm ON tm."ticketId" = t."id"
    ${whereClause}
    ORDER BY t."updatedAt" DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    lastUserMessageAt: row.lastUserMessageAt,
    lastAdminMessageAt: row.lastAdminMessageAt,
    userReadAt: row.userReadAt,
    adminReadAt: row.adminReadAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    userId: row.userId,
    user: {
      id: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
    },
    _count: {
      messages: Number(row.messageCount || 0),
    },
    order: null,
    study: null,
  }));
}

// GET /api/tickets - List tickets
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = session.user.role === "FACILITY_ADMIN";

  try {
    const supportsReferences = await ticketReferencesSupported();
    let tickets;
    try {
      tickets = await db.ticket.findMany(
        supportsReferences
          ? {
              where: isAdmin ? {} : { userId: session.user.id },
              orderBy: { updatedAt: "desc" },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
                _count: {
                  select: { messages: true },
                },
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    name: true,
                  },
                },
                study: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            }
          : {
              where: isAdmin ? {} : { userId: session.user.id },
              orderBy: { updatedAt: "desc" },
              select: {
                id: true,
                subject: true,
                status: true,
                priority: true,
                lastUserMessageAt: true,
                lastAdminMessageAt: true,
                userReadAt: true,
                adminReadAt: true,
                createdAt: true,
                updatedAt: true,
                closedAt: true,
                userId: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
                _count: {
                  select: { messages: true },
                },
              },
            }
      );
    } catch {
      tickets = await getLegacyTickets(session.user.id, isAdmin);
    }

    // Calculate unread status for each ticket
    const ticketsWithUnread = tickets.map((ticket) => {
      let hasUnread = false;
      if (isAdmin) {
        // Admin: unread if user sent a message after admin last read
        hasUnread = ticket.lastUserMessageAt
          ? !ticket.adminReadAt || ticket.lastUserMessageAt > ticket.adminReadAt
          : false;
      } else {
        // User: unread if admin sent a message after user last read
        hasUnread = ticket.lastAdminMessageAt
          ? !ticket.userReadAt || ticket.lastAdminMessageAt > ticket.userReadAt
          : false;
      }
      return { ...ticket, hasUnread };
    });

    return NextResponse.json(ticketsWithUnread);
  } catch (error) {
    console.error("Failed to fetch tickets:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

// POST /api/tickets - Create a new ticket
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { subject, message, priority, orderId, studyId } = await request.json();
    const supportsReferences = await ticketReferencesSupported();

    if (!subject || !message) {
      return NextResponse.json(
        { error: "Subject and message are required" },
        { status: 400 }
      );
    }

    if (supportsReferences && orderId && studyId) {
      return NextResponse.json(
        { error: "Please select either an order or a study" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.role === "FACILITY_ADMIN";

    if (supportsReferences && orderId) {
      const canAccess = await canAccessOrder(orderId, session.user.id, isAdmin);
      if (!canAccess) {
        return NextResponse.json(
          { error: "Selected order could not be found" },
          { status: 404 }
        );
      }
    }

    if (supportsReferences && studyId) {
      const study = await db.study.findUnique({
        where: { id: studyId },
        select: { id: true, userId: true },
      });

      if (!study || (!isAdmin && study.userId !== session.user.id)) {
        return NextResponse.json(
          { error: "Selected study could not be found" },
          { status: 404 }
        );
      }
    }

    // Create ticket with initial message in a transaction
    const ticket = await db.$transaction(async (tx) => {
      const newTicket = await tx.ticket.create({
        data: {
          subject,
          priority: priority || "NORMAL",
          userId: session.user.id,
          ...(supportsReferences
            ? {
                orderId: orderId || null,
                studyId: studyId || null,
              }
            : {}),
          lastUserMessageAt: new Date(),
        },
        ...(supportsReferences
          ? {
              include: {
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    name: true,
                  },
                },
                study: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            }
          : {
              select: {
                id: true,
                subject: true,
                status: true,
                priority: true,
                createdAt: true,
                updatedAt: true,
                userId: true,
              },
            }),
      });

      await tx.ticketMessage.create({
        data: {
          content: message,
          userId: session.user.id,
          ticketId: newTicket.id,
        },
      });

      return newTicket;
    });

    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket:", error);
    return NextResponse.json(
      { error: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
