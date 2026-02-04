import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Order status progression
const STATUS_ORDER = ["DRAFT", "SUBMITTED", "COMPLETED"];

// GET single order
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

    const order = await db.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            department: {
              select: { name: true },
            },
          },
        },
        samples: {
          include: {
            reads: true,
            study: {
              select: {
                id: true,
                title: true,
                submitted: true,
              },
            },
          },
        },
        sampleset: true,
        statusNotes: {
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        _count: {
          select: { samples: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check permission: must be owner or facility admin
    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}

// PUT update order
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
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Check if order exists and user has permission
    const existing = await db.order.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Researchers can only edit their own orders in DRAFT status
    if (!isFacilityAdmin) {
      if (existing.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (existing.status !== "DRAFT") {
        return NextResponse.json(
          { error: "Cannot edit order after submission" },
          { status: 400 }
        );
      }
    }

    const {
      name,
      contactName,
      contactEmail,
      contactPhone,
      billingAddress,
      platform,
      instrumentModel,
      librarySelection,
      libraryStrategy,
      librarySource,
      numberOfSamples,
      customFields,
      status,
      statusNote,
    } = body;

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name.trim();
    if (contactName !== undefined) updateData.contactName = contactName?.trim() || null;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail?.trim() || null;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone?.trim() || null;
    if (billingAddress !== undefined) updateData.billingAddress = billingAddress?.trim() || null;
    if (platform !== undefined) updateData.platform = platform || null;
    if (instrumentModel !== undefined) updateData.instrumentModel = instrumentModel?.trim() || null;
    if (librarySelection !== undefined) updateData.librarySelection = librarySelection || null;
    if (libraryStrategy !== undefined) updateData.libraryStrategy = libraryStrategy || null;
    if (librarySource !== undefined) updateData.librarySource = librarySource || null;
    if (numberOfSamples !== undefined) updateData.numberOfSamples = numberOfSamples ? parseInt(numberOfSamples, 10) : null;
    if (customFields !== undefined) updateData.customFields = customFields ? JSON.stringify(customFields) : null;

    // Status change handling
    if (status !== undefined && status !== existing.status) {
      // Validate status transition
      const currentIdx = STATUS_ORDER.indexOf(existing.status);
      const newIdx = STATUS_ORDER.indexOf(status);

      // Researchers can only advance to SUBMITTED
      if (!isFacilityAdmin) {
        if (status !== "SUBMITTED" || existing.status !== "DRAFT") {
          return NextResponse.json(
            { error: "Invalid status transition" },
            { status: 400 }
          );
        }
      }

      // Facility admins can change status more freely but should generally follow order
      if (newIdx < currentIdx && !isFacilityAdmin) {
        return NextResponse.json(
          { error: "Cannot move status backwards" },
          { status: 400 }
        );
      }

      updateData.status = status;
      updateData.statusUpdatedAt = new Date();

      // Create status change note
      if (statusNote || true) {
        await db.statusNote.create({
          data: {
            orderId: id,
            userId: session.user.id,
            noteType: "STATUS_CHANGE",
            content: statusNote || `Status changed from ${existing.status} to ${status}`,
          },
        });
      }
    }

    const order = await db.order.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(order);
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}

// Helper to check if deletion of submitted orders is allowed
async function isDeleteSubmittedOrdersAllowed(): Promise<boolean> {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings?.extraSettings) return false;
    const extra = JSON.parse(settings.extraSettings);
    return extra.allowDeleteSubmittedOrders === true;
  } catch {
    return false;
  }
}

// DELETE order
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
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const existing = await db.order.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Only owner or facility admin can delete
    if (!isFacilityAdmin && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check deletion rules for non-draft orders
    if (existing.status !== "DRAFT") {
      // Researchers can never delete submitted orders
      if (!isFacilityAdmin) {
        return NextResponse.json(
          { error: "Cannot delete order after submission" },
          { status: 400 }
        );
      }

      // Facility admins can only delete if the setting is enabled
      const allowDelete = await isDeleteSubmittedOrdersAllowed();
      if (!allowDelete) {
        return NextResponse.json(
          { error: "Deletion of submitted orders is disabled. Enable it in Settings > Data Handling." },
          { status: 400 }
        );
      }
    }

    // Unassign any samples from studies before deleting
    await db.sample.updateMany({
      where: { orderId: id },
      data: { studyId: null },
    });

    await db.order.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Order deleted" });
  } catch (error) {
    console.error("Error deleting order:", error);
    return NextResponse.json(
      { error: "Failed to delete order" },
      { status: 500 }
    );
  }
}
