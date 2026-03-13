import { NextResponse } from "next/server";
import { appendSequencingUploadChunk, cancelSequencingUpload } from "@/lib/sequencing/workspace";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, uploadId } = await params;
    const offsetHeader = request.headers.get("x-seqdesk-offset");

    if (!offsetHeader) {
      return NextResponse.json({ error: "x-seqdesk-offset header is required" }, { status: 400 });
    }

    const offset = BigInt(offsetHeader);
    if (!request.body) {
      return NextResponse.json({ error: "Upload chunk body is required" }, { status: 400 });
    }

    const result = await appendSequencingUploadChunk(id, uploadId, offset, request.body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && /offset|not found|body/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[Order Sequencing] upload PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to upload chunk" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, uploadId } = await params;
    await cancelSequencingUpload(id, uploadId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Upload not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[Order Sequencing] upload DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to cancel upload" },
      { status: 500 }
    );
  }
}
