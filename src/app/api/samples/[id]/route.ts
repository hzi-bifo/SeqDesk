import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET single sample
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

    const sample = await db.sample.findUnique({
      where: { id },
      include: {
        order: {
          select: { id: true, userId: true, orderNumber: true },
        },
        study: {
          select: { id: true, title: true },
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

    return NextResponse.json(sample);
  } catch (error) {
    console.error("Error fetching sample:", error);
    return NextResponse.json({ error: "Failed to fetch sample" }, { status: 500 });
  }
}

// PUT update sample
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

    // Get sample with order to check ownership
    const existing = await db.sample.findUnique({
      where: { id },
      include: {
        order: {
          select: { userId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    // Check ownership
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (body.sampleAlias !== undefined) updateData.sampleAlias = body.sampleAlias;
    if (body.sampleTitle !== undefined) updateData.sampleTitle = body.sampleTitle;
    if (body.sampleDescription !== undefined) updateData.sampleDescription = body.sampleDescription;
    if (body.scientificName !== undefined) updateData.scientificName = body.scientificName;
    if (body.taxId !== undefined) updateData.taxId = body.taxId;

    // Handle checklistData (MIxS metadata)
    if (body.checklistData !== undefined) {
      updateData.checklistData = JSON.stringify(body.checklistData);
    }

    const sample = await db.sample.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(sample);
  } catch (error) {
    console.error("Error updating sample:", error);
    return NextResponse.json({ error: "Failed to update sample" }, { status: 500 });
  }
}

// DELETE sample
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

    // Get sample with order to check ownership
    const existing = await db.sample.findUnique({
      where: { id },
      include: {
        order: {
          select: { userId: true, status: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    // Check ownership
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only allow deletion if order is in DRAFT status (unless admin)
    if (!isFacilityAdmin && existing.order.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Cannot delete samples from a submitted order" },
        { status: 400 }
      );
    }

    await db.sample.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting sample:", error);
    return NextResponse.json({ error: "Failed to delete sample" }, { status: 500 });
  }
}
