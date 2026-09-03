import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import {
  assertCanRemoveActiveAdministrator,
  FinalActiveAdministratorError,
  isSerializableTransactionConflict,
} from "@/lib/accounts/lifecycle";
import {
  grantFromLegacyAccountRole,
  isFacilityWorkflowRole,
  isInviteAccountRole,
  isSystemRole,
  legacyRoleForSystemRole,
} from "@/lib/accounts/invite-role";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const profile = getServerDeploymentProfile();
  const decision = decideCapability(
    session,
    "system.users.manage",
    profile
  );
  if (!decision.allowed || decision.principal?.isDemo) {
    const status = decision.allowed ? 403 : decision.status;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    role?: unknown;
    systemRole?: unknown;
    facilityWorkflowRole?: unknown;
  };
  const legacyRoleProvided = body.role !== undefined;
  const systemRoleProvided = body.systemRole !== undefined;
  const facilityWorkflowRoleProvided = body.facilityWorkflowRole !== undefined;
  if (legacyRoleProvided && !isInviteAccountRole(body.role)) {
    return NextResponse.json(
      { error: "role must be RESEARCHER or FACILITY_ADMIN" },
      { status: 400 }
    );
  }
  if (systemRoleProvided && !isSystemRole(body.systemRole)) {
    return NextResponse.json(
      { error: "systemRole must be MEMBER or ADMIN" },
      { status: 400 }
    );
  }
  if (
    facilityWorkflowRoleProvided &&
    !isFacilityWorkflowRole(body.facilityWorkflowRole)
  ) {
    return NextResponse.json(
      { error: "facilityWorkflowRole must be REQUESTER or OPERATOR" },
      { status: 400 }
    );
  }
  if (!legacyRoleProvided && !systemRoleProvided && !facilityWorkflowRoleProvided) {
    return NextResponse.json(
      { error: "Provide systemRole or facilityWorkflowRole" },
      { status: 400 }
    );
  }

  const legacyGrant = isInviteAccountRole(body.role)
    ? grantFromLegacyAccountRole(body.role)
    : null;
  if (
    legacyGrant &&
    ((isSystemRole(body.systemRole) &&
      legacyGrant.systemRole !== body.systemRole) ||
      (isFacilityWorkflowRole(body.facilityWorkflowRole) &&
        legacyGrant.facilityWorkflowRole !== body.facilityWorkflowRole))
  ) {
    return NextResponse.json(
      { error: "Legacy role and explicit access fields conflict" },
      { status: 400 }
    );
  }
  if (
    profile.id !== "sequencing-center" &&
    body.facilityWorkflowRole === "OPERATOR"
  ) {
    return NextResponse.json(
      { error: "Facility workflow access is only available in Sequencing Center" },
      { status: 400 }
    );
  }

  const { id } = await params;

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await db.$transaction(
          async (tx) => {
            const target = await tx.user.findUnique({
              where: { id },
              select: {
                id: true,
                role: true,
                systemRole: true,
                facilityWorkflowRole: true,
                isActive: true,
                email: true,
              },
            });
            if (!target) return null;
            const currentSystemRole = isSystemRole(target.systemRole)
              ? target.systemRole
              : "MEMBER";
            const currentFacilityWorkflowRole = isFacilityWorkflowRole(
              target.facilityWorkflowRole
            )
              ? target.facilityWorkflowRole
              : "REQUESTER";
            const systemRole = isSystemRole(body.systemRole)
              ? body.systemRole
              : legacyGrant?.systemRole ?? currentSystemRole;
            const facilityWorkflowRole =
              profile.id === "sequencing-center"
                ? isFacilityWorkflowRole(body.facilityWorkflowRole)
                  ? body.facilityWorkflowRole
                  : legacyGrant?.facilityWorkflowRole ??
                    currentFacilityWorkflowRole
                : "REQUESTER";
            const legacyRole = legacyRoleForSystemRole(systemRole);
            if (
              target.systemRole === systemRole &&
              target.facilityWorkflowRole === facilityWorkflowRole &&
              target.role === legacyRole
            ) {
              return target;
            }

            if (target.systemRole === "ADMIN" && systemRole === "MEMBER") {
              await assertCanRemoveActiveAdministrator(tx, target);
            }

            const updated = await tx.user.update({
              where: { id },
              data: {
                systemRole,
                facilityWorkflowRole,
                // Older releases understand only this field. Mirror system
                // access conservatively so a member operator never becomes an
                // administrator after downgrade.
                role: legacyRole,
              },
              select: {
                id: true,
                role: true,
                systemRole: true,
                facilityWorkflowRole: true,
                isActive: true,
                email: true,
              },
            });

            if (target.systemRole === "ADMIN" && systemRole === "MEMBER") {
              await tx.adminInvite.updateMany({
                where: { createdById: id, usedAt: null, revokedAt: null },
                data: {
                  revokedAt: new Date(),
                  revokedById: decision.principal!.id,
                },
              });
            }

            return updated;
          },
          { isolationLevel: "Serializable" }
        );

        if (!result) {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        console.info("Account access changed", {
          actorId: decision.principal!.id,
          targetId: result.id,
          systemRole: result.systemRole,
          facilityWorkflowRole: result.facilityWorkflowRole,
          legacyRole: result.role,
        });
        return NextResponse.json(result);
      } catch (error) {
        if (error instanceof FinalActiveAdministratorError) {
          return NextResponse.json(
            {
              error: "Create another administrator before demoting the final administrator",
              code: "FINAL_ADMINISTRATOR",
            },
            { status: 409 }
          );
        }
        if (isSerializableTransactionConflict(error) && attempt < 2) continue;
        throw error;
      }
    }
  } catch (error) {
    console.error("Failed to change account access:", error);
    return NextResponse.json(
      { error: "Failed to change account access" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "Account access changed concurrently; please retry" },
    { status: 409 }
  );
}
