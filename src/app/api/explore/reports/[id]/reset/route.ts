import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { ExploreReportError, getReportRecord, resetReport } from "@/lib/explore/reports";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Forget the saved page and start again from the outputs; the analysis steps stay. */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getReportRecord(id);
    if (!record) throw new ExploreRouteError(404, "Report not found");
    await requireTargetAccess(session, record.targetKey, "write");
    return NextResponse.json({ report: await resetReport(record.id) });
  } catch (error) {
    if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
    return exploreErrorResponse(error);
  }
}
