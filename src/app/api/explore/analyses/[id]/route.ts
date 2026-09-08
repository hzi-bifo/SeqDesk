import { NextRequest, NextResponse } from "next/server";
import { deleteAnalysis, getAnalysisDetail, updateAnalysis } from "@/lib/explore/analyses";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleAnalysis, optionalString, readJsonBody, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "read");
    const analysis = await getAnalysisDetail(id);
    if (!analysis) throw new ExploreRouteError(404, "Not found");
    return NextResponse.json({ analysis });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "write");
    const body = await readJsonBody(request);
    const data: { name?: string; description?: string | null; environmentName?: string } = {};
    const name = optionalString(body.name, 200);
    if (name) data.name = name;
    if ("description" in body) data.description = optionalString(body.description);
    const environmentName = optionalString(body.environmentName, 120);
    if (environmentName) data.environmentName = environmentName;
    await updateAnalysis(id, data);
    return NextResponse.json({ analysis: await getAnalysisDetail(id) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "write");
    await deleteAnalysis(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
