import { NextRequest, NextResponse } from "next/server";
import {
  requireFacilityAdminSequencingReadSession,
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import {
  listSequencingRunsForOrder,
  upsertSequencingRunSamples,
} from "@/lib/sequencing/run-plan";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    const session = await requireFacilityAdminSequencingReadSession();
    const { id, runId } = await params;
    const payload = await listSequencingRunsForOrder(id, {
      isFacilityAdmin: session.user.role === "FACILITY_ADMIN",
    });
    const run = payload.runs.find((item) => item.id === runId);
    if (!run) {
      return NextResponse.json({ error: "Sequencing run not found" }, { status: 404 });
    }
    return NextResponse.json({ fields: payload.fields, samples: run.samples });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load run samples" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, runId } = await params;
    const body = await request.json();
    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: "Assignments must be an array" }, { status: 400 });
    }
    const assignments = await upsertSequencingRunSamples({
      orderId: id,
      runDbId: runId,
      assignments: body.assignments,
    });
    return NextResponse.json({ success: true, assignments });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to save run samples";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
