import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketReferencesSupported } from "@/lib/tickets/reference-support";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET /api/tickets/[id] - Get single ticket with messages
export async function GET(
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
    const supportsReferences = await ticketReferencesSupported();
    const ticket = supportsReferences
      ? await db.ticket.findUnique({
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
        })
      : await db.ticket.findUnique({
          where: { id },
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
    if (!canManageTickets && ticket.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Mark as read
    const now = new Date();
    await db.ticket.update({
      where: { id },
      data: canManageTickets ? { adminReadAt: now } : { userReadAt: now },
      select: { id: true },
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

    const body = await request.json();
    const { status, priority } = body;

    // Users can only close their own tickets, admins can change any status
    const updateData: { status?: string; priority?: string; closedAt?: Date | null } = {};

    if (status) {
      if (!canManageTickets && status !== "CLOSED") {
        return NextResponse.json(
          { error: "Users can only close tickets" },
          { status: 403 }
        );
      }
      updateData.status = status;
      updateData.closedAt = status === "CLOSED" ? new Date() : null;
    }

    if (priority && canManageTickets) {
      updateData.priority = priority;
    }

    const updatedTicket = await db.ticket.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
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
