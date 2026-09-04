import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { computeDatasetCacheToken, fetchDatasetRows, getDatasetRecord } from "@/lib/explore/datasets";
import { applyEditsToRows, listActiveEdits } from "@/lib/explore/edits";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A page of rows of the dataset's current version with curation edits applied.
 * `cursor` is the last rowIndex of the previous page; `limit` caps at 2000.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, record.targetKey, "read");

    const versionId = record.currentVersionId ?? record.versions[0]?.id ?? null;
    const params = request.nextUrl.searchParams;
    const limit = Number.parseInt(params.get("limit") ?? "", 10);
    const [page, edits, cacheToken] = await Promise.all([
      versionId
        ? fetchDatasetRows(versionId, {
            cursor: params.get("cursor"),
            limit: Number.isFinite(limit) ? limit : undefined,
            sampleId: params.get("sampleId"),
            subjectId: params.get("subjectId"),
            key: params.get("key"),
          })
        : Promise.resolve({ rows: [], nextCursor: null, total: 0 }),
      listActiveEdits(id),
      computeDatasetCacheToken(id),
    ]);

    const includeExcluded = params.get("includeExcluded") === "1";
    const rows = applyEditsToRows(page.rows, edits, { includeExcluded });
    return NextResponse.json({ rows, nextCursor: page.nextCursor, total: page.total, cacheToken });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
