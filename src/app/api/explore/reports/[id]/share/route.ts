import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { ExploreReportError, getReportRecord, shareReport, unshareReport } from "@/lib/explore/reports";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../_shared";
import type { Session } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadWritable(session: Session, id: string) {
  const record = await getReportRecord(id);
  if (!record) throw new ExploreRouteError(404, "Report not found");
  await requireTargetAccess(session, record.targetKey, "write");
  return record;
}

function reportError(error: unknown): NextResponse {
  if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
  return exploreErrorResponse(error);
}

/** Issue a share link: anyone with it reads the live page without signing in. A second call replaces the token. */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadWritable(session, id);
    return NextResponse.json({ share: await shareReport(record.id) }, { status: 201 });
  } catch (error) {
    return reportError(error);
  }
}

/** Withdraw the share link. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadWritable(session, id);
    await unshareReport(record.id);
    return NextResponse.json({ share: null });
  } catch (error) {
    return reportError(error);
  }
}
