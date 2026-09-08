import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInviteGrant } from "@/lib/accounts/invite-role";
import { inviteCodeLookup } from "@/lib/accounts/invite-secret.server";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { z } from "zod";

const verifyInviteSchema = z
  .object({ code: z.string().trim().min(1).max(128) })
  .strict();

const INVALID_INVITE_RESPONSE = {
  valid: false,
  error: "This invitation is invalid or no longer active",
} as const;

// POST /api/admin/invites/verify - Verify an invite code
export async function POST(request: NextRequest) {
  try {
    const parsed = verifyInviteSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        INVALID_INVITE_RESPONSE,
        { status: 400 }
      );
    }

    const lookup = inviteCodeLookup(parsed.data.code);
    const invite = await db.adminInvite.findFirst({
      where: lookup.where,
      include: {
        createdBy: {
          select: { systemRole: true, isActive: true },
        },
      },
    });

    if (!invite) {
      return NextResponse.json(INVALID_INVITE_RESPONSE, { status: 400 });
    }

    if (
      invite.usedAt ||
      invite.revokedAt ||
      new Date() > invite.expiresAt ||
      invite.createdBy.isActive !== true ||
      invite.createdBy.systemRole !== "ADMIN"
    ) {
      return NextResponse.json(INVALID_INVITE_RESPONSE, { status: 400 });
    }

    const storedGrant = getInviteGrant(invite);
    const profile = getServerDeploymentProfile();
    const grant = {
      ...storedGrant,
      facilityWorkflowRole:
        profile.id === "sequencing-center"
          ? storedGrant.facilityWorkflowRole
          : ("REQUESTER" as const),
    };

    return NextResponse.json({
      valid: true,
      grant,
    });
  } catch (error) {
    console.error("Failed to verify invite:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to verify invite" },
      { status: 500 }
    );
  }
}
