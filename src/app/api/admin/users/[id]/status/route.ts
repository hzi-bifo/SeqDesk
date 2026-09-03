import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  assertCanRemoveActiveAdministrator,
  FinalActiveAdministratorError,
  isSerializableTransactionConflict,
} from "@/lib/accounts/lifecycle";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

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
    isActive?: unknown;
  };
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json(
      { error: "isActive must be a boolean" },
      { status: 400 }
    );
  }
  const requestedIsActive = body.isActive;

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
                email: true,
                systemRole: true,
                isActive: true,
                deactivatedAt: true,
              },
            });
            if (!target) return null;
            if (target.isActive === requestedIsActive) return target;

            if (!requestedIsActive) {
              await assertCanRemoveActiveAdministrator(tx, target);
            }

            const updated = await tx.user.update({
              where: { id },
              data: {
                isActive: requestedIsActive,
                deactivatedAt: requestedIsActive ? null : new Date(),
              },
              select: {
                id: true,
                email: true,
                systemRole: true,
                isActive: true,
                deactivatedAt: true,
              },
            });

            if (!requestedIsActive) {
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

        console.info("Account status changed", {
          actorId: decision.principal!.id,
          targetId: result.id,
          isActive: result.isActive,
        });
        return NextResponse.json(result);
      } catch (error) {
        if (error instanceof FinalActiveAdministratorError) {
          return NextResponse.json(
            {
              error:
                "Create another active administrator before deactivating the final administrator",
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
    console.error("Failed to change account status:", error);
    return NextResponse.json(
      { error: "Failed to change account status" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "Account status changed concurrently; please retry" },
    { status: 409 }
  );
}
