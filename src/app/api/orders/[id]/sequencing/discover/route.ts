import { NextResponse } from "next/server";
import { discoverOrderSequencingFiles } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = (await request.json()) as { autoAssign?: boolean; force?: boolean };
    const result = await discoverOrderSequencingFiles(id, body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof Error && /configured|submitted or completed/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] discover POST error:", error);
    return NextResponse.json(
      { error: "Failed to discover sequencing files" },
      { status: 500 }
    );
  }
}
