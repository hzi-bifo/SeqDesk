import { NextRequest, NextResponse } from "next/server";
import { createRevision, getAnalysisDetail } from "@/lib/explore/analyses";
import { parseBindings } from "../../route";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleAnalysis, optionalString, readJsonBody, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_CODE_BYTES = 512 * 1024;

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleAnalysis(session, id, "read");
    const analysis = await getAnalysisDetail(id);
    if (!analysis) throw new ExploreRouteError(404, "Not found");
    return NextResponse.json({ revisions: analysis.revisions });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

/** Every change to code, parameters or inputs is a new revision; nothing is edited in place. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const analysis = await loadAccessibleAnalysis(session, id, "write");
    const body = await readJsonBody(request);
    const code = typeof body.code === "string" ? body.code : undefined;
    if (code !== undefined && Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
      throw new ExploreRouteError(400, "The code is larger than 512 KB");
    }
    const inputs = body.inputs === undefined ? undefined : await parseBindings(body.inputs, analysis.targetKey);
    const revision = await createRevision({
      analysisId: id,
      code,
      params: body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined,
      inputs,
      author: "user",
      authorUserId: session.user.id,
      message: optionalString(body.message, 500),
    });
    return NextResponse.json({ revision }, { status: 201 });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
