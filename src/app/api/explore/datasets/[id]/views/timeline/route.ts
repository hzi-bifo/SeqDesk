import { NextRequest, NextResponse } from "next/server";
import { computeDatasetCacheToken, fetchAllDatasetRows, getDatasetRecord } from "@/lib/explore/datasets";
import { applyEditsToRows, listActiveEdits } from "@/lib/explore/edits";
import { parseRoles, parseSchema } from "@/lib/explore/schema";
import { buildTimeline, detectTimeAxis, parseMeasure, type TimelineSeries } from "@/lib/explore/time-axis";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleDataset, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// One series per dataset, measure and cache token; the token changes with
// every version, edit or curation change.
const seriesCache = new Map<string, { token: string; series: TimelineSeries }>();
const MAX_CACHE_ENTRIES = 40;

/**
 * A measure of the table along its time axis, bucketed for a sparkline:
 * `measure=distinct:<column>|sum:<column>|count`. The axis is the table's
 * date or study-day column, found from its roles, types and names.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleDataset(session, id, "read");
    const measure = parseMeasure(request.nextUrl.searchParams.get("measure"));
    if (!measure) throw new ExploreRouteError(400, "measure must be distinct:<column>, sum:<column> or count");

    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    const versionId = record.currentVersionId ?? record.versions[0]?.id ?? null;
    const version = versionId ? record.versions.find((entry) => entry.id === versionId) ?? null : null;
    const schema = parseSchema(version?.schema);
    const roles = parseRoles(record.roles);
    const axis = detectTimeAxis(schema.columns, roles);
    if (!axis) return NextResponse.json({ axis: null, series: null });
    if (measure.kind !== "count" && !schema.columns.some((column) => column.key === measure.column)) throw new ExploreRouteError(400, `No column called ${measure.column}`);

    const token = await computeDatasetCacheToken(id);
    const cacheKey = `${id}:${request.nextUrl.searchParams.get("measure")}`;
    const cached = seriesCache.get(cacheKey);
    if (cached && cached.token === token) return NextResponse.json({ axis, series: cached.series, cacheToken: token });

    const edits = await listActiveEdits(id);
    const rows = versionId ? applyEditsToRows(await fetchAllDatasetRows(versionId), edits) : [];
    const series = buildTimeline(rows.map((row) => row.data), axis, measure);
    if (seriesCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = seriesCache.keys().next().value;
      if (oldest) seriesCache.delete(oldest);
    }
    seriesCache.set(cacheKey, { token, series });
    return NextResponse.json({ axis, series, cacheToken: token });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
