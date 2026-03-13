import { NextResponse } from "next/server";
import { computeOrderSequencingChecksums } from "@/lib/sequencing/workspace";
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
    const body = (await request.json().catch(() => ({}))) as {
      readIds?: string[];
      artifactIds?: string[];
    };
    const summary = await computeOrderSequencingChecksums(id, body);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && /not found|configured|submitted or completed/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] checksum POST error:", error);
    return NextResponse.json(
      { error: "Failed to compute sequencing checksums" },
      { status: 500 }
    );
  }
}
