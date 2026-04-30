import { NextRequest, NextResponse } from "next/server";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import {
  deleteSequencingRunForOrder,
  updateSequencingRunForOrder,
} from "@/lib/sequencing/run-plan";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, runId } = await params;
    const body = await request.json();
    const run = await updateSequencingRunForOrder({
      orderId: id,
      runDbId: runId,
      runName: body.runName,
      platform: body.platform,
      instrument: body.instrument,
      runDate: body.runDate,
      folderPath: body.folderPath,
      runParameters:
        typeof body.runParameters === "object" && body.runParameters !== null
          ? body.runParameters
          : undefined,
    });
    return NextResponse.json(run);
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update sequencing run";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, runId } = await params;
    await deleteSequencingRunForOrder(id, runId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to delete sequencing run";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
