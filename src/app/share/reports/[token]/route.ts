import { NextRequest, NextResponse } from "next/server";
import { isExploreModuleEnabled } from "@/lib/explore/module";
import { activeFiltersFromSearchParams, renderReportHtml } from "@/lib/explore/report-export";
import { findSharedReportId } from "@/lib/explore/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// A shared page reads every table it shows; anyone with the link can ask
// for it, so one rendering is served for a short while.
const PAGE_CACHE_MS = 30_000;
const PAGE_CACHE_MAX = 50;
const pageCache = new Map<string, { at: number; html: string }>();

/**
 * A shared report: the live page for anyone holding the link, no sign-in.
 * The page is rendered on the server and may only run its own inline
 * scripts and the Plotly library served next to it; nothing else loads.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!(await isExploreModuleEnabled())) return new NextResponse("Not found", { status: 404 });
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return new NextResponse("Not found", { status: 404 });
  const reportId = await findSharedReportId(token);
  if (!reportId) return new NextResponse("This link is not valid any more.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const cacheKey = `${reportId}?${request.nextUrl.searchParams.toString()}`;
    const cached = pageCache.get(cacheKey);
    let html: string;
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) {
      html = cached.html;
    } else {
      html = (await renderReportHtml(reportId, {
        active: activeFiltersFromSearchParams(request.nextUrl.searchParams),
        plotly: { src: "/share/assets/plotly.js" },
      })).html;
      if (pageCache.size >= PAGE_CACHE_MAX) {
        const oldest = pageCache.keys().next().value;
        if (oldest) pageCache.delete(oldest);
      }
      pageCache.set(cacheKey, { at: Date.now(), html });
    }
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    console.error("[explore] shared report failed", error);
    return new NextResponse("The report could not be rendered.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
