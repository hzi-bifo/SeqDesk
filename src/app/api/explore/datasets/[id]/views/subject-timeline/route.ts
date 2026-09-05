import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { listCurationForViews } from "@/lib/explore/curation";
import { computeDatasetCacheToken, fetchAllDatasetRows, getDatasetRecord } from "@/lib/explore/datasets";
import { applyEditsToRows, listActiveEdits } from "@/lib/explore/edits";
import { parseRoles, parseSchema } from "@/lib/explore/schema";
import { adaptRowsForSubjectTimeline, curationFromLists } from "@/lib/explore/views/subject-timeline/adapter";
import { curatedMarks, subjectComposition, subjectHighlights, subjectsTable } from "@/lib/explore/views/subject-timeline/compute";
import type { SubjectTimelineRow } from "@/lib/explore/views/subject-timeline/types";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Adapted rows are cached per dataset cache token; any change in version,
// samples, edits or curation produces a new token and a fresh adaptation.
const rowCache = new Map<string, { token: string; rows: SubjectTimelineRow[]; dropped: { missingKeys: number; control: number; isolate: number }; groups: string[] }>();
const MAX_CACHE_ENTRIES = 20;

async function loadAdapted(datasetId: string, token: string) {
  const cached = rowCache.get(datasetId);
  if (cached && cached.token === token) return cached;
  const record = await getDatasetRecord(datasetId);
  if (!record) throw new ExploreRouteError(404, "Not found");
  const versionId = record.currentVersionId ?? record.versions[0]?.id ?? null;
  const version = versionId ? record.versions.find((entry) => entry.id === versionId) ?? null : null;
  const schema = parseSchema(version?.schema);
  const roles = parseRoles(record.roles);
  const edits = await listActiveEdits(datasetId);
  const rows = versionId ? applyEditsToRows(await fetchAllDatasetRows(versionId), edits) : [];
  const adapted = adaptRowsForSubjectTimeline(rows, roles, schema.columns.map((column) => column.key));
  if (adapted.missingRoles.length > 0) {
    throw new ExploreRouteError(400, `The dataset is missing the roles ${adapted.missingRoles.join(", ")} needed for the subject timeline`);
  }
  const groups = [...new Set(adapted.rows.map((row) => row.group))].sort();
  const entry = { token, rows: adapted.rows, dropped: adapted.dropped, groups };
  if (rowCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = rowCache.keys().next().value;
    if (oldest) rowCache.delete(oldest);
  }
  rowCache.set(datasetId, entry);
  return entry;
}

/**
 * The subject timeline view over a taxon-profile dataset.
 * `part=subjects` lists subjects with their sampling days; `part=composition`
 * needs `subject` and `group`; `part=highlights` needs `subject`.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, record.targetKey, "read");

    const token = await computeDatasetCacheToken(id);
    const adapted = await loadAdapted(id, token);
    const params = request.nextUrl.searchParams;
    const part = params.get("part") ?? "subjects";
    const primaryGroups = params.get("groups")?.split(",").map((value) => value.trim()).filter(Boolean);
    const options = { primaryGroups: primaryGroups?.length ? primaryGroups : adapted.groups.slice(0, 2) };

    if (part === "subjects") {
      return NextResponse.json({ cacheToken: token, groups: adapted.groups, dropped: adapted.dropped, ...subjectsTable(adapted.rows, options) });
    }
    const curation = curationFromLists(await listCurationForViews(record.targetKey));
    const subject = params.get("subject") ?? "";
    if (!subject) throw new ExploreRouteError(400, "subject is required");
    if (part === "composition") {
      const group = params.get("group") ?? options.primaryGroups[0] ?? "All";
      const composition = subjectComposition(adapted.rows, subject, group, curation, options);
      return NextResponse.json({ cacheToken: token, ...composition, curated: curatedMarks(composition.taxa, curation, group) });
    }
    if (part === "highlights") {
      return NextResponse.json({ cacheToken: token, ...subjectHighlights(adapted.rows, subject, curation, options) });
    }
    throw new ExploreRouteError(400, "Unknown part");
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
