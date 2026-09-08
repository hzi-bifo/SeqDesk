import { NextRequest, NextResponse } from "next/server";
import { cascadeFromRun } from "@/lib/explore/run-cascade";
import { ExploreRunError } from "@/lib/explore/runner";
import { exploreErrorResponse, loadAccessibleRun, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Run the analyses downstream of a finished run whose output tables it changed. */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleRun(session, id, "write");
    return NextResponse.json(await cascadeFromRun(id, session.user.id));
  } catch (error) {
    if (error instanceof ExploreRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return exploreErrorResponse(error);
  }
}
