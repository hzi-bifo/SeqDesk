import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Order status progression
const STATUS_ORDER = ["DRAFT", "SUBMITTED", "COMPLETED"];

type OrderDetailResponse = {
  id: string;
  name: string | null;
  status: string;
  statusUpdatedAt: Date;
  createdAt: Date;
  numberOfSamples: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  platform: string | null;
  instrumentModel: string | null;
  librarySelection: string | null;
  libraryStrategy: string | null;
  librarySource: string | null;
  customFields: string | null;
  userId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    department: { name: string } | null;
  };
  samples: Array<{
    id: string;
    sampleId: string;
    sampleAlias: string | null;
    sampleTitle: string | null;
    sampleDescription: string | null;
    scientificName: string | null;
    taxId: string | null;
    customFields: string | null;
    reads: Array<{
      id: string;
      file1: string | null;
      file2: string | null;
      readCount1: number | null;
      readCount2: number | null;
    }>;
    study: {
      id: string;
      title: string;
      submitted: boolean;
    } | null;
  }>;
  statusNotes: Array<{
    id: string;
    noteType: string;
    content: string;
    createdAt: Date;
    user: { firstName: string; lastName: string } | null;
  }>;
  _count: {
    samples: number;
  };
};

async function getOrderWithResolvedRelations(id: string): Promise<OrderDetailResponse | null> {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      statusUpdatedAt: true,
      createdAt: true,
      numberOfSamples: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      billingAddress: true,
      platform: true,
      instrumentModel: true,
      librarySelection: true,
      libraryStrategy: true,
      librarySource: true,
      customFields: true,
      userId: true,
      _count: {
        select: { samples: true },
      },
    },
  });

  if (!order) return null;

  const [user, samples, statusNotes] = await Promise.all([
    db.user.findUnique({
      where: { id: order.userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        department: {
          select: { name: true },
        },
      },
    }),
    db.sample.findMany({
      where: { orderId: id },
      select: {
        id: true,
        sampleId: true,
        sampleAlias: true,
        sampleTitle: true,
        sampleDescription: true,
        scientificName: true,
        taxId: true,
        customFields: true,
        reads: {
          select: {
            id: true,
            file1: true,
            file2: true,
            readCount1: true,
            readCount2: true,
          },
        },
        study: {
          select: {
            id: true,
            title: true,
            submitted: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.statusNote.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        noteType: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
  ]);

  return {
    ...order,
    user:
      user ??
      ({
        id: order.userId,
        firstName: "Unknown",
        lastName: "User",
        email: "",
        department: null,
      } as const),
    samples,
    statusNotes,
  };
}

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

    const order = await getOrderWithResolvedRelations(id);

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
      markSamplesSent,
    } = body;

    const requestedMetadataUpdate =
      name !== undefined ||
      contactName !== undefined ||
      contactEmail !== undefined ||
      contactPhone !== undefined ||
      billingAddress !== undefined ||
      platform !== undefined ||
      instrumentModel !== undefined ||
      librarySelection !== undefined ||
      libraryStrategy !== undefined ||
      librarySource !== undefined ||
      numberOfSamples !== undefined ||
      customFields !== undefined;

    // Researchers can edit metadata on DRAFT/SUBMITTED orders, but not COMPLETED ones.
    if (!isFacilityAdmin) {
      if (existing.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (requestedMetadataUpdate && existing.status === "COMPLETED") {
        return NextResponse.json(
          { error: "Cannot edit completed order" },
          { status: 400 }
        );
      }
    }

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
      await db.statusNote.create({
        data: {
          orderId: id,
          userId: session.user.id,
          noteType: "STATUS_CHANGE",
          content: statusNote || `Status changed from ${existing.status} to ${status}`,
        },
      });
    }

    if (markSamplesSent === true) {
      if (existing.status === "DRAFT") {
        return NextResponse.json(
          { error: "Cannot mark samples as sent before order submission" },
          { status: 400 }
        );
      }

      const existingShipmentNote = await db.statusNote.findFirst({
        where: {
          orderId: id,
          noteType: "SAMPLES_SENT",
        },
        select: { id: true },
      });

      if (!existingShipmentNote) {
        await db.statusNote.create({
          data: {
            orderId: id,
            userId: session.user.id,
            noteType: "SAMPLES_SENT",
            content: "Samples marked as sent to institution",
          },
        });
      }
    }

    const order = Object.keys(updateData).length > 0
      ? await db.order.update({
          where: { id },
          data: updateData,
        })
      : existing;

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
