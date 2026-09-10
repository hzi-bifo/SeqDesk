import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { appendReportGeneration, requireGenerationReport, startReportGeneration } from "@/lib/explore/report-generation-service";
import { ExploreReportError } from "@/lib/explore/reports";
import { ExploreRunError } from "@/lib/explore/runner";
import { exploreErrorResponse, readJsonBody, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; analysisId: string }> }) {
  try {
    const session = await requireExploreSession();
    const { id, analysisId } = await context.params;
    const report = await requireGenerationReport(id);
    await requireTargetAccess(session, report.targetKey, "write");
    const body = await readJsonBody(request);
    if (body.action === "start") return NextResponse.json(await startReportGeneration(id, analysisId, session.user.id));
    if (body.action !== "add") throw new ExploreReportError(400, "Unknown generation action.");
    return NextResponse.json(await appendReportGeneration(id, analysisId, { expectedUpdatedAt: body.expectedUpdatedAt, itemIds: body.itemIds }));
  } catch (error) {
    if (error instanceof ExploreReportError || error instanceof ExploreRunError) return NextResponse.json({ error: error.message }, { status: error.status });
    return exploreErrorResponse(error);
  }
}
