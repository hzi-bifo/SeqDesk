import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { createReportGeneration, listReportGenerations, requireGenerationReport } from "@/lib/explore/report-generation-service";
import { ExploreReportError } from "@/lib/explore/reports";
import { ExploreRunError } from "@/lib/explore/runner";
import { exploreErrorResponse, readJsonBody, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function errorResponse(error: unknown) {
  return error instanceof ExploreReportError || error instanceof ExploreRunError ? NextResponse.json({ error: error.message }, { status: error.status }) : exploreErrorResponse(error);
}
export async function GET(_request: NextRequest, context: Context) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const report = await requireGenerationReport(id);
    await requireTargetAccess(session, report.targetKey, "read");
    return NextResponse.json({ generations: await listReportGenerations(id), updatedAt: report.updatedAt.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const report = await requireGenerationReport(id);
    await requireTargetAccess(session, report.targetKey, "write");
    return NextResponse.json(await createReportGeneration(id, session.user.id, await readJsonBody(request)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
