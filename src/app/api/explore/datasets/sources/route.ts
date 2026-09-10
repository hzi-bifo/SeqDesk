import { NextRequest, NextResponse } from "next/server";
import { exploreBuildContext, requireTargetAccess } from "@/lib/explore/authorization";
import { listPipelineOutputs } from "@/lib/explore/pipeline-outputs";
import { withPipelineOutputUsage } from "@/lib/explore/pipeline-output-usage";
import { db } from "@/lib/db";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sources a dataset can be built from in a scope: currently pipeline table outputs. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    const target = await requireTargetAccess(session, targetKey, "read");
    const context = exploreBuildContext(session, target, targetKey);
    const reportId = request.nextUrl.searchParams.get("reportId");
    const report = reportId ? await db.exploreReport.findFirst({ where: { id: reportId, targetKey }, select: { blocks: true } }) : null;
    if (reportId && !report) throw new ExploreRouteError(404, "Report not found in this scope.");
    const [available, datasets] = await Promise.all([
      listPipelineOutputs(context),
      db.exploreDataset.findMany({ where: { targetKey, kind: "pipeline-table" }, select: { id: true, sourceConfig: true, currentVersionId: true, versions: { orderBy: { number: "desc" }, take: 1, select: { id: true, rowCount: true, provenance: true } } } }),
    ]);
    const outputs = withPipelineOutputUsage(available, datasets, report?.blocks ?? []);
    const pipelineTables = outputs.flatMap(output => output.table ? [output.table] : []);
    return NextResponse.json({ pipelineTables, outputs });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
