import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

// DELETE /api/admin/invites/[id] - Revoke an invite
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  try {
    const actor = await db.user.findUnique({
      where: { id: decision.principal!.id },
      select: { systemRole: true, isActive: true },
    });
    if (!actor?.isActive || actor.systemRole !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const invite = await db.adminInvite.findUnique({
      where: { id },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // Used invitations are immutable audit history.
    if (invite.usedAt) {
      return NextResponse.json(
        { error: "Cannot revoke a used invite" },
        { status: 400 }
      );
    }

    if (invite.revokedAt) {
      return NextResponse.json(
        { error: "Invite has already been revoked" },
        { status: 409 }
      );
    }

    const revokedAt = new Date();
    const result = await db.adminInvite.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: {
        revokedAt,
        revokedById: decision.principal!.id,
      },
    });
    if (result.count !== 1) {
      return NextResponse.json(
        { error: "Invite was used or revoked concurrently" },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, revokedAt });
  } catch (error) {
    console.error("Failed to delete invite:", error);
    return NextResponse.json(
      { error: "Failed to delete invite" },
      { status: 500 }
    );
  }
}
