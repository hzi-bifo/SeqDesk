import { NextResponse } from "next/server";
import { getOrderSequencingSummary } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingReadSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingReadSession();
    const { id } = await params;
    const summary = await getOrderSequencingSummary(id);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[Order Sequencing] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load sequencing data" },
      { status: 500 }
    );
  }
}
