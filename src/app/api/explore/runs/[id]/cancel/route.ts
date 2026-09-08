import { NextRequest, NextResponse } from "next/server";
import { cancelRun } from "@/lib/explore/runner";
import { exploreErrorResponse, loadAccessibleRun, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleRun(session, id, "write");
    const cancelled = await cancelRun(id);
    return NextResponse.json({ cancelled }, { status: cancelled ? 200 : 409 });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
