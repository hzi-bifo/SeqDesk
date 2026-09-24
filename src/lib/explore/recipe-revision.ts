/**
 * Recipe revisions (FLOW-GAPS D6): a counter on the flow plus a snapshot of
 * its steps, written in the same transaction as every structural, code or
 * parameter change. Kept apart from recipe.ts so the step store can use it.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface RecipeActor {
  userId: string;
  memberId?: string | null;
}

/**
 * Bump the recipe revision and write its snapshot, inside the caller's
 * transaction. With `expected`, the bump only happens from that revision
 * (409 revision_conflict otherwise, raised by the caller on `null`).
 */
export async function bumpRecipeRevision(tx: Prisma.TransactionClient, flowId: string, actor: RecipeActor, message: string, expected?: number): Promise<number | null> {
  const where = expected === undefined ? { id: flowId } : { id: flowId, recipeRevision: expected };
  const updated = await tx.exploreFlow.updateMany({ where, data: { recipeRevision: { increment: 1 } } });
  if (updated.count !== 1) return null;
  const flow = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { recipeRevision: true } });
  if (!flow) return null;
  const analyses = await tx.exploreAnalysis.findMany({ where: { flowId }, select: { id: true, currentRevisionId: true, position: true, laneKind: true, laneOf: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  await tx.exploreFlowRevision.create({
    data: {
      flowId,
      number: flow.recipeRevision,
      steps: analyses.map((analysis) => ({ analysisId: analysis.id, revisionId: analysis.currentRevisionId, position: analysis.position, laneKind: analysis.laneKind, laneOf: analysis.laneOf })),
      message: message.slice(0, 500),
      createdById: actor.userId,
      createdByMemberId: actor.memberId ?? null,
    },
  });
  return flow.recipeRevision;
}

/** A flow that has never been recorded gets revision 1 before its first run or recipe edit. */
export async function ensureRecipeRevision(flowId: string, actor: RecipeActor): Promise<{ recipeRevision: number; revisionId: string | null }> {
  return db.$transaction(async (tx) => {
    const flow = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { recipeRevision: true } });
    if (!flow) return { recipeRevision: 0, revisionId: null };
    if (flow.recipeRevision === 0) await bumpRecipeRevision(tx, flowId, actor, "Recipe recorded", 0);
    const latest = await tx.exploreFlowRevision.findFirst({ where: { flowId }, orderBy: { number: "desc" }, select: { id: true, number: true } });
    return { recipeRevision: latest?.number ?? flow.recipeRevision, revisionId: latest?.id ?? null };
  });
}
