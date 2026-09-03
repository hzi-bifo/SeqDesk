import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET /api/tickets/unread - Get count of unread tickets
export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "support.tickets.use");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  if (access.principal?.isDemo) {
    return NextResponse.json({ count: 0 });
  }

  const userId = access.principal!.id;
  const canManageTickets = decideServerCapability(
    session,
    "support.tickets.manage"
  ).allowed;
  const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

  try {
    const tickets = await db.ticket.findMany({
      where: canManageTickets
        ? (demoWsUserIds ? { userId: { in: demoWsUserIds }, status: { not: "CLOSED" } } : { status: { not: "CLOSED" } })
        : { userId, status: { not: "CLOSED" } },
      select: {
        id: true,
        lastUserMessageAt: true,
        lastAdminMessageAt: true,
        userReadAt: true,
        adminReadAt: true,
      },
    });

    let unreadCount = 0;

    for (const ticket of tickets) {
      if (canManageTickets) {
        // Admin: unread if user sent a message after admin last read
        if (ticket.lastUserMessageAt) {
          if (!ticket.adminReadAt || ticket.lastUserMessageAt > ticket.adminReadAt) {
            unreadCount++;
          }
        }
      } else {
        // User: unread if admin sent a message after user last read
        if (ticket.lastAdminMessageAt) {
          if (!ticket.userReadAt || ticket.lastAdminMessageAt > ticket.userReadAt) {
            unreadCount++;
          }
        }
      }
    }

    return NextResponse.json({ count: unreadCount });
  } catch (error) {
    console.error("Failed to get unread count:", error);
    return NextResponse.json({ error: "Failed to get count" }, { status: 500 });
  }
}
