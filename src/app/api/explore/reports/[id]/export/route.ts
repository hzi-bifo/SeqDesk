import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { activeFiltersFromSearchParams, PLOTLY_CDN_URL, renderReportHtml } from "@/lib/explore/report-export";
import { ExploreReportError, getReportRecord } from "@/lib/explore/reports";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The report as one HTML file: the page with its live data, Plotly inlined so
 * the file works offline (`?plotly=cdn` references the library instead).
 * `f.<filterId>=value` applies page filters, as the page shows them.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getReportRecord(id);
    if (!record) throw new ExploreRouteError(404, "Report not found");
    await requireTargetAccess(session, record.targetKey, "read");
    const params = request.nextUrl.searchParams;
    const { html, title } = await renderReportHtml(record.id, {
      active: activeFiltersFromSearchParams(params),
      plotly: params.get("plotly") === "cdn" ? { src: PLOTLY_CDN_URL } : "inline",
    });
    const fileName = `${title.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report"}.html`;
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExploreReportError) return NextResponse.json({ error: error.message }, { status: error.status });
    return exploreErrorResponse(error);
  }
}
