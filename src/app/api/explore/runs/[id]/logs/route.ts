import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { readTail } from "@/lib/pipelines/nextflow";
import { exploreErrorResponse, loadAccessibleRun, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Live tails for the run page; falls back to the stored tails after completion. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const run = await loadAccessibleRun(session, id, "read");
    const lines = Math.min(Math.max(Number.parseInt(request.nextUrl.searchParams.get("lines") ?? "200", 10) || 200, 20), 2000);
    const [outputTail, errorTail] = run.runFolder
      ? await Promise.all([
          readTail(path.join(run.runFolder, "logs", "pipeline.out"), lines),
          readTail(path.join(run.runFolder, "logs", "pipeline.err"), lines),
        ])
      : [null, null];
    return NextResponse.json({
      status: run.status,
      outputTail: outputTail ?? run.outputTail,
      errorTail: errorTail ?? run.errorTail,
    });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
