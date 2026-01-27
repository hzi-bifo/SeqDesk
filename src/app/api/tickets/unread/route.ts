import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/tickets/unread - Get count of unread tickets
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = session.user.role === "FACILITY_ADMIN";

  try {
    const tickets = await db.ticket.findMany({
      where: isAdmin
        ? { status: { not: "CLOSED" } }
        : { userId: session.user.id, status: { not: "CLOSED" } },
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
      if (isAdmin) {
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
