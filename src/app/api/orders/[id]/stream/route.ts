import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireFacilityAdminSequencingReadSession,
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import { loadMinknowConfig } from "@/lib/minknow/config";
import { validateOutputDirUnderRoot } from "@/lib/minknow/security";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingReadSession();
    const { id } = await params;

    const runs = await db.streamRun.findMany({
      where: { orderId: id },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        events: {
          orderBy: { ts: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        minknowRunId: r.minknowRunId,
        flowCellId: r.flowCellId,
        deviceId: r.deviceId,
        outputDir: r.outputDir,
        status: r.status,
        totalBases: r.totalBases.toString(),
        totalReads: r.totalReads,
        barcodeMap: r.barcodeMap ? safeParse(r.barcodeMap) : {},
        startedAt: r.startedAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        stoppedAt: r.stoppedAt ? r.stoppedAt.toISOString() : null,
        latestEvent: r.events[0]
          ? {
              kind: r.events[0].kind,
              ts: r.events[0].ts.toISOString(),
              payload: r.events[0].payload ? safeParse(r.events[0].payload) : null,
            }
          : null,
      })),
    });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[stream] GET error", error);
    return NextResponse.json({ error: "Failed to load stream runs" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const body = await request.json();

    const outputDir = typeof body?.outputDir === "string" ? body.outputDir.trim() : "";
    if (!outputDir) {
      return NextResponse.json({ error: "outputDir is required" }, { status: 400 });
    }

    const config = await loadMinknowConfig();
    const validation = await validateOutputDirUnderRoot(outputDir, config.outputRoot);
    if (!validation.ok || !validation.realpath) {
      return NextResponse.json({ error: validation.reason ?? "Invalid outputDir" }, { status: 400 });
    }
    const resolvedOutputDir = validation.realpath;

    // No two ACTIVE streams may share the same physical directory — otherwise both
    // monitors would race on the same files and we'd see double-ingest.
    const conflicting = await db.streamRun.findFirst({
      where: { status: "ACTIVE", outputDir: resolvedOutputDir },
      select: { id: true, orderId: true },
    });
    if (conflicting) {
      return NextResponse.json(
        {
          error: `Another active stream (id=${conflicting.id}, order=${conflicting.orderId}) is already watching ${resolvedOutputDir}. Stop it first.`,
        },
        { status: 409 },
      );
    }

    const barcodeMapInput = body?.barcodeMap;
    const barcodeMap: Record<string, string> = {};
    if (barcodeMapInput && typeof barcodeMapInput === "object") {
      for (const [k, v] of Object.entries(barcodeMapInput)) {
        if (typeof v === "string" && v.length > 0) barcodeMap[k.toLowerCase()] = v;
      }
    }

    const run = await db.streamRun.create({
      data: {
        orderId: id,
        outputDir: resolvedOutputDir,
        deviceId: typeof body?.deviceId === "string" ? body.deviceId : null,
        flowCellId: typeof body?.flowCellId === "string" ? body.flowCellId : null,
        minknowRunId: typeof body?.minknowRunId === "string" ? body.minknowRunId : null,
        barcodeMap: JSON.stringify(barcodeMap),
        status: "ACTIVE",
      },
    });

    await db.streamRunEvent.create({
      data: {
        streamRunId: run.id,
        kind: "RUN_STARTED",
        payload: JSON.stringify({ outputDir: resolvedOutputDir, barcodeMap }),
      },
    });

    return NextResponse.json({ id: run.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[stream] POST error", error);
    return NextResponse.json({ error: "Failed to start stream" }, { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
