import { NextResponse } from "next/server";
import { completeSequencingUpload } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, uploadId } = await params;
    const result = await completeSequencingUpload(id, uploadId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && /not found|incomplete|require/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] upload complete POST error:", error);
    return NextResponse.json(
      { error: "Failed to finalize upload" },
      { status: 500 }
    );
  }
}
