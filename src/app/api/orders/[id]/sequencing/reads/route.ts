import { NextResponse } from "next/server";
import { assignOrderSequencingReads } from "@/lib/sequencing/workspace";
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
      assignments?: Array<{
        sampleId: string;
        read1: string | null;
        read2: string | null;
        checksum1?: string | null;
        checksum2?: string | null;
        sequencingRunId?: string | null;
      }>;
    };

    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: "Invalid assignments data" }, { status: 400 });
    }

    const results = await assignOrderSequencingReads(id, body.assignments);
    return NextResponse.json({
      success: results.every((result) => result.success),
      results,
      message: "Sequencing read assignments updated",
    });
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

    console.error("[Order Sequencing] reads PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update sequencing reads" },
      { status: 500 }
    );
  }
}
