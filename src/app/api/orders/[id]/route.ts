import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { inputModuleEnabled } from "@/lib/modules/input-modules.server";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import {
  notifyOrderStatusChanged,
  notifyOrderSubmitted,
  notifySamplesMarkedSent,
} from "@/lib/notifications/dispatcher";
import { notifyOrderUpdatedInApp } from "@/lib/notifications/in-app";

// Order status progression
const STATUS_ORDER = ["DRAFT", "SUBMITTED", "COMPLETED"];

type OrderDetailResponse = {
  dataOrigin?: string;
  sourceMetadata?: string | null;
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
  sequencingFilesPublishedAt: Date | null;
  sequencingFilesPublishedById: string | null;
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

type OrderUpdateBody = {
  name?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billingAddress?: string | null;
  platform?: string | null;
  instrumentModel?: string | null;
  librarySelection?: string | null;
  libraryStrategy?: string | null;
  librarySource?: string | null;
  numberOfSamples?: string | number | null;
  customFields?: unknown;
  status?: string;
  statusNote?: string | null;
  markSamplesSent?: boolean;
};

async function getOrderWithResolvedRelations(
  id: string,
  options?: { canOperate?: boolean }
): Promise<OrderDetailResponse | null> {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      dataOrigin: true,
      sourceMetadata: true,
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
      sequencingFilesPublishedAt: true,
      sequencingFilesPublishedById: true,
      userId: true,
      _count: {
        select: { samples: true },
      },
    },
  });

  if (!order) return null;

  const readWhere = options?.canOperate || order.dataOrigin === "import"
    ? undefined
    : order.sequencingFilesPublishedAt
      ? { isActive: true, dataClass: "cleaned" }
      : { id: "__no_released_reads__" };

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
          ...(readWhere ? { where: readWhere } : {}),
          select: {
            id: true,
            file1: true,
            file2: true,
            readCount1: true,
            readCount2: true,
            dataClass: true,
            pipelineSources: true,
            runAccessionNumber: true,
            isActive: true,
            supersededByReadId: true,
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

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const deploymentProfile = getServerDeploymentProfile();
    const readAll = decideCapability(session, "orders.read_all", deploymentProfile);
    const readOwn = decideCapability(session, "orders.read", deploymentProfile);
    const readGrant = readAll.allowed ? readAll.grant : readOwn.grant;
    if (!readGrant) {
      const status = readOwn.status;
      return NextResponse.json(
        {
          error:
            status === 404
              ? "Not found"
              : status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status }
      );
    }

    const canOperate = decideCapability(
      session,
      "orders.process",
      deploymentProfile
    ).allowed;
    const order = await getOrderWithResolvedRelations(id, { canOperate });

    if (!order) {
      return NextResponse.json({ error: "Sequencing Order not found" }, { status: 404 });
    }

    if (readGrant.scope !== "installation" && order.userId !== session.user.id) {
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

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as OrderUpdateBody;
    const deploymentProfile = getServerDeploymentProfile();
    const readDecision = decideCapability(session, "orders.read", deploymentProfile);
    if (!readDecision.allowed) {
      return NextResponse.json(
        {
          error:
            readDecision.status === 404
              ? "Not found"
              : readDecision.status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status: readDecision.status }
      );
    }
    const canOperate = decideCapability(
      session,
      "orders.process",
      deploymentProfile
    ).allowed;

    // Check if order exists and user has permission
    const existing = await db.order.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Sequencing Order not found" }, { status: 404 });
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

    if ((status !== undefined || markSamplesSent) && (existing.dataOrigin === "import" || !await inputModuleEnabled("sequencing-management"))) {
      return NextResponse.json({ error: "Facility status actions are not available for this data" }, { status: 403 });
    }

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

    // Requesters can edit their own active orders. Operators and Shared Lab
    // members receive installation-scoped operational access from the profile.
    if (!canOperate) {
      if (existing.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (requestedMetadataUpdate && existing.status === "COMPLETED" && existing.dataOrigin !== "import") {
        return NextResponse.json(
          { error: "Cannot edit completed order" },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    let changedStatusTo: string | null = null;
    let samplesSentCreated = false;

    if (name !== undefined) updateData.name = typeof name === "string" ? name.trim() : null;
    if (contactName !== undefined) updateData.contactName = contactName?.trim() || null;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail?.trim() || null;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone?.trim() || null;
    if (billingAddress !== undefined) updateData.billingAddress = billingAddress?.trim() || null;
    if (platform !== undefined) updateData.platform = platform || null;
    if (instrumentModel !== undefined) updateData.instrumentModel = instrumentModel?.trim() || null;
    if (librarySelection !== undefined) updateData.librarySelection = librarySelection || null;
    if (libraryStrategy !== undefined) updateData.libraryStrategy = libraryStrategy || null;
    if (librarySource !== undefined) updateData.librarySource = librarySource || null;
    if (numberOfSamples !== undefined) {
      updateData.numberOfSamples =
        numberOfSamples === null || numberOfSamples === ""
          ? null
          : parseInt(String(numberOfSamples), 10);
    }
    if (customFields !== undefined) updateData.customFields = customFields ? JSON.stringify(customFields) : null;

    // Status change handling
    if (status !== undefined && status !== existing.status) {
      // Validate status transition
      const currentIdx = STATUS_ORDER.indexOf(existing.status);
      const newIdx = STATUS_ORDER.indexOf(status);

      // Researchers can only advance to SUBMITTED
      if (!canOperate) {
        if (status !== "SUBMITTED" || existing.status !== "DRAFT") {
          return NextResponse.json(
            { error: "Invalid status transition" },
            { status: 400 }
          );
        }
      }

      // Facility admins can change status more freely but should generally follow order
      if (newIdx < currentIdx && !canOperate) {
        return NextResponse.json(
          { error: "Cannot move status backwards" },
          { status: 400 }
        );
      }

      updateData.status = status;
      updateData.statusUpdatedAt = new Date();
      changedStatusTo = status;

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
        samplesSentCreated = true;
      }
    }

    const orderUpdated = Object.keys(updateData).length > 0;
    const order = orderUpdated
      ? await db.order.update({
          where: { id },
          data: updateData,
        })
      : existing;

    const actor = {
      id: session.user.id,
      role: session.user.role,
      email: session.user.email,
      name: session.user.name,
    };
    if (changedStatusTo) {
      if (existing.status === "DRAFT" && changedStatusTo === "SUBMITTED") {
        await notifyOrderSubmitted(id, actor);
      } else {
        await notifyOrderStatusChanged(id, existing.status, changedStatusTo, actor);
      }
    }
    if (samplesSentCreated) {
      await notifySamplesMarkedSent(id, actor);
    }
    if (orderUpdated) {
      await notifyOrderUpdatedInApp(
        id,
        actor,
        changedStatusTo
          ? `${actor.name || actor.email || "Someone"} changed order status from ${existing.status} to ${changedStatusTo}.`
          : `${actor.name || actor.email || "Someone"} updated order details.`
      );
    }

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

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const deploymentProfile = getServerDeploymentProfile();
    const readDecision = decideCapability(session, "orders.read", deploymentProfile);
    if (!readDecision.allowed) {
      return NextResponse.json(
        {
          error:
            readDecision.status === 404
              ? "Not found"
              : readDecision.status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status: readDecision.status }
      );
    }
    const canPurgeShared = decideCapability(
      session,
      "data.purge_shared",
      deploymentProfile
    ).allowed;

    const existing = await db.order.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Sequencing Order not found" }, { status: 404 });
    }

    // Permanent deletion of another member's record is installation
    // administration, even in Shared Lab. Creators retain the legacy ability
    // to remove their own draft until archive/trash replaces hard deletion.
    if (!canPurgeShared && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check deletion rules for non-draft orders
    if (existing.status !== "DRAFT") {
      // Researchers can never delete submitted orders
      if (!canPurgeShared) {
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
