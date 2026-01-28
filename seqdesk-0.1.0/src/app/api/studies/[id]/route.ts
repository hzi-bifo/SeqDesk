import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET single study with samples
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const study = await db.study.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        samples: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                name: true,
                status: true,
              },
            },
            reads: true,
          },
        },
      },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Check ownership (unless facility admin)
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(study);
  } catch (error) {
    console.error("Error fetching study:", error);
    return NextResponse.json(
      { error: "Failed to fetch study" },
      { status: 500 }
    );
  }
}

// PUT update study
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { title, description, alias, checklistType, studyMetadata, readyForSubmission } = body;

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (title !== undefined) updateData.title = title?.trim() || undefined;
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (alias !== undefined) updateData.alias = alias?.trim() || null;
    if (checklistType !== undefined) updateData.checklistType = checklistType;
    if (studyMetadata !== undefined) {
      updateData.studyMetadata = typeof studyMetadata === 'string'
        ? studyMetadata
        : JSON.stringify(studyMetadata);
    }
    if (readyForSubmission !== undefined) {
      updateData.readyForSubmission = readyForSubmission;
      if (readyForSubmission) {
        updateData.readyAt = new Date();
      } else {
        updateData.readyAt = null;
      }
    }

    const study = await db.study.update({
      where: { id },
      data: updateData,
      include: {
        samples: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                name: true,
                status: true,
              },
            },
            reads: true,
          },
        },
      },
    });

    return NextResponse.json(study);
  } catch (error) {
    console.error("Error updating study:", error);
    return NextResponse.json(
      { error: "Failed to update study" },
      { status: 500 }
    );
  }
}

// DELETE study
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id },
      select: { userId: true, submitted: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Prevent deletion of submitted studies
    if (existing.submitted) {
      return NextResponse.json(
        { error: "Cannot delete a submitted study" },
        { status: 400 }
      );
    }

    // Unassign all samples from this study (set studyId to null)
    await db.sample.updateMany({
      where: { studyId: id },
      data: { studyId: null },
    });

    // Delete the study
    await db.study.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting study:", error);
    return NextResponse.json(
      { error: "Failed to delete study" },
      { status: 500 }
    );
  }
}
