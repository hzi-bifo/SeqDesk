import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/tickets/[id] - Get single ticket with messages
export async function GET(
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
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
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
        messages: {
          orderBy: { createdAt: "asc" },
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
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check access: admins can see all, users can only see their own
    if (!isAdmin && ticket.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Mark as read
    const now = new Date();
    await db.ticket.update({
      where: { id },
      data: isAdmin ? { adminReadAt: now } : { userReadAt: now },
    });

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("Failed to fetch ticket:", error);
    return NextResponse.json(
      { error: "Failed to fetch ticket" },
      { status: 500 }
    );
  }
}

// PATCH /api/tickets/[id] - Update ticket (status, priority)
export async function PATCH(
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
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check access
    if (!isAdmin && ticket.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { status, priority } = body;

    // Users can only close their own tickets, admins can change any status
    const updateData: { status?: string; priority?: string; closedAt?: Date | null } = {};

    if (status) {
      if (!isAdmin && status !== "CLOSED") {
        return NextResponse.json(
          { error: "Users can only close tickets" },
          { status: 403 }
        );
      }
      updateData.status = status;
      updateData.closedAt = status === "CLOSED" ? new Date() : null;
    }

    if (priority && isAdmin) {
      updateData.priority = priority;
    }

    const updatedTicket = await db.ticket.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(updatedTicket);
  } catch (error) {
    console.error("Failed to update ticket:", error);
    return NextResponse.json(
      { error: "Failed to update ticket" },
      { status: 500 }
    );
  }
}
