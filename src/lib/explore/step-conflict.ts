import { db } from "@/lib/db";
import { parseInputBindings } from "./analyses";
import { ExploreRouteError } from "./route-error";

/** One side of a step conflict: what a revision holds, who wrote it and when. */
export interface StepConflictSide {
  id: string;
  number: number;
  params: Record<string, unknown>;
  code: string;
  inputs: unknown[];
  message: string | null;
  createdAt: string;
  by: { userId: string | null; name: string };
}

function objectOf(raw: string | null | undefined): Record<string, unknown> {
  try { const value = JSON.parse(raw ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
/**
 * A save based on an older revision of a step (optimistic concurrency, per step): a 409 `step_conflict` that
 * carries the revision the save was based on and the one that replaced it, with their params and code, so the
 * page can show what changed and let the person take theirs or reapply their change on top. Other steps never
 * conflict: the check is on this step's current revision only.
 */
export async function stepConflictError(analysisId: string, baseRevisionId: string, message: string): Promise<ExploreRouteError> {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, select: { currentRevisionId: true } });
  const ids = [baseRevisionId, analysis?.currentRevisionId].filter((id): id is string => !!id);
  const revisions = await db.exploreAnalysisRevision.findMany({ where: { analysisId, id: { in: ids } } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(revisions.map((r) => r.authorUserId).filter((id): id is string => !!id))] } }, select: { id: true, firstName: true, lastName: true } });
  const side = (id: string | null | undefined): StepConflictSide | null => {
    const revision = revisions.find((r) => r.id === id);
    if (!revision) return null;
    const user = users.find((u) => u.id === revision.authorUserId);
    return {
      id: revision.id, number: revision.number, params: objectOf(revision.params), code: revision.code, inputs: parseInputBindings(revision.inputs),
      message: revision.message, createdAt: revision.createdAt.toISOString(),
      by: { userId: revision.authorUserId, name: [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || "Someone" },
    };
  };
  return new ExploreRouteError(409, message, "step_conflict", { stepId: analysisId, base: side(baseRevisionId), current: side(analysis?.currentRevisionId) });
}

/** A step's extra packages saved from an older view: the same 409, with the packages now on the step. */
export function packagesConflictError(analysisId: string, current: { packages: string[]; channels: string[] }): ExploreRouteError {
  return new ExploreRouteError(409, "This step's packages changed in another session.", "step_conflict", { stepId: analysisId, packages: current });
}
