import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { createDataset, listDatasets } from "@/lib/explore/datasets";
import { EXPLORE_DATASET_KINDS, EXPLORE_SENSITIVITIES, type ExploreDatasetKind, type ExploreSensitivity } from "@/lib/explore/types";
import {
  ExploreRouteError,
  exploreErrorResponse,
  optionalString,
  readJsonBody,
  requireExploreSession,
  requireString,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    const datasets = await listDatasets(targetKey);
    return NextResponse.json({ datasets });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const targetKey = requireString(body.targetKey, "targetKey");
    await requireTargetAccess(session, targetKey, "write");

    const kind = body.kind;
    if (!EXPLORE_DATASET_KINDS.includes(kind as ExploreDatasetKind)) {
      throw new ExploreRouteError(400, "Unknown dataset kind");
    }
    const sensitivity = body.sensitivity ?? "standard";
    if (!EXPLORE_SENSITIVITIES.includes(sensitivity as ExploreSensitivity)) {
      throw new ExploreRouteError(400, "Unknown sensitivity");
    }

    const dataset = await createDataset({
      targetKey,
      kind: kind as ExploreDatasetKind,
      tableKind: optionalString(body.tableKind, 80),
      name: requireString(body.name, "name"),
      description: optionalString(body.description),
      sensitivity: sensitivity as ExploreSensitivity,
      roles: body.roles && typeof body.roles === "object" ? (body.roles as Record<string, string>) : undefined,
      sourceConfig: body.sourceConfig && typeof body.sourceConfig === "object" ? (body.sourceConfig as Record<string, unknown>) : null,
      createdById: session.user.id,
    });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
