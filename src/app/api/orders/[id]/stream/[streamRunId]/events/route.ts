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
    const afterSeq = afterParam !== null ? Number(afterParam) : NaN;
    const hasCursor = Number.isFinite(afterSeq);

    // Validate `limit`: Number(...) can yield NaN (e.g. ?limit=abc) or a
    // negative, which would be passed straight to Prisma's `take`. Clamp to
    // [1, 500] with a default of 100.
    const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 100;

    const rows = await db.streamRunEvent.findMany({
      where: {
        streamRunId,
        ...(hasCursor ? { seq: { gt: afterSeq } } : {}),
      },
      // With a cursor we page forward OLDEST-first so a backlog larger than
      // `limit` is delivered incrementally over successive polls instead of
      // permanently skipping the middle: the client advances its cursor to the
      // highest seq it received, so the next poll continues from there. Without
      // a cursor we return the newest events (initial live-tail load).
      orderBy: { seq: hasCursor ? "asc" : "desc" },
      take: limit,
    });

    // Always present newest-first for display; expose the highest seq we
    // returned so the client can resume without dropping events.
    const events = hasCursor ? [...rows].reverse() : rows;
    const nextCursor = events.length > 0 ? events[0].seq : hasCursor ? afterSeq : 0;

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
