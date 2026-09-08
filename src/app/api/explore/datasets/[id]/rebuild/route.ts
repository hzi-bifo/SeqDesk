import { NextRequest, NextResponse } from "next/server";
import { isFacilityAdminSession, requireTargetAccess } from "@/lib/explore/authorization";
import { rebuildDataset } from "@/lib/explore/build";
import { getDatasetRecord } from "@/lib/explore/datasets";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    const target = await requireTargetAccess(session, record.targetKey, "write");
    const result = await rebuildDataset(
      id,
      { target, targetKey: record.targetKey, isFacilityAdmin: isFacilityAdminSession(session) },
      session.user.id
    );
    if (!result) throw new ExploreRouteError(404, "Nothing to rebuild: the source has no data any more");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && !(error instanceof ExploreRouteError) && /cannot be rebuilt/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
