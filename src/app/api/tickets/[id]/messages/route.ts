import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST /api/tickets/[id]/messages - Add a message to a ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.role === "FACILITY_ADMIN";

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
    if (!isAdmin && ticket.userId !== session.user.id) {
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
          userId: session.user.id,
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
          ...(isAdmin
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

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("Failed to add message:", error);
    return NextResponse.json(
      { error: "Failed to add message" },
      { status: 500 }
    );
  }
}
