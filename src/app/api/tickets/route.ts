import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

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

// GET /api/tickets - List tickets
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = session.user.role === "FACILITY_ADMIN";

  try {
    const tickets = await db.ticket.findMany({
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
    });

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

    if (!subject || !message) {
      return NextResponse.json(
        { error: "Subject and message are required" },
        { status: 400 }
      );
    }

    if (orderId && studyId) {
      return NextResponse.json(
        { error: "Please select either an order or a study" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.role === "FACILITY_ADMIN";

    if (orderId) {
      const canAccess = await canAccessOrder(orderId, session.user.id, isAdmin);
      if (!canAccess) {
        return NextResponse.json(
          { error: "Selected order could not be found" },
          { status: 404 }
        );
      }
    }

    if (studyId) {
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
          orderId: orderId || null,
          studyId: studyId || null,
          lastUserMessageAt: new Date(),
        },
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
