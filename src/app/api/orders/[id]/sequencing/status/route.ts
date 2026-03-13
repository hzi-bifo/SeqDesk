import { NextResponse } from "next/server";
import { setOrderSequencingStatuses } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = (await request.json()) as {
      updates?: Array<{ sampleId: string; facilityStatus: string }>;
    };

    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json({ error: "No status updates provided" }, { status: 400 });
    }

    const results = await setOrderSequencingStatuses(id, body.updates);
    return NextResponse.json({ success: true, results });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof Error && /submitted or completed/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] status PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update sample statuses" },
      { status: 500 }
    );
  }
}
