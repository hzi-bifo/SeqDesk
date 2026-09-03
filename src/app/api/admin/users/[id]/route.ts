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

const RETAINED_RELATION_KEYS = [
  "createdInvites",
  "orders",
  "orderNotesEdited",
  "sequencingFilesPublishedOrders",
  "statusNotes",
  "studies",
  "studyNotesEdited",
  "tickets",
  "ticketMessages",
  "pipelineRuns",
  "pipelineResultSelectionsSelected",
  "sequencingArtifactsCreated",
  "sequencingUploadsCreated",
  "backgroundWorkersStarted",
  "workbenchImportJobsCreated",
] as const;

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
  if (!decision.allowed || decision.principal?.isDemo) {
    const status = decision.allowed ? 403 : decision.status;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    confirmationEmail?: unknown;
  };
  const confirmationEmail =
    typeof body.confirmationEmail === "string"
      ? body.confirmationEmail.trim().toLowerCase()
      : "";
  if (!confirmationEmail) {
    return NextResponse.json(
      { error: "Type the account email address to confirm permanent deletion" },
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
                email: true,
                systemRole: true,
                isActive: true,
                demoWorkspace: { select: { id: true } },
                adminDemoWorkspace: { select: { id: true } },
                usedInvite: { select: { id: true } },
                workbenchWorkspace: { select: { id: true } },
                _count: {
                  select: {
                    createdInvites: true,
                    orders: true,
                    orderNotesEdited: true,
                    sequencingFilesPublishedOrders: true,
                    statusNotes: true,
                    studies: true,
                    studyNotesEdited: true,
                    tickets: true,
                    ticketMessages: true,
                    pipelineRuns: true,
                    pipelineResultSelectionsSelected: true,
                    sequencingArtifactsCreated: true,
                    sequencingUploadsCreated: true,
                    backgroundWorkersStarted: true,
                    workbenchImportJobsCreated: true,
                  },
                },
              },
            });
            if (!target) return { kind: "missing" as const };

            if (target.email.toLowerCase() !== confirmationEmail) {
              return { kind: "confirmation-mismatch" as const };
            }

            await assertCanRemoveActiveAdministrator(tx, target);

            if (target.isActive) {
              return { kind: "active" as const };
            }

            const hasSingularRetainedRelation = Boolean(
              target.demoWorkspace ||
                target.adminDemoWorkspace ||
                target.usedInvite ||
                target.workbenchWorkspace
            );
            const hasRetainedRelation = RETAINED_RELATION_KEYS.some(
              (key) => target._count[key] > 0
            );
            if (hasSingularRetainedRelation || hasRetainedRelation) {
              return { kind: "retained-data" as const };
            }

            await tx.user.delete({ where: { id } });
            return { kind: "deleted" as const, id: target.id };
          },
          { isolationLevel: "Serializable" }
        );

        if (result.kind === "missing") {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        if (result.kind === "confirmation-mismatch") {
          return NextResponse.json(
            { error: "The confirmation email does not match this account" },
            { status: 400 }
          );
        }
        if (result.kind === "active") {
          return NextResponse.json(
            {
              error: "Deactivate this account before permanently deleting it",
              code: "ACCOUNT_ACTIVE",
            },
            { status: 409 }
          );
        }
        if (result.kind === "retained-data") {
          return NextResponse.json(
            {
              error:
                "This account has scientific, workspace, or provenance records and cannot be permanently deleted. Keep it deactivated instead.",
              code: "ACCOUNT_HAS_RETAINED_DATA",
            },
            { status: 409 }
          );
        }

        console.info("Inactive account permanently deleted", {
          actorId: decision.principal!.id,
          targetId: result.id,
        });
        return NextResponse.json({ deleted: true, id: result.id });
      } catch (error) {
        if (error instanceof FinalActiveAdministratorError) {
          return NextResponse.json(
            {
              error:
                "Create another active administrator before deleting the final administrator",
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
    console.error("Failed to permanently delete account:", error);
    return NextResponse.json(
      { error: "Failed to permanently delete account" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "Account changed concurrently; please retry" },
    { status: 409 }
  );
}
