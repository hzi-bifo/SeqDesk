import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { createAnalysis, listAnalyses } from "@/lib/explore/analyses";
import { ExploreRouteError, exploreErrorResponse, optionalString, parseBindings, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    return NextResponse.json({ analyses: await listAnalyses(targetKey, request.nextUrl.searchParams.get("reportId") || null) });
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
    const language = body.language === "r" ? "r" : "python";
    const analysis = await createAnalysis({
      targetKey,
      name: optionalString(body.name, 200),
      description: optionalString(body.description),
      kitId: optionalString(body.kitId, 80),
      reportId: optionalString(body.reportId, 80),
      language,
      environmentName: optionalString(body.environmentName, 120),
      inputs: await parseBindings(body.inputs, targetKey),
      params: body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined,
      createdById: session.user.id,
    });
    return NextResponse.json({ analysis }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && !(error instanceof ExploreRouteError) && /Unknown kit/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
