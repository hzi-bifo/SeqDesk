import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/explore/analyses";
import { createAndStartRun, ExploreRunError } from "@/lib/explore/runner";
import { exploreErrorResponse, loadAccessibleAnalysis, optionalString, readJsonBody, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "read");
    return NextResponse.json({ runs: await listRuns(id) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "write");
    const body = await readJsonBody(request);
    const mode = body.executionMode === "local" || body.executionMode === "slurm" ? body.executionMode : "default";
    const run = await createAndStartRun({
      analysisId: id,
      revisionId: optionalString(body.revisionId, 80),
      executionMode: mode,
      createdById: session.user.id,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof ExploreRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return exploreErrorResponse(error);
  }
}
