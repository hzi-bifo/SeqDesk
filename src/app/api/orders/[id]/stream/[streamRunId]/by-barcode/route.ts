import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireFacilityAdminSequencingReadSession,
  SequencingApiError,
} from "@/lib/sequencing/server";

interface BarcodeRow {
  barcode: string;
  fileCount: number;
  totalSize: number;
  totalReads: number;
  totalBases: number;
  lastFileAt: string | null;
  lastFilePath: string | null;
}

export async function GET(
  _request: Request,
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

    // Pull all FILE_INGESTED events for this run. For very long runs we may want
    // to push this aggregation into SQL, but at typical sequencing-run scale
    // (low thousands of files) this is fast enough and avoids a JSON-path query.
    const events = await db.streamRunEvent.findMany({
      where: { streamRunId, kind: "FILE_INGESTED" },
      orderBy: { ts: "asc" },
      select: { ts: true, payload: true },
    });

    const map = new Map<string, BarcodeRow>();
    for (const e of events) {
      if (!e.payload) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.payload);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const p = parsed as {
        barcode?: unknown;
        size?: unknown;
        reads?: unknown;
        bases?: unknown;
        filePath?: unknown;
      };
      const barcode = typeof p.barcode === "string" ? p.barcode : "(unknown)";
      const size = typeof p.size === "number" ? p.size : 0;
      const reads = typeof p.reads === "number" ? p.reads : 0;
      const bases = typeof p.bases === "number" ? p.bases : 0;
      const filePath = typeof p.filePath === "string" ? p.filePath : null;
      const existing = map.get(barcode);
      if (existing) {
        existing.fileCount += 1;
        existing.totalSize += size;
        existing.totalReads += reads;
        existing.totalBases += bases;
        existing.lastFileAt = e.ts.toISOString();
        existing.lastFilePath = filePath;
      } else {
        map.set(barcode, {
          barcode,
          fileCount: 1,
          totalSize: size,
          totalReads: reads,
          totalBases: bases,
          lastFileAt: e.ts.toISOString(),
          lastFilePath: filePath,
        });
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => a.barcode.localeCompare(b.barcode));

    return NextResponse.json({ barcodes: rows });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[stream by-barcode] error", error);
    return NextResponse.json({ error: "Failed to aggregate barcodes" }, { status: 500 });
  }
}
