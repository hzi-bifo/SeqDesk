import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { FileLibraryError, getLibraryFile, listLibraryFiles } from "@/lib/files/library";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession, requireString } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function accessibleReport(id: string, write = false) {
  const session = await requireExploreSession();
  if (write && session.user.isDemo) throw new ExploreRouteError(403, "Changes are disabled in the public demo.");
  const report = await db.exploreReport.findUnique({ where: { id }, select: { id: true, targetKey: true } });
  if (!report) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, report.targetKey, write ? "write" : "read");
  return report;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const report = await accessibleReport((await context.params).id);
    const files = await listLibraryFiles(report.targetKey);
    return NextResponse.json({ files: files.flatMap((file) => {
      const usage = file.reports.find((entry) => entry.id === report.id);
      return usage ? [{ ...file, attached: usage.attached, usedInReport: usage.usedInReport }] : [];
    }) });
  } catch (error) { return exploreErrorResponse(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const report = await accessibleReport((await context.params).id, true);
    const body = await readJsonBody(request);
    const file = await getLibraryFile(requireString(body.fileId, "fileId"));
    if (file.targetKey !== report.targetKey) throw new ExploreRouteError(400, "Choose a file from this report's study or order.");
    await db.exploreReportFile.upsert({
      where: { reportId_fileId: { reportId: report.id, fileId: file.id } },
      create: { reportId: report.id, fileId: file.id }, update: {},
    });
    return NextResponse.json({ linked: true });
  } catch (error) {
    if (error instanceof FileLibraryError) return NextResponse.json({ error: error.message }, { status: error.status });
    return exploreErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const report = await accessibleReport((await context.params).id, true);
    const fileId = requireString(request.nextUrl.searchParams.get("fileId"), "fileId");
    await db.exploreReportFile.deleteMany({ where: { reportId: report.id, fileId } });
    return NextResponse.json({ unlinked: true });
  } catch (error) { return exploreErrorResponse(error); }
}
