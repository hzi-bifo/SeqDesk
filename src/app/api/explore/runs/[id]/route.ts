import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serializeRun } from "@/lib/explore/analyses";
import { readRunIsolation } from "@/lib/explore/sandbox/prepare";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleRun, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    await loadAccessibleRun(session, id, "read");
    const run = await db.exploreAnalysisRun.findUnique({
      where: { id },
      include: {
        revision: { select: { number: true, code: true, params: true, inputs: true } },
        artifacts: { orderBy: { createdAt: "asc" } },
        analysis: { select: { id: true, name: true, targetKey: true, language: true } },
        _count: { select: { artifacts: true } },
      },
    });
    if (!run) throw new ExploreRouteError(404, "Not found");
    let results: unknown = null;
    try {
      results = run.results ? JSON.parse(run.results) : null;
    } catch {
      results = null;
    }
    const isolation = await readRunIsolation(run.runFolder);
    return NextResponse.json({
      run: {
        ...serializeRun(run),
        analysis: run.analysis,
        results,
        isolation,
        outputTail: run.outputTail,
        errorTail: run.errorTail,
        runFolder: run.runFolder,
        code: run.revision.code,
        artifacts: run.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          format: artifact.format,
          name: artifact.name,
          fileName: artifact.path.split("/").pop(),
          size: artifact.size === null ? null : Number(artifact.size),
          derivedDatasetId: artifact.derivedDatasetId,
          url: `/api/explore/runs/${run.id}/artifacts/${artifact.id}`,
        })),
      },
    });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
