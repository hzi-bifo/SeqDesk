import { NextResponse } from "next/server";
import { PLOTLY_CDN_URL, readPlotlyBundle } from "@/lib/explore/report-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Plotly library for shared report pages, served from the app so the page needs no third party. */
export async function GET() {
  const bundle = await readPlotlyBundle();
  if (!bundle) return NextResponse.redirect(PLOTLY_CDN_URL, 302);
  return new NextResponse(bundle, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
