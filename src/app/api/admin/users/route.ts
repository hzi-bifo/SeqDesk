import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");

  // Filter by role if specified, otherwise default to RESEARCHER
  const whereClause: Record<string, unknown> = role
    ? { role: role }
    : { role: "RESEARCHER" };

  // Scope a facility-demo session to its own workspace's two users only.
  if (demoWsUserIds) {
    whereClause.id = { in: demoWsUserIds };
  }

  const users = await db.user.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: {
      department: true,
      _count: {
        select: {
          orders: true,
          studies: true,
        },
      },
    },
  });

  return NextResponse.json(users);
}
