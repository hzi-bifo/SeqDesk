import { NextRequest, NextResponse } from "next/server";
import { isFacilityAdminSession, requireTargetAccess } from "@/lib/explore/authorization";
import { buildDataset, type BuildableKind } from "@/lib/explore/build";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession, requireString } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILDABLE: BuildableKind[] = ["samples", "sequencing", "pipeline-table"];

export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const targetKey = requireString(body.targetKey, "targetKey");
    const target = await requireTargetAccess(session, targetKey, "write");
    const kind = body.kind;
    if (!BUILDABLE.includes(kind as BuildableKind)) {
      throw new ExploreRouteError(400, "This dataset kind cannot be built from a source");
    }
    const result = await buildDataset({
      context: { target, targetKey, isFacilityAdmin: isFacilityAdminSession(session) },
      kind: kind as BuildableKind,
      options: body.options && typeof body.options === "object" ? (body.options as Record<string, unknown>) : {},
      createdById: session.user.id,
    });
    if (!result) {
      throw new ExploreRouteError(404, "Nothing to build: the scope has no data for this dataset kind");
    }
    return NextResponse.json(result, { status: result.version.unchanged ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && !(error instanceof ExploreRouteError) && /required|not declared/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
