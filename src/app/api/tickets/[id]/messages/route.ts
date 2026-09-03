import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyTicketReply } from "@/lib/notifications/dispatcher";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// POST /api/tickets/[id]/messages - Add a message to a ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "support.tickets.use");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const { id } = await params;
  const userId = access.principal!.id;
  const canManageTickets = decideServerCapability(
    session,
    "support.tickets.manage"
  ).allowed;

  try {
    const ticket = await db.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check access
    if (!canManageTickets && ticket.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Don't allow messages on closed tickets
    if (ticket.status === "CLOSED") {
      return NextResponse.json(
        { error: "Cannot add messages to closed tickets" },
        { status: 400 }
      );
    }

    const { content } = await request.json();

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    const now = new Date();

    // Create message and update ticket timestamps in transaction
    const message = await db.$transaction(async (tx) => {
      const newMessage = await tx.ticketMessage.create({
        data: {
          content: content.trim(),
          userId,
          ticketId: id,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      });

      // Update ticket with last message timestamp and reopen if needed
      await tx.ticket.update({
        where: { id },
        data: {
          updatedAt: now,
          ...(canManageTickets
            ? {
                lastAdminMessageAt: now,
                adminReadAt: now,
                // If admin replies, move to IN_PROGRESS if it was OPEN
                status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
              }
            : {
                lastUserMessageAt: now,
                userReadAt: now,
                // If user replies to RESOLVED ticket, reopen it
                status: ticket.status === "RESOLVED" ? "OPEN" : ticket.status,
              }),
        },
        select: { id: true },
      });

      return newMessage;
    });

    await notifyTicketReply(id, {
      id: userId,
      role: session!.user.role,
      email: session!.user.email,
      name: session!.user.name,
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("Failed to add message:", error);
    return NextResponse.json(
      { error: "Failed to add message" },
      { status: 500 }
    );
  }
}
