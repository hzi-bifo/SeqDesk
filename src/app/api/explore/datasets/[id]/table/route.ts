import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { fetchAllDatasetRows, getDatasetRecord } from "@/lib/explore/datasets";
import { parseSchema } from "@/lib/explore/schema";
import { exploreErrorResponse, ExploreRouteError, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Rows the report is willing to hold in the browser for one table. */
const DEFAULT_LIMIT = 100_000;
const MAX_LIMIT = 250_000;

/**
 * The whole table in one response, for blocks that filter and aggregate in
 * the browser. `columns` (comma separated keys) trims the payload; `limit`
 * caps the rows and `truncated` says when the cap was hit. Curation edits are
 * applied like everywhere else.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const dataset = await getDatasetRecord(id);
    if (!dataset) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, dataset.targetKey, "read");
    const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
    const schema = parseSchema(current?.schema);
    const requested = request.nextUrl.searchParams.get("columns");
    const wanted = requested ? new Set(requested.split(",").map((key) => key.trim()).filter(Boolean)) : null;
    const columns = schema.columns.filter((column) => !column.key.endsWith("_db_id") && (!wanted || wanted.has(column.key)));
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Math.min(MAX_LIMIT, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT);
    const records = current ? await fetchAllDatasetRows(current.id) : [];
    const keys = columns.map((column) => column.key);
    const rows = records.slice(0, limit).map((record) => {
      if (!wanted) return record.data;
      const picked: Record<string, (typeof record.data)[string]> = {};
      for (const key of keys) picked[key] = record.data[key];
      return picked;
    });
    return NextResponse.json({ datasetId: dataset.id, version: current?.number ?? null, columns, rows, total: records.length, truncated: records.length > limit });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
