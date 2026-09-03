import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  const decision = decideCapability(
    session,
    "system.users.manage",
    getServerDeploymentProfile()
  );
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: decision.status }
    );
  }

  const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");

  if (role && role !== "RESEARCHER" && role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Invalid account role" }, { status: 400 });
  }

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
