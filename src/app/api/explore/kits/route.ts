import { NextResponse } from "next/server";
import { loadKits, serializeKit } from "@/lib/explore/kits/loader";
import { exploreErrorResponse, requireExploreSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireExploreSession();
    const { kits, problems } = await loadKits();
    return NextResponse.json({ kits: kits.map(serializeKit), problems });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
