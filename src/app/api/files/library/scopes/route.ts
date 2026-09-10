import { NextResponse } from "next/server";
import { listExploreScopes } from "@/lib/explore/authorization";
import { fileErrorResponse, requireFileSession } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ scopes: await listExploreScopes(await requireFileSession()) }); }
  catch (error) { return fileErrorResponse(error); }
}
