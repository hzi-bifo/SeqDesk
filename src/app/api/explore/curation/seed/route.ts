import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { applyCurationSeed, listCurationLists } from "@/lib/explore/curation";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession, requireString } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const targetKey = requireString(body.targetKey, "targetKey");
    const seedId = requireString(body.seedId, "seedId", 64);
    await requireTargetAccess(session, targetKey, "write");
    let count: number;
    try {
      count = await applyCurationSeed(targetKey, seedId);
    } catch (error) {
      throw new ExploreRouteError(400, error instanceof Error && /Invalid seed id/.test(error.message) ? error.message : "Seed not found");
    }
    return NextResponse.json({ applied: count, lists: await listCurationLists(targetKey) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
