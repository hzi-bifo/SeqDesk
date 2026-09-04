import { NextRequest, NextResponse } from "next/server";
import { isFacilityAdminSession, requireTargetAccess } from "@/lib/explore/authorization";
import { listPipelineTableSources } from "@/lib/explore/builders/pipeline-table";
import { exploreErrorResponse, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sources a dataset can be built from in a scope: currently pipeline table outputs. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    const target = await requireTargetAccess(session, targetKey, "read");
    const pipelineTables = await listPipelineTableSources({
      target,
      targetKey,
      isFacilityAdmin: isFacilityAdminSession(session),
    });
    return NextResponse.json({ pipelineTables });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
