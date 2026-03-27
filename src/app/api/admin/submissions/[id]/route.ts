import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/admin/submissions/[id] - Get single submission
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const submission = await db.submission.findUnique({
      where: { id },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
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

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
