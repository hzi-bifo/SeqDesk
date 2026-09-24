/**
 * Glosses: short notes on a region of a step's code ("does", "because",
 * "assumes", "chooses"), drafted in pencil by the assistant in the web client
 * or written by a person (FLOW-GAPS D14). A gloss is tied to its region by
 * the region hash, so it goes stale when that code changes.
 */
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { codeRegions } from "./code-regions";
import type { RecipeActor } from "./recipe";

export const GLOSS_TYPES = ["does", "because", "assumes", "chooses"] as const;
const MAX_GLOSSES = 200;

type GlossRecord = Prisma.ExploreGlossGetPayload<object>;

export function serializeGloss(gloss: GlossRecord, regionHashes: Set<string>) {
  return {
    id: gloss.id, analysisId: gloss.analysisId, revisionId: gloss.revisionId, lineStart: gloss.lineStart, lineEnd: gloss.lineEnd, regionHash: gloss.regionHash,
    type: gloss.type, text: gloss.text, author: gloss.author, state: gloss.state, stale: !regionHashes.has(gloss.regionHash),
    acceptedById: gloss.acceptedById, acceptedAt: gloss.acceptedAt?.toISOString() ?? null, checkStatus: gloss.checkStatus, checkNotes: gloss.checkNotes ?? null,
    createdAt: gloss.createdAt.toISOString(), ref: `labdesk://gloss/${gloss.id}@${gloss.regionHash}`,
  };
}

async function revisionOf(analysisId: string, revisionId?: string | null) {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, select: { currentRevisionId: true } });
  if (!analysis) throw flowError("not_found", "Step not found");
  const id = revisionId || analysis.currentRevisionId;
  const revision = id ? await db.exploreAnalysisRevision.findFirst({ where: { id, analysisId }, select: { id: true, code: true } }) : null;
  if (!revision) throw flowError("not_found", "Code revision not found");
  return revision;
}

export async function listGlosses(analysisId: string, revisionId?: string | null) {
  const revision = await revisionOf(analysisId, revisionId);
  const regions = codeRegions(revision.code);
  const hashes = new Set(regions.map((region) => region.regionHash));
  const glosses = await db.exploreGloss.findMany({ where: { analysisId }, orderBy: [{ lineStart: "asc" }, { createdAt: "asc" }], take: 1000 });
  return { revisionId: revision.id, regions, glosses: glosses.map((gloss) => serializeGloss(gloss, hashes)) };
}

/** Replace the pencil glosses of one revision; accepted glosses stay. A person's own gloss is accepted as written. */
export async function putGlosses(analysisId: string, revisionId: unknown, raw: unknown, actor: RecipeActor) {
  if (typeof revisionId !== "string") throw flowError("invalid_request", "revisionId is required.");
  if (!Array.isArray(raw) || raw.length > MAX_GLOSSES) throw flowError("invalid_request", `glosses must be a list of at most ${MAX_GLOSSES}.`);
  const revision = await revisionOf(analysisId, revisionId);
  const regions = codeRegions(revision.code);
  const byHash = new Map(regions.map((region) => [region.regionHash, region] as const));
  const rows = raw.map((entry) => {
    const gloss = entry as Record<string, unknown>;
    if (!gloss || typeof gloss.regionHash !== "string") throw flowError("invalid_request", "Each gloss needs a regionHash.");
    const region = byHash.get(gloss.regionHash);
    if (!region) throw flowError("region_mismatch", "A gloss names code that this revision does not have.", { regionHash: gloss.regionHash });
    if (!GLOSS_TYPES.includes(gloss.type as (typeof GLOSS_TYPES)[number])) throw flowError("invalid_request", 'type must be "does", "because", "assumes" or "chooses".');
    if (typeof gloss.text !== "string" || !gloss.text.trim() || gloss.text.length > 1000) throw flowError("invalid_request", "Each gloss needs text (at most 1,000 characters).");
    const person = gloss.author === "person";
    const lineStart = Number.isInteger(gloss.lineStart) ? Math.max(region.lineStart, Number(gloss.lineStart)) : region.lineStart;
    const lineEnd = Number.isInteger(gloss.lineEnd) ? Math.min(region.lineEnd, Math.max(lineStart, Number(gloss.lineEnd))) : region.lineEnd;
    return {
      analysisId, revisionId: revision.id, lineStart, lineEnd, regionHash: region.regionHash, type: gloss.type as string, text: gloss.text.trim(),
      author: person ? "person" : "assistant", state: person ? "accepted" : "pencil", acceptedById: person ? actor.userId : null, acceptedAt: person ? new Date() : null,
      createdById: actor.userId,
    };
  });
  await db.$transaction([
    db.exploreGloss.deleteMany({ where: { analysisId, revisionId: revision.id, state: "pencil" } }),
    db.exploreGloss.createMany({ data: rows }),
  ]);
  return listGlosses(analysisId, revision.id);
}

export async function glossRecord(id: string) {
  const gloss = await db.exploreGloss.findUnique({ where: { id }, include: { analysis: { select: { targetKey: true } } } });
  if (!gloss) throw flowError("not_found", "Gloss not found");
  return gloss;
}

async function serializeOne(id: string) {
  const gloss = await db.exploreGloss.findUnique({ where: { id } });
  if (!gloss) throw flowError("not_found", "Gloss not found");
  const revision = await revisionOf(gloss.analysisId).catch(() => null);
  return serializeGloss(gloss, new Set(codeRegions(revision?.code ?? "").map((region) => region.regionHash)));
}

export async function patchGloss(id: string, body: Record<string, unknown>) {
  const data: Prisma.ExploreGlossUpdateInput = {};
  if (body.text !== undefined) {
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 1000) throw flowError("invalid_request", "text must be 1 to 1,000 characters.");
    data.text = body.text.trim();
  }
  if (body.checkStatus !== undefined) {
    if (!["unchecked", "passed", "failed"].includes(String(body.checkStatus))) throw flowError("invalid_request", 'checkStatus must be "unchecked", "passed" or "failed".');
    data.checkStatus = String(body.checkStatus);
  }
  if (body.checkNotes !== undefined) {
    if (body.checkNotes !== null && (!Array.isArray(body.checkNotes) || JSON.stringify(body.checkNotes).length > 10000)) throw flowError("invalid_request", "checkNotes must be a short list.");
    data.checkNotes = body.checkNotes === null ? PrismaRuntime.DbNull : (body.checkNotes as Prisma.InputJsonValue);
  }
  await db.exploreGloss.update({ where: { id }, data });
  return serializeOne(id);
}

export async function acceptGloss(id: string, actor: RecipeActor) {
  await db.exploreGloss.update({ where: { id }, data: { state: "accepted", acceptedById: actor.userId, acceptedAt: new Date() } });
  return serializeOne(id);
}

export async function deleteGloss(id: string) {
  await db.exploreGloss.delete({ where: { id } });
}
