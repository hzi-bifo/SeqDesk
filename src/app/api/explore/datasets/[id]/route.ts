import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { deleteDataset, getDatasetDetail, getDatasetRecord, updateDatasetRoles } from "@/lib/explore/datasets";
import { EXPLORE_ROLES, type ExploreRole, type ExploreRoleMap } from "@/lib/explore/types";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function loadAccessibleDataset(session: Awaited<ReturnType<typeof requireExploreSession>>, id: string, level: "read" | "write") {
  const record = await getDatasetRecord(id);
  if (!record) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, record.targetKey, level);
  return record;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleDataset(session, id, "read");
    const dataset = await getDatasetDetail(id);
    if (!dataset) throw new ExploreRouteError(404, "Not found");
    return NextResponse.json({ dataset });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleDataset(session, id, "write");
    const body = await readJsonBody(request);
    if (!body.roles || typeof body.roles !== "object") {
      throw new ExploreRouteError(400, "roles is required");
    }
    const roles: ExploreRoleMap = {};
    for (const [role, column] of Object.entries(body.roles as Record<string, unknown>)) {
      if (!EXPLORE_ROLES.includes(role as ExploreRole)) {
        throw new ExploreRouteError(400, `Unknown role: ${role}`);
      }
      if (typeof column === "string" && column.trim()) {
        roles[role as ExploreRole] = column.trim().slice(0, 120);
      }
    }
    await updateDatasetRoles(id, roles);
    const dataset = await getDatasetDetail(id);
    return NextResponse.json({ dataset });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleDataset(session, id, "write");
    await deleteDataset(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
