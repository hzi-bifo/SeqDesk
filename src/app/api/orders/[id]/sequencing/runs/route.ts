import { NextRequest, NextResponse } from "next/server";
import {
  requireFacilityAdminSequencingReadSession,
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import {
  createSequencingRunForOrder,
  listSequencingRunsForOrder,
} from "@/lib/sequencing/run-plan";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFacilityAdminSequencingReadSession();
    const { id } = await params;
    const payload = await listSequencingRunsForOrder(id, {
      isFacilityAdmin: session.user.role === "FACILITY_ADMIN",
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Sequencing Runs] GET error:", error);
    return NextResponse.json({ error: "Failed to load sequencing runs" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = await request.json();
    const run = await createSequencingRunForOrder({
      orderId: id,
      runId: body.runId,
      runName: body.runName,
      platform: body.platform,
      instrument: body.instrument,
      runDate: body.runDate,
      folderPath: body.folderPath,
      runParameters:
        typeof body.runParameters === "object" && body.runParameters !== null
          ? body.runParameters
          : {},
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to create sequencing run";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
