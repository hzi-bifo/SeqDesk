import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

type AccountRole = "RESEARCHER" | "FACILITY_ADMIN";

class FinalAdministratorError extends Error {}

function isAccountRole(value: unknown): value is AccountRole {
  return value === "RESEARCHER" || value === "FACILITY_ADMIN";
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

  const { role } = (await request.json().catch(() => ({}))) as { role?: unknown };
  if (!isAccountRole(role)) {
    return NextResponse.json(
      { error: "role must be RESEARCHER or FACILITY_ADMIN" },
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
              select: { id: true, role: true, email: true },
            });
            if (!target) return null;
            if (target.role === role) return target;

            if (target.role === "FACILITY_ADMIN" && role === "RESEARCHER") {
              const administratorCount = await tx.user.count({
                where: { role: "FACILITY_ADMIN" },
              });
              if (administratorCount <= 1) {
                throw new FinalAdministratorError();
              }
            }

            return tx.user.update({
              where: { id },
              data: { role },
              select: { id: true, role: true, email: true },
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
          role: result.role,
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
