import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { loadCanvasGraph } from "@/lib/explore/canvas";
import { exploreErrorResponse, requireExploreSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nodes and edges of the Explore canvas for one scope. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    return NextResponse.json(await loadCanvasGraph(targetKey));
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
