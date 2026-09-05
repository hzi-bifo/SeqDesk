import { NextRequest, NextResponse } from "next/server";
import { listExploreScopes, requireTargetAccess } from "@/lib/explore/authorization";
import { ExploreReportError, getReportView, resetReport, saveReport } from "@/lib/explore/reports";
import { exploreErrorResponse, readJsonBody, requireExploreSession } from "../_shared";
import type { Session } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function scopeLabel(session: Session, targetKey: string): Promise<string> {
  const scopes = await listExploreScopes(session);
  return scopes.find((scope) => scope.targetKey === targetKey)?.label ?? "Report";
}

function reportError(error: unknown): NextResponse {
  if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
  return exploreErrorResponse(error);
}

/** The report of one scope: saved blocks, or a draft assembled from all outputs. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    return NextResponse.json({ report: await getReportView(targetKey, await scopeLabel(session, targetKey)) });
  } catch (error) {
    return reportError(error);
  }
}

/** Save the report: title and ordered blocks. */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "write");
    const body = await readJsonBody(request);
    return NextResponse.json({ report: await saveReport(targetKey, body, session.user.id, await scopeLabel(session, targetKey)) });
  } catch (error) {
    return reportError(error);
  }
}

/** Forget the saved report and start again from the outputs. */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "write");
    return NextResponse.json({ report: await resetReport(targetKey, await scopeLabel(session, targetKey)) });
  } catch (error) {
    return reportError(error);
  }
}
