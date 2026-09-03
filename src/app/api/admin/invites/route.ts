import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import {
  formatInviteCode,
  getInviteGrant,
  grantFromLegacyAccountRole,
  isFacilityWorkflowRole,
  isInviteAccountRole,
  isSystemRole,
  legacyRoleForSystemRole,
  type FacilityWorkflowRole,
  type SystemRole,
} from "@/lib/accounts/invite-role";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { z } from "zod";

const createInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320).optional().nullable(),
    expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
    systemRole: z.enum(["MEMBER", "ADMIN"]).optional(),
    facilityWorkflowRole: z.enum(["REQUESTER", "OPERATOR"]).optional(),
    // Compatibility input for clients from the coupled-role release.
    accountRole: z.enum(["RESEARCHER", "FACILITY_ADMIN"]).optional(),
  })
  .strict();

function serializeInviteGrant(invite: {
  code: string;
  targetSystemRole?: string | null;
  targetFacilityWorkflowRole?: string | null;
}) {
  const grant = getInviteGrant(invite);
  return {
    grant,
    accountRole: legacyRoleForSystemRole(grant.systemRole),
  };
}

// GET /api/admin/invites - List all invites
export async function GET() {
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

  try {
    const invites = await db.adminInvite.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
        usedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    return NextResponse.json(
      invites.map((invite) => ({
        ...invite,
        ...serializeInviteGrant(invite),
      }))
    );
  } catch (error) {
    console.error("Failed to fetch invites:", error);
    return NextResponse.json(
      { error: "Failed to fetch invites" },
      { status: 500 }
    );
  }
}

// POST /api/admin/invites - Create a new invite
export async function POST(request: NextRequest) {
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

  try {
    const parsed = createInviteSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid invitation details" },
        { status: 400 }
      );
    }

    const { email, expiresInDays, accountRole } = parsed.data;
    const normalizedEmail = email || null;
    const compatibilityGrant =
      accountRole && isInviteAccountRole(accountRole)
        ? grantFromLegacyAccountRole(accountRole)
        : null;
    const systemRole: SystemRole = isSystemRole(parsed.data.systemRole)
      ? parsed.data.systemRole
      : compatibilityGrant?.systemRole ?? "MEMBER";
    const facilityWorkflowRole: FacilityWorkflowRole = isFacilityWorkflowRole(
      parsed.data.facilityWorkflowRole
    )
      ? parsed.data.facilityWorkflowRole
      : compatibilityGrant?.facilityWorkflowRole ?? "REQUESTER";

    if (
      compatibilityGrant &&
      ((parsed.data.systemRole !== undefined &&
        parsed.data.systemRole !== compatibilityGrant.systemRole) ||
        (parsed.data.facilityWorkflowRole !== undefined &&
          parsed.data.facilityWorkflowRole !==
            compatibilityGrant.facilityWorkflowRole))
    ) {
      return NextResponse.json(
        { error: "Legacy and explicit invitation grants conflict" },
        { status: 400 }
      );
    }

    const profile = getServerDeploymentProfile();
    if (
      profile.id !== "sequencing-center" &&
      facilityWorkflowRole !== "REQUESTER"
    ) {
      return NextResponse.json(
        { error: "Facility workflow access is only available in Sequencing Center" },
        { status: 400 }
      );
    }

    if (systemRole === "ADMIN" && !normalizedEmail) {
      return NextResponse.json(
        { error: "Administrator invitations must be restricted to an email address" },
        { status: 400 }
      );
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const creator = await db.user.findUnique({
      where: { id: decision.principal!.id },
      select: { id: true, systemRole: true, isActive: true },
    });
    if (!creator?.isActive || creator.systemRole !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let invite = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = formatInviteCode(
        randomBytes(24).toString("hex"),
        systemRole
      );
      try {
        invite = await db.adminInvite.create({
          data: {
            code,
            email: normalizedEmail || null,
            expiresAt,
            createdById: decision.principal!.id,
            targetSystemRole: systemRole,
            targetFacilityWorkflowRole: facilityWorkflowRole,
          },
          include: {
            createdBy: {
              select: { firstName: true, lastName: true },
            },
          },
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!invite) {
      return NextResponse.json(
        { error: "Failed to generate a unique invite code" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ...invite, ...serializeInviteGrant(invite) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 }
    );
  }
}
