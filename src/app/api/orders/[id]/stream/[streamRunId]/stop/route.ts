import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; streamRunId: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id, streamRunId } = await params;

    const existing = await db.streamRun.findUnique({
      where: { id: streamRunId },
      select: { id: true, orderId: true, status: true },
    });
    if (!existing || existing.orderId !== id) {
      return NextResponse.json({ error: "Stream run not found" }, { status: 404 });
    }
    if (existing.status === "STOPPED") {
      return NextResponse.json({ ok: true, alreadyStopped: true });
    }
    if (existing.status === "STOPPING") {
      return NextResponse.json({ ok: true, alreadyStopping: true });
    }

    // Soft-stop: set STOPPING and emit a request event. The stream-monitor daemon
    // sees this on its next tick, closes the chokidar watcher, then writes
    // status=STOPPED + stoppedAt. The API never touches the watcher directly —
    // it would be a different process anyway.
    await db.streamRun.update({
      where: { id: streamRunId },
      data: { status: "STOPPING" },
    });

    await db.streamRunEvent.create({
      data: {
        streamRunId,
        kind: "RUN_STOP_REQUESTED",
        payload: JSON.stringify({ stoppedBy: "user" }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[stream stop] error", error);
    return NextResponse.json({ error: "Failed to stop stream" }, { status: 500 });
  }
}
