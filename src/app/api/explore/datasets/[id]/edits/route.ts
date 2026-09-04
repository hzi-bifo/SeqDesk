import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { getDatasetRecord } from "@/lib/explore/datasets";
import { createEdit, EXPLORE_EDIT_KINDS, listAllEdits, validateEdit } from "@/lib/explore/edits";
import type { ExploreEditKind, ExploreEditTarget } from "@/lib/explore/types";
import { ExploreRouteError, exploreErrorResponse, optionalString, readJsonBody, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, record.targetKey, "read");
    return NextResponse.json({ edits: await listAllEdits(id) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const record = await getDatasetRecord(id);
    if (!record) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, record.targetKey, "write");

    const body = await readJsonBody(request);
    const kind = body.kind as ExploreEditKind;
    if (!EXPLORE_EDIT_KINDS.includes(kind)) throw new ExploreRouteError(400, "Unknown edit kind");
    const rawTarget = body.target && typeof body.target === "object" ? (body.target as Record<string, unknown>) : {};
    const target: ExploreEditTarget = {
      rowKey: typeof rawTarget.rowKey === "string" ? rawTarget.rowKey.slice(0, 500) : undefined,
      column: typeof rawTarget.column === "string" ? rawTarget.column.slice(0, 120) : undefined,
    };
    const problem = validateEdit({ kind, target, value: body.value });
    if (problem) throw new ExploreRouteError(400, problem);
    const edit = await createEdit({
      datasetId: id,
      kind,
      target,
      value: body.value,
      reason: optionalString(body.reason, 1000),
      createdById: session.user.id,
    });
    return NextResponse.json({ edit }, { status: 201 });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
