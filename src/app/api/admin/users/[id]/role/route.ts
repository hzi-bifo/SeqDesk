import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

type AccountRole = "RESEARCHER" | "FACILITY_ADMIN";
type SystemRole = "MEMBER" | "ADMIN";

class FinalAdministratorError extends Error {}

function isAccountRole(value: unknown): value is AccountRole {
  return value === "RESEARCHER" || value === "FACILITY_ADMIN";
}

function isSystemRole(value: unknown): value is SystemRole {
  return value === "MEMBER" || value === "ADMIN";
}

function isTransactionConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const decision = decideCapability(
    session,
    "system.users.manage",
    getServerDeploymentProfile()
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
  };
  const legacyRoleProvided = body.role !== undefined;
  const systemRoleProvided = body.systemRole !== undefined;
  if (legacyRoleProvided && !isAccountRole(body.role)) {
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

  const legacyRole = isAccountRole(body.role) ? body.role : null;
  const legacySystemRole =
    legacyRole === "FACILITY_ADMIN"
      ? "ADMIN"
      : legacyRole === "RESEARCHER"
        ? "MEMBER"
        : null;
  const systemRole = isSystemRole(body.systemRole)
    ? body.systemRole
    : legacySystemRole;
  if (!systemRole) {
    return NextResponse.json(
      { error: "systemRole must be MEMBER or ADMIN" },
      { status: 400 }
    );
  }
  if (legacySystemRole && legacySystemRole !== systemRole) {
    return NextResponse.json(
      { error: "role and systemRole describe different account access" },
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
              select: { id: true, role: true, systemRole: true, email: true },
            });
            if (!target) return null;
            if (
              target.systemRole === systemRole &&
              (!legacyRole || target.role === legacyRole)
            ) {
              return target;
            }

            if (target.systemRole === "ADMIN" && systemRole === "MEMBER") {
              const administratorCount = await tx.user.count({
                where: { systemRole: "ADMIN" },
              });
              if (administratorCount <= 1) {
                throw new FinalAdministratorError();
              }
            }

            return tx.user.update({
              where: { id },
              data: {
                systemRole,
                // Legacy callers still send `role`; keep both columns in sync
                // for rollback compatibility. New callers change only the
                // installation-level role.
                ...(legacyRole ? { role: legacyRole } : {}),
              },
              select: { id: true, role: true, systemRole: true, email: true },
            });
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
          legacyRole: result.role,
        });
        return NextResponse.json(result);
      } catch (error) {
        if (error instanceof FinalAdministratorError) {
          return NextResponse.json(
            {
              error: "Create another administrator before demoting the final administrator",
              code: "FINAL_ADMINISTRATOR",
            },
            { status: 409 }
          );
        }
        if (isTransactionConflict(error) && attempt < 2) continue;
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
