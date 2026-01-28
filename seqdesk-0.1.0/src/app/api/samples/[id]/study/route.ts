import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// DELETE - unassign sample from its study
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sampleId } = await params;

    // Get the sample with its order
    const sample = await db.sample.findUnique({
      where: { id: sampleId },
      include: {
        order: {
          select: { userId: true },
        },
      },
    });

    if (!sample) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    // Check ownership
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && sample.order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Unassign from study
    await db.sample.update({
      where: { id: sampleId },
      data: { studyId: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unassigning sample:", error);
    return NextResponse.json(
      { error: "Failed to unassign sample" },
      { status: 500 }
    );
  }
}
