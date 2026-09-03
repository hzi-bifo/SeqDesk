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
  const systemRole = searchParams.get("systemRole");

  if (role && role !== "RESEARCHER" && role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Invalid account role" }, { status: 400 });
  }
  if (systemRole && systemRole !== "MEMBER" && systemRole !== "ADMIN") {
    return NextResponse.json({ error: "Invalid system role" }, { status: 400 });
  }

  // `role` remains as a compatibility filter for callers that still organize
  // facility workflow assignments. Account-management screens use systemRole.
  const whereClause: Record<string, unknown> = systemRole
    ? { systemRole }
    : role
      ? { role }
      : { systemRole: "MEMBER" };

  // Scope a facility-demo session to its own workspace's two users only.
  if (demoWsUserIds) {
    whereClause.id = { in: demoWsUserIds };
  }

  const users = await db.user.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    // Keep credentials and other private scalar fields out of the response.
    // Prisma's default scalar selection would otherwise include password hashes.
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      systemRole: true,
      role: true,
      researcherRole: true,
      institution: true,
      facilityName: true,
      isActive: true,
      deactivatedAt: true,
      createdAt: true,
      updatedAt: true,
      department: {
        select: {
          id: true,
          name: true,
        },
      },
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
