import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { listCurationForViews } from "@/lib/explore/curation";
import { computeDatasetCacheToken, fetchAllDatasetRows, getDatasetRecord } from "@/lib/explore/datasets";
import { applyEditsToRows, listActiveEdits } from "@/lib/explore/edits";
import { parseRoles, parseSchema } from "@/lib/explore/schema";
import { computeHeatmap } from "@/lib/explore/views/heatmap/compute";
import { adaptRowsForSubjectTimeline, curationFromLists } from "@/lib/explore/views/subject-timeline/adapter";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Taxa-by-samples heatmap over a taxon-profile dataset; same row contract as the subject timeline. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, record.targetKey, "read");

    const versionId = record.currentVersionId ?? record.versions[0]?.id ?? null;
    const version = versionId ? record.versions.find((entry) => entry.id === versionId) ?? null : null;
    const schema = parseSchema(version?.schema);
    const roles = parseRoles(record.roles);
    const edits = await listActiveEdits(id);
    const rows = versionId ? applyEditsToRows(await fetchAllDatasetRows(versionId), edits) : [];
    const adapted = adaptRowsForSubjectTimeline(rows, roles, schema.columns.map((column) => column.key));
    if (adapted.missingRoles.length > 0) {
      throw new ExploreRouteError(400, `The dataset is missing the roles ${adapted.missingRoles.join(", ")} needed for the heatmap`);
    }
    const curation = curationFromLists(await listCurationForViews(record.targetKey));
    const params = request.nextUrl.searchParams;
    const valueParam = params.get("value");
    const payload = computeHeatmap(adapted.rows, {
      group: params.get("group") || null,
      nTaxa: Number.parseInt(params.get("n") ?? "35", 10) || 35,
      value: valueParam === "ra" || valueParam === "reads" ? valueParam : "log10_ra",
      order: params.get("order") === "abundance" ? "abundance" : "prevalence",
      artifacts: curation.artifacts,
      memberships: curation.memberships,
    });
    const groups = [...new Set(adapted.rows.map((row) => row.group))].sort();
    return NextResponse.json({ cacheToken: await computeDatasetCacheToken(id), groups, ...payload });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
