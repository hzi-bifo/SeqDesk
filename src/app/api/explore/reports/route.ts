import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { createReport, ExploreReportError, listReports } from "@/lib/explore/reports";
import { exploreErrorResponse, optionalString, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reportError(error: unknown): NextResponse {
  if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
  return exploreErrorResponse(error);
}

/** The reports of one scope, oldest first. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    return NextResponse.json({ reports: await listReports(targetKey) });
  } catch (error) {
    return reportError(error);
  }
}

/** A new report in a scope; "Report N" unless a title is given. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const targetKey = requireString(body.targetKey, "targetKey");
    await requireTargetAccess(session, targetKey, "write");
    const report = await createReport(targetKey, session.user.id, optionalString(body.title, 200));
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return reportError(error);
  }
}
