import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isDemoSession } from "@/lib/demo/server";
import {
  buildOrderSequencingDeliverySummary,
} from "@/lib/sequencing/delivery";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFacilityAdminSequencingSession();
    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "Sequencing delivery publication is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const delivery = await buildOrderSequencingDeliverySummary(id);
    if (delivery.readFiles.length + delivery.artifactFiles.length === 0) {
      return NextResponse.json(
        { error: "No cleaned reads or customer-facing reports are available to publish." },
        { status: 400 }
      );
    }

    await db.order.update({
      where: { id },
      data: {
        sequencingFilesPublishedAt: new Date(),
        sequencingFilesPublishedById: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      delivery: await buildOrderSequencingDeliverySummary(id),
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[Order Sequencing Delivery] publication POST error:", error);
    return NextResponse.json(
      { error: "Failed to publish sequencing delivery" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFacilityAdminSequencingSession();
    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "Sequencing delivery publication is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    await db.order.update({
      where: { id },
      data: {
        sequencingFilesPublishedAt: null,
        sequencingFilesPublishedById: null,
      },
    });

    return NextResponse.json({
      success: true,
      delivery: await buildOrderSequencingDeliverySummary(id),
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message.includes("Record to update not found")) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    console.error("[Order Sequencing Delivery] publication DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to hide sequencing delivery" },
      { status: 500 }
    );
  }
}
