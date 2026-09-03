import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  decideCapability,
  type Capability,
  type CapabilityDecision,
  type SessionPrincipalInput,
} from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

function authorizationResponse(decision: CapabilityDecision): NextResponse {
  const error =
    decision.status === 401
      ? "Unauthorized"
      : decision.status === 404
        ? "Not found"
        : "Forbidden";
  return NextResponse.json({ error }, { status: decision.status });
}

async function authorizeSubmission(
  session: SessionPrincipalInput | null | undefined,
  capability: Capability,
  submission?: { entityType: string; entityId: string }
): Promise<CapabilityDecision> {
  const decision = decideCapability(
    session,
    capability,
    getServerDeploymentProfile()
  );
  if (
    !decision.allowed ||
    !decision.grant ||
    decision.grant.scope === "installation" ||
    !submission
  ) {
    return decision;
  }

  let ownerId: string | null = null;
  if (submission.entityType === "study") {
    const study = await db.study.findUnique({
      where: { id: submission.entityId },
      select: { userId: true },
    });
    ownerId = study?.userId ?? null;
  } else if (submission.entityType === "sample") {
    const sample = await db.sample.findUnique({
      where: { id: submission.entityId },
      select: {
        study: { select: { userId: true } },
        order: { select: { userId: true } },
      },
    });
    ownerId = sample?.study?.userId ?? sample?.order?.userId ?? null;
  }

  return ownerId === decision.principal?.id
    ? decision
    : { ...decision, allowed: false, status: 403, reason: "forbidden", grant: undefined };
}

// GET /api/admin/submissions/[id] - Get single submission
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const initialAccess = await authorizeSubmission(session, "publishing.submit");

  if (!initialAccess.allowed) {
    return authorizationResponse(initialAccess);
  }

  const { id } = await params;

  try {
    const submission = await db.submission.findUnique({
      where: { id },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const submissionAccess = await authorizeSubmission(
      session,
      "publishing.submit",
      submission
    );
    if (!submissionAccess.allowed) {
      return authorizationResponse(submissionAccess);
    }

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Error fetching submission:", error);
    return NextResponse.json(
      { error: "Failed to fetch submission" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/submissions/[id] - Delete a submission
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const deleteAccess = await authorizeSubmission(session, "data.purge_shared");

  if (!deleteAccess.allowed) {
    return authorizationResponse(deleteAccess);
  }

  const { id } = await params;

  try {
    const submission = await db.submission.findUnique({
      where: { id },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // If this was a successful submission, we might want to clear the accession numbers
    // from the study/samples (optional - only for test submissions)
    if (submission.entityType === "study" && submission.accessionNumbers) {
      let isTest = false;
      if (submission.response) {
        try {
          const response = JSON.parse(submission.response);
          isTest = Boolean(response?.isTest);
        } catch {
          isTest = false;
        }
      }

      // Only clear accession numbers for test submissions
      if (isTest) {
        // Clear sample accession numbers
        let accessions: Record<string, string | null> | null = null;
        try {
          accessions = JSON.parse(submission.accessionNumbers);
        } catch {
          accessions = null;
        }
        const studyAccession = accessions?.study;

        if (studyAccession) {
          await db.study.updateMany({
            where: {
              id: submission.entityId,
              studyAccessionId: studyAccession,
            },
            data: {
              studyAccessionId: null,
              submitted: false,
              submittedAt: null,
              testRegisteredAt: null,
            },
          });
        }

        const sampleAccessions = accessions
          ? Object.entries(accessions).filter(
              ([sampleId, accession]) =>
                sampleId !== "study" && typeof accession === "string" && accession.length > 0
            )
          : [];

        for (const [sampleId, accession] of sampleAccessions) {
          await db.sample.updateMany({
            where: {
              sampleId,
              studyId: submission.entityId,
              sampleAccessionNumber: accession,
            },
            data: {
              sampleAccessionNumber: null,
            },
          });
        }
      }
    }

    // Delete the submission
    await db.submission.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Submission deleted" });
  } catch (error) {
    console.error("Error deleting submission:", error);
    return NextResponse.json(
      { error: "Failed to delete submission" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/submissions/[id] - Update submission status (e.g., cancel)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const initialAccess = await authorizeSubmission(session, "publishing.submit");

  if (!initialAccess.allowed) {
    return authorizationResponse(initialAccess);
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }

    const validStatuses = ["PENDING", "SUBMITTED", "ACCEPTED", "REJECTED", "ERROR", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const existingSubmission = await db.submission.findUnique({ where: { id } });
    if (!existingSubmission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const submissionAccess = await authorizeSubmission(
      session,
      "publishing.submit",
      existingSubmission
    );
    if (!submissionAccess.allowed) {
      return authorizationResponse(submissionAccess);
    }

    const submission = await db.submission.update({
      where: { id },
      data: { status },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Error updating submission:", error);
    return NextResponse.json(
      { error: "Failed to update submission" },
      { status: 500 }
    );
  }
}
