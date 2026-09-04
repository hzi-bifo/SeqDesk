import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { createAnalysis, listAnalyses, type AnalysisInputBinding } from "@/lib/explore/analyses";
import { getDatasetRecord } from "@/lib/explore/datasets";
import { ExploreRouteError, exploreErrorResponse, optionalString, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    return NextResponse.json({ analyses: await listAnalyses(targetKey) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function parseBindings(raw: unknown, targetKey: string): Promise<AnalysisInputBinding[]> {
  if (!Array.isArray(raw)) return [];
  const bindings: AnalysisInputBinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const alias = typeof (entry as { alias?: unknown }).alias === "string" ? (entry as { alias: string }).alias.trim() : "";
    const datasetId = typeof (entry as { datasetId?: unknown }).datasetId === "string" ? (entry as { datasetId: string }).datasetId : "";
    const versionId = typeof (entry as { versionId?: unknown }).versionId === "string" ? (entry as { versionId: string }).versionId : null;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(alias) || !datasetId) throw new ExploreRouteError(400, "Each input needs an alias and a datasetId");
    const dataset = await getDatasetRecord(datasetId);
    if (!dataset || dataset.targetKey !== targetKey) throw new ExploreRouteError(400, `Dataset for input ${alias} does not belong to this scope`);
    bindings.push({ alias, datasetId, versionId });
  }
  return bindings;
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
