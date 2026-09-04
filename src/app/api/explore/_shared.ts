import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ExploreAuthorizationError } from "@/lib/explore/authorization";
import { isExploreModuleEnabled } from "@/lib/explore/module";

export class ExploreRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Every Explore route starts here: the module must be enabled (otherwise the
 * whole section answers 404, like it does not exist) and the caller must be
 * signed in.
 */
export async function requireExploreSession(): Promise<Session> {
  if (!(await isExploreModuleEnabled())) {
    throw new ExploreRouteError(404, "Not found");
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new ExploreRouteError(401, "Unauthorized");
  }
  return session;
}

export function exploreErrorResponse(error: unknown): NextResponse {
  if (error instanceof ExploreRouteError || error instanceof ExploreAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[explore] unexpected error", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return request
    .json()
    .then((body) => (body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}))
    .catch(() => ({}));
}

export function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ExploreRouteError(400, `${field} is required`);
  }
  return value.trim().slice(0, maxLength);
}

export function optionalString(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

// ---------------------------------------------------------------------------
// Analysis and run access helpers
// ---------------------------------------------------------------------------
import { db } from "@/lib/db";
import { requireTargetAccess } from "@/lib/explore/authorization";

export async function loadAccessibleAnalysis(session: Session, analysisId: string, level: "read" | "write") {
  const analysis = await db.exploreAnalysis.findUnique({
    where: { id: analysisId },
    select: { id: true, targetKey: true, name: true, language: true, environmentName: true, currentRevisionId: true, kitId: true },
  });
  if (!analysis) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, analysis.targetKey, level);
  return analysis;
}

export async function loadAccessibleRun(session: Session, runId: string, level: "read" | "write") {
  const run = await db.exploreAnalysisRun.findUnique({
    where: { id: runId },
    include: { analysis: { select: { id: true, targetKey: true, name: true } } },
  });
  if (!run) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, run.analysis.targetKey, level);
  return run;
}
