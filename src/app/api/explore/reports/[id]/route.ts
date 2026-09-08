import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { deleteReport, ExploreReportError, getReportRecord, getReportView, renameReport, saveReport } from "@/lib/explore/reports";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession, requireString } from "../../_shared";
import type { Session } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function reportError(error: unknown): NextResponse {
  if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
  return exploreErrorResponse(error);
}

/** The report, and the access check on the scope it belongs to. */
async function loadReport(session: Session, id: string, level: "read" | "write") {
  const record = await getReportRecord(id);
  if (!record) throw new ExploreRouteError(404, "Report not found");
  await requireTargetAccess(session, record.targetKey, level);
  return record;
}

/** The page of one report: saved blocks, or a draft assembled from its outputs. */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadReport(session, id, "read");
    return NextResponse.json({ report: await getReportView(record.id) });
  } catch (error) {
    return reportError(error);
  }
}

/** Save the page: title, ordered blocks and filters. */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadReport(session, id, "write");
    const body = await readJsonBody(request);
    return NextResponse.json({ report: await saveReport(record.id, body) });
  } catch (error) {
    return reportError(error);
  }
}

/** Rename the report. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadReport(session, id, "write");
    const body = await readJsonBody(request);
    return NextResponse.json({ report: await renameReport(record.id, requireString(body.title, "title", 200)) });
  } catch (error) {
    return reportError(error);
  }
}

/** Delete the report with its analysis steps and their runs; the scope's tables stay. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await loadReport(session, id, "write");
    await deleteReport(record.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return reportError(error);
  }
}
