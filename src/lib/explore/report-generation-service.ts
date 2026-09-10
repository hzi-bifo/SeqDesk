import { createHash } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { createAnalysis } from "./analyses";
import { validateAnalysisInputs } from "./input-validation";
import { getKit } from "./kits/loader";
import { parameterDefaults, parameterProblems } from "./kits/parameters";
import { resolveReadyEnvironment } from "./environments";
import { createAndStartRun } from "./runner";
import { generationItems, generationSnapshot, type ReportGeneration } from "./report-generation";
import { MAX_REPORT_BLOCKS, parseStoredBlocks, ReportBlockSchema } from "./report-blocks";
import { ExploreReportError } from "./reports";

const RequestSchema = z.object({
  requestId: z.string().uuid(),
  kitId: z.string().min(1).max(80),
  name: z.string().trim().max(200).optional(),
  inputs: z.array(z.object({ alias: z.string().min(1).max(40), datasetId: z.string().min(1).max(80), versionId: z.string().min(1).max(80) }).strict()).min(1).max(20),
  params: z.record(z.string(), z.unknown()).default({}),
}).strict();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const runIdFor = (analysisId: string) => `${analysisId}_run`;
const includeGeneration = {
  revisions: { where: { number: 1 }, take: 1 },
  runs: { orderBy: { createdAt: "desc" as const }, take: 1, include: { artifacts: { select: { id: true, name: true, kind: true, format: true, derivedDatasetId: true } } } },
};

export async function requireGenerationReport(reportId: string) {
  const report = await db.exploreReport.findUnique({ where: { id: reportId } });
  if (!report) throw new ExploreReportError(404, "Report not found.");
  return report;
}

/** The caller must authorize this report's scope first. Request identities are scoped to report AND author. */
export async function createReportGeneration(reportId: string, userId: string, raw: unknown) {
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) throw new ExploreReportError(400, parsed.error.issues[0]?.message ?? "Invalid generation request.");
  const body = parsed.data;
  if (JSON.stringify(body.params).length > 20_000) throw new ExploreReportError(400, "Too many analysis options.");
  const report = await requireGenerationReport(reportId);
  const id = `gen_${hash(`${reportId}:${userId}:${body.requestId}`).slice(0, 24)}`;
  const requestHash = hash(canonical({ ...body, inputs: [...body.inputs].sort((a, b) => a.alias.localeCompare(b.alias)) }));
  const findExisting = () => db.exploreAnalysis.findUnique({ where: { id }, include: includeGeneration });
  let analysis = await findExisting();
  if (!analysis) {
    const kit = await getKit(body.kitId);
    if (!kit) throw new ExploreReportError(400, "This template is no longer installed. Choose another template.");
    if (!kit.manifest.outputs.some(output => output.report?.include !== false)) throw new ExploreReportError(400, "This template does not declare report outputs. Use the analysis editor instead.");
    const params = { ...parameterDefaults(kit.manifest.params), ...body.params };
    const paramProblems = parameterProblems(kit.manifest.params, params);
    if (paramProblems.length) throw new ExploreReportError(400, paramProblems[0]);
    let inputs;
    try { inputs = await validateAnalysisInputs(report.targetKey, body.inputs, kit.manifest.inputs); }
    catch (error) { throw new ExploreReportError(400, error instanceof Error ? error.message : "Check the input tables."); }
    if (!await resolveReadyEnvironment(kit.manifest.environment)) throw new ExploreReportError(409, "The analysis software is not ready. Ask an administrator to set up this template's environment.");
    try {
      await createAnalysis({ targetKey: report.targetKey, reportId, kitId: kit.manifest.id, name: body.name, inputs, params, createdById: userId }, {
        id, kit, snapshot: { version: 1, requestHash, name: kit.manifest.name, description: kit.manifest.description, outputs: kit.manifest.outputs, report: kit.manifest.report, citation: kit.manifest.citation },
      });
    } catch (error) {
      // A concurrent request may have committed exactly this analysis first.
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    }
    analysis = await findExisting();
  }
  if (!analysis || analysis.reportId !== reportId || analysis.createdById !== userId || generationSnapshot(analysis.revisions[0]?.inputs)?.requestHash !== requestHash) {
    throw new ExploreReportError(409, "This request was already used with different choices. Start a new generation.");
  }
  return startReportGeneration(reportId, analysis.id, userId);
}

export async function startReportGeneration(reportId: string, analysisId: string, userId: string) {
  const report = await requireGenerationReport(reportId);
  const analysis = await db.exploreAnalysis.findFirst({ where: { id: analysisId, reportId, targetKey: report.targetKey }, include: includeGeneration });
  if (!analysis || !generationSnapshot(analysis.revisions[0]?.inputs)) throw new ExploreReportError(404, "Generation not found.");
  if (analysis.createdById !== userId) throw new ExploreReportError(403, "Only the person who requested this generation can start it. You can create your own generation.");
  const revision = analysis.revisions[0];
  const run = await createAndStartRun({ analysisId, revisionId: revision.id, runId: runIdFor(analysisId), createdById: userId });
  return { analysisId, run };
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];

export async function listReportGenerations(reportId: string): Promise<ReportGeneration[]> {
  const report = await requireGenerationReport(reportId);
  const analyses = await db.exploreAnalysis.findMany({ where: { reportId, targetKey: report.targetKey, id: { startsWith: "gen_" } }, include: includeGeneration, orderBy: { createdAt: "desc" }, take: 100 });
  const savedIds = new Set(parseStoredBlocks(report.blocks).map(block => block.id));
  return analyses.flatMap(analysis => {
    const snapshot = generationSnapshot(analysis.revisions[0]?.inputs);
    if (!snapshot) return [];
    const run = analysis.runs[0];
    let results: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(run?.results ?? "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) results = parsed as Record<string, unknown>; } catch { /* old or incomplete results */ }
    const edited = analysis.currentRevisionId !== analysis.revisions[0]?.id || (run && run.id !== runIdFor(analysis.id));
    const output = run?.status === "completed" && !edited ? generationItems({ analysisId: analysis.id, runId: run.id, runNumber: run.runNumber, snapshot, artifacts: run.artifacts, metrics: (results.metrics ?? {}) as Record<string, unknown>, notes: [...strings(results.notes), ...strings(results.warnings)] }) : { items: [], warnings: [] };
    return [{ analysisId: analysis.id, name: analysis.name, status: edited ? "edited" : run?.status ?? "not-started", runId: run?.id ?? null, runNumber: run?.runNumber ?? null, createdAt: analysis.createdAt.toISOString(),
      items: output.items, addedIds: output.items.filter(item => savedIds.has(item.block.id)).map(item => item.block.id), warnings: [...output.warnings, ...strings(results.warnings)], notes: strings(results.notes) }];
  });
}

/** Add only selected finalized items, atomically against the version the user reviewed. Never overwrite existing blocks or settings. */
export async function appendReportGeneration(reportId: string, analysisId: string, raw: unknown) {
  const parsed = z.object({ expectedUpdatedAt: z.string().datetime(), itemIds: z.array(z.string().min(1).max(120)).min(1).max(MAX_REPORT_BLOCKS) }).strict().safeParse(raw);
  if (!parsed.success) throw new ExploreReportError(400, "Review the finished items and choose what to add.");
  const report = await requireGenerationReport(reportId);
  const generation = (await listReportGenerations(reportId)).find(entry => entry.analysisId === analysisId);
  if (!generation) throw new ExploreReportError(404, "Generation not found.");
  if (generation.status !== "completed") throw new ExploreReportError(409, "This generation is not ready to add. Open its analysis to review the status.");
  const chosen = new Set(parsed.data.itemIds);
  if ([...chosen].some(id => !generation.items.some(item => item.block.id === id))) throw new ExploreReportError(400, "One of the selected items is no longer available.");
  const blocks = parseStoredBlocks(report.blocks);
  const existingIds = new Set(blocks.map(block => block.id));
  const additions = generation.items.filter(item => chosen.has(item.block.id) && !existingIds.has(item.block.id)).map(item => item.block);
  if (!additions.length) return { added: 0 }; // Includes a retried response after a successful save.
  if (blocks.length + additions.length > MAX_REPORT_BLOCKS) throw new ExploreReportError(400, `A report can contain ${MAX_REPORT_BLOCKS} items. Select fewer items or use a new report.`);
  const merged = ReportBlockSchema.array().parse([...blocks, ...additions]);
  const updated = await db.exploreReport.updateMany({ where: { id: reportId, updatedAt: new Date(parsed.data.expectedUpdatedAt) }, data: { blocks: merged } });
  if (updated.count === 0) throw new ExploreReportError(409, "The report changed in another tab. Review the refreshed page, then add the items again.");
  return { added: additions.length };
}
