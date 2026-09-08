import { NextResponse } from "next/server";
import { listExploreScopes } from "@/lib/explore/authorization";
import { exploreErrorResponse, requireExploreSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireExploreSession();
    const scopes = await listExploreScopes(session);
    return NextResponse.json({ scopes });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
