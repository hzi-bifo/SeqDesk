import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireFacilityAdminSequencingReadSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; streamRunId: string }> }
) {
  try {
    await requireFacilityAdminSequencingReadSession();
    const { id, streamRunId } = await params;

    const run = await db.streamRun.findUnique({
      where: { id: streamRunId },
      select: { id: true, orderId: true },
    });
    if (!run || run.orderId !== id) {
      return NextResponse.json({ error: "Stream run not found" }, { status: 404 });
    }

    const afterParam = request.nextUrl.searchParams.get("after");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 100), 500);
    const afterSeq = afterParam !== null ? Number(afterParam) : NaN;

    const events = await db.streamRunEvent.findMany({
      where: {
        streamRunId,
        ...(Number.isFinite(afterSeq) ? { seq: { gt: afterSeq } } : {}),
      },
      orderBy: { seq: "desc" },
      take: limit,
    });

    // Newest first for display; expose the highest seq we returned so the client can resume.
    const nextCursor = events.length > 0 ? events[0].seq : (Number.isFinite(afterSeq) ? afterSeq : 0);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        seq: e.seq,
        ts: e.ts.toISOString(),
        kind: e.kind,
        payload: e.payload ? safeParse(e.payload) : null,
      })),
      cursor: nextCursor,
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[stream events] error", error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
