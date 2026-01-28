import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST assign samples to study
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds, perSampleData } = body;

    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify all samples exist and belong to the user
    const samples = await db.sample.findMany({
      where: {
        id: { in: sampleIds },
      },
      include: {
        order: {
          select: { userId: true },
        },
      },
    });

    // Check ownership of all samples
    if (!isFacilityAdmin) {
      const unauthorized = samples.filter(
        (s) => s.order.userId !== session.user.id
      );
      if (unauthorized.length > 0) {
        return NextResponse.json(
          { error: "Cannot assign samples you don't own" },
          { status: 403 }
        );
      }
    }

    // Assign samples to study
    await db.sample.updateMany({
      where: {
        id: { in: sampleIds },
      },
      data: {
        studyId: studyId,
      },
    });

    // Save per-sample metadata (collection_date, geographic_location, etc.)
    if (perSampleData && typeof perSampleData === "object") {
      for (const [sampleId, data] of Object.entries(perSampleData)) {
        if (sampleIds.includes(sampleId) && data && typeof data === "object") {
          await db.sample.update({
            where: { id: sampleId },
            data: { checklistData: JSON.stringify(data) },
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      assignedCount: sampleIds.length,
    });
  } catch (error) {
    console.error("Error assigning samples:", error);
    return NextResponse.json(
      { error: "Failed to assign samples" },
      { status: 500 }
    );
  }
}

// PUT update samples and their metadata for a study
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds, perSampleData } = body;

    if (!Array.isArray(sampleIds)) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get samples currently in this study
    const currentSamples = await db.sample.findMany({
      where: { studyId },
      select: { id: true },
    });
    const currentSampleIds = currentSamples.map((s) => s.id);

    // Determine samples to add and remove
    const samplesToAdd = sampleIds.filter(
      (id: string) => !currentSampleIds.includes(id)
    );
    const samplesToRemove = currentSampleIds.filter(
      (id) => !sampleIds.includes(id)
    );

    // Verify ownership of samples to add
    if (samplesToAdd.length > 0) {
      const newSamples = await db.sample.findMany({
        where: { id: { in: samplesToAdd } },
        include: { order: { select: { userId: true } } },
      });

      if (!isFacilityAdmin) {
        const unauthorized = newSamples.filter(
          (s) => s.order.userId !== session.user.id
        );
        if (unauthorized.length > 0) {
          return NextResponse.json(
            { error: "Cannot assign samples you don't own" },
            { status: 403 }
          );
        }
      }
    }

    // Remove samples that are no longer selected
    if (samplesToRemove.length > 0) {
      await db.sample.updateMany({
        where: { id: { in: samplesToRemove }, studyId },
        data: { studyId: null },
      });
    }

    // Add new samples
    if (samplesToAdd.length > 0) {
      await db.sample.updateMany({
        where: { id: { in: samplesToAdd } },
        data: { studyId },
      });
    }

    // Update per-sample metadata (checklistData)
    if (perSampleData && typeof perSampleData === "object") {
      for (const [sampleId, data] of Object.entries(perSampleData)) {
        if (sampleIds.includes(sampleId) && data && typeof data === "object") {
          await db.sample.update({
            where: { id: sampleId },
            data: { checklistData: JSON.stringify(data) },
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      added: samplesToAdd.length,
      removed: samplesToRemove.length,
    });
  } catch (error) {
    console.error("Error updating samples:", error);
    return NextResponse.json(
      { error: "Failed to update samples" },
      { status: 500 }
    );
  }
}

// DELETE remove samples from study (unassign)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds } = body;

    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Unassign samples (set studyId to null)
    await db.sample.updateMany({
      where: {
        id: { in: sampleIds },
        studyId: studyId, // Only unassign samples that are in this study
      },
      data: {
        studyId: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing samples:", error);
    return NextResponse.json(
      { error: "Failed to remove samples" },
      { status: 500 }
    );
  }
}
