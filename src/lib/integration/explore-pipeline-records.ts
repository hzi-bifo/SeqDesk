/**
 * Pipelines before, during and after a run, and finding the right one, on the Analysis integration API (identity
 * sheets 96–97; capabilities `explore.samples-steps` and `explore.pipeline-records`, advertised with
 * `explore.pipeline-steps` once the database has the pipeline-steps migration). Flow error contract throughout.
 *
 *   POST   flows/:id/steps {samples:{…}}                          add a Choose samples step (explore-flow.ts hands it here)
 *   GET    flows/:id/steps/:stepId/samples                         its preview (counts per rule, reads matched, the list)
 *   PUT    flows/:id/steps/:stepId/samples                         change its filters, columns, names, metadata
 *   POST   flows/:id/samples-preview {samples:{…}}                 the preview of a configuration before the step exists
 *   POST   flows/:id/steps/:stepId/samples/matches                 Match by hand: confirm files, leave samples out
 *   POST   flows/:id/steps/:stepId/samples/mapping                 an uploaded sample → file table   · DELETE: remove it
 *   POST   flows/:id/steps/:stepId/samples/exclusions              leave samples out / take them back
 *   POST   flows/:id/steps/:stepId/leave-out                       a failed sample of a running pipeline: leave it out and continue
 *   GET    flows/:id/steps/:stepId/quality                         the quality line · POST …/quality/leave-out · POST …/quality/undo
 *   GET    flows/:id/steps/:stepId/methods[?runId]                 the Methods sentence and citations, from the record
 *   GET    flows/:id/steps/:stepId/compare  POST …/compare  POST …/compare/dismiss   a newer version side by side
 *   POST   pipeline-store/which {targetKey,goal?,question?,ids?}   the Which one? comparison
 *   GET    pipeline-references?pipelineId   POST pipeline-references/install {pipelineId,referenceId}   (install: admins)
 *   GET    pipeline-settings   PUT pipeline-settings {maxConcurrentPerStudy}   (PUT: admins)
 */
import { canManageExplore, requireTargetAccess } from "@/lib/explore/authorization";
import { requirePipelineSteps } from "@/lib/explore/pipeline-steps";
import { flowError, requestIdOf } from "./flow-contract";
import { actorOf, flowChanged, flowFor, labKeyOf, pipelineAccessOf, readBody, recipeFor, type FlowRouteContext } from "./explore-flow";

const object = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const optionalText = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const strings = (value: unknown, max = 500): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim().slice(0, 300)).slice(0, max) : []);

/** The samples configuration a client sends (validated again by the step). */
function samplesInput(raw: unknown) {
  const value = object(raw) ?? {};
  const metadata = value.metadata === null ? null : object(value.metadata);
  return {
    ...(value.metadata !== undefined ? { metadata: metadata ? { datasetId: optionalText(metadata.datasetId, 80), sampleColumn: optionalText(metadata.sampleColumn, 200) } : null } : {}),
    ...(value.forPipeline !== undefined ? { forPipeline: optionalText(value.forPipeline, 120) } : {}),
    ...(value.filters !== undefined ? { filters: value.filters } : {}),
    ...(typeof value.cleanNames === "boolean" ? { cleanNames: value.cleanNames } : {}),
    ...(value.withoutReads === "stop" || value.withoutReads === "leave-out" ? { withoutReads: value.withoutReads as "stop" | "leave-out" } : {}),
    ...(value.extraColumns !== undefined ? { extraColumns: value.extraColumns } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
  };
}

/** POST flows/:id/steps with `samples`: a Choose samples step. */
export async function addSamplesStepFromBody(context: FlowRouteContext, flow: { id: string; targetKey: string }, body: Record<string, unknown>): Promise<Response> {
  const { session, json } = context;
  await requirePipelineSteps();
  const { addSamplesStep } = await import("@/lib/explore/samples-step");
  const stepId = await addSamplesStep(flow.id, { config: samplesInput(body.samples), after: optionalText(body.after, 80), name: optionalText(body.name, 200), requestId: requestIdOf(body.requestId), actor: actorOf(session) });
  await flowChanged(flow.id);
  const recipe = await recipeFor(session, flow);
  return json({ step: recipe.steps.find((step: { id: string }) => step.id === stepId) ?? null, recipe }, 201);
}

const RECORD_ACTIONS = new Set(["samples", "leave-out", "quality", "methods", "compare"]);
const RECORD_HEADS = new Set(["pipeline-references", "pipeline-settings"]);

/** Whether a path is one of these routes (explore-flow.ts dispatch). */
export function isPipelineRecordsRoute(segments: string[]): boolean {
  const [head, id, sub, , action] = segments;
  return RECORD_HEADS.has(head) || (head === "pipeline-store" && id === "which") || (head === "flows" && (sub === "samples-preview" || (sub === "steps" && RECORD_ACTIONS.has(action))));
}

export async function handlePipelineRecords(context: FlowRouteContext): Promise<Response | null> {
  const { request, session, segments, json } = context;
  if (!isPipelineRecordsRoute(segments)) return null;
  await requirePipelineSteps();
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub, stepId, action, extra] = segments;
  const access = () => pipelineAccessOf(session);
  const actor = () => actorOf(session);
  const reply = async (flow: { id: string; targetKey: string }, changed: boolean, payload: Record<string, unknown> = {}, status = 200) => {
    if (changed) await flowChanged(flow.id);
    const recipe = await recipeFor(session, flow);
    return json({ changed, ...payload, step: stepId ? recipe.steps.find((step: { id: string }) => step.id === stepId) ?? null : null, recipe }, status);
  };

  // ---- Choose samples
  if (head === "flows" && sub === "samples-preview" && segments.length === 3 && method === "POST") {
    const flow = await flowFor(session, id, "read");
    const body = await readBody(request);
    const { samplesPreview, mergeSamplesConfig, defaultSamplesConfig } = await import("@/lib/explore/samples-step");
    const { loadRecipe } = await import("@/lib/explore/recipe");
    const model = await loadRecipe(flow.id);
    if (!model) throw flowError("not_found", "Flow not found");
    return json({ preview: await samplesPreview(model, mergeSamplesConfig(defaultSamplesConfig(), samplesInput(body.samples ?? body)), null, { rows: typeof body.rows === "number" ? body.rows : 20 }) });
  }
  if (head === "flows" && sub === "steps" && action === "samples") {
    const samples = await import("@/lib/explore/samples-step");
    if (segments.length === 5 && method === "GET") {
      const flow = await flowFor(session, id, "read");
      const { loadRecipe } = await import("@/lib/explore/recipe");
      const model = await loadRecipe(flow.id);
      if (!model) throw flowError("not_found", "Flow not found");
      const { config } = samples.samplesStepOf(model, stepId);
      return json({ preview: await samples.samplesPreview(model, config, stepId, { rows: Number(query.get("rows") ?? 20) || 20 }) });
    }
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const expectedRevisionId = optionalText(body.expectedRevisionId, 80) ?? undefined;
    if (segments.length === 5 && method === "PUT") return reply(flow, await samples.updateSamplesStep(flow.id, stepId, { ...samplesInput(body), expectedRevisionId, actor: actor() }));
    if (segments.length === 6 && extra === "matches" && method === "POST") {
      const confirm = (Array.isArray(body.confirm) ? body.confirm : []).slice(0, 500).flatMap((entry) => { const value = object(entry); const sample = optionalText(value?.sample, 300); const files = strings(value?.files, 2); return sample && files.length ? [{ sample, files }] : []; });
      const leaveOut = (Array.isArray(body.leaveOut) ? body.leaveOut : []).slice(0, 500).flatMap((entry) => { const value = object(entry); const sample = optionalText(value?.sample ?? entry, 300); return sample ? [{ sample, reason: optionalText(value?.reason, 500) }] : []; });
      if (!confirm.length && !leaveOut.length) throw flowError("invalid_request", "Confirm a match or leave a sample out.");
      return reply(flow, await samples.confirmSampleMatches(flow.id, stepId, { confirm, leaveOut, expectedRevisionId, actor: actor() }));
    }
    if (segments.length === 6 && extra === "mapping" && method === "POST") {
      const result = await samples.uploadSampleMapping(flow.id, stepId, { rows: body.rows, csv: body.csv, name: optionalText(body.name, 200), expectedRevisionId, actor: actor() });
      return reply(flow, result.changed, { kept: result.kept, unknown: result.unknown });
    }
    if (segments.length === 6 && extra === "mapping" && method === "DELETE") return reply(flow, await samples.removeSampleMapping(flow.id, stepId, { expectedRevisionId, actor: actor() }));
    if (segments.length === 6 && extra === "exclusions" && method === "POST") {
      const add = (Array.isArray(body.add) ? body.add : []).slice(0, 500).flatMap((entry) => { const value = object(entry); const sample = optionalText(value?.sample ?? entry, 300); return sample ? [{ sample, reason: optionalText(value?.reason, 500) }] : []; });
      return reply(flow, await samples.changeSampleExclusions(flow.id, stepId, { add, remove: strings(body.remove), expectedRevisionId, actor: actor() }));
    }
    return null;
  }

  // ---- A failed sample while it runs
  if (head === "flows" && sub === "steps" && action === "leave-out" && segments.length === 5 && method === "POST") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const { leaveOutDuringRun } = await import("@/lib/explore/pipeline-quality");
    const result = await leaveOutDuringRun(flow.id, stepId, { samples: strings(body.samples), reason: optionalText(body.reason, 500), resume: body.resume !== false, actor: actor(), access: access(), requestId: requestIdOf(body.requestId) });
    return reply(flow, true, { leaveOut: { recordedIn: result.recordedIn, samples: result.samples, resumed: result.resumed, words: result.words }, run: result.run }, result.resumed ? 201 : 200);
  }

  // ---- Quality
  if (head === "flows" && sub === "steps" && action === "quality") {
    const quality = await import("@/lib/explore/pipeline-quality");
    if (segments.length === 5 && method === "GET") {
      const flow = await flowFor(session, id, "read");
      const { loadRecipe } = await import("@/lib/explore/recipe");
      const { parsePipelineStepConfig } = await import("@/lib/explore/pipeline-steps");
      const model = await loadRecipe(flow.id);
      const step = model?.steps.find((candidate) => candidate.id === stepId);
      const config = step ? parsePipelineStepConfig(step.pipeline) : null;
      if (!model || !step || !config) throw flowError("invalid_request", "That step is not a pipeline step.");
      return json({ quality: await quality.qualityOf(model, step, config) });
    }
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    if (segments.length === 6 && extra === "leave-out" && method === "POST") {
      const result = await quality.leaveOutAfterQuality(flow.id, stepId, { samples: strings(body.samples), reason: optionalText(body.reason, 500), actor: actor() });
      return reply(flow, true, { quality: result.quality, leftOut: { samples: result.samples, tables: result.tables, recordedIn: result.recordedIn } });
    }
    if (segments.length === 6 && extra === "undo" && method === "POST") {
      const result = await quality.undoQualityLeaveOut(flow.id, stepId, { samples: strings(body.samples), actor: actor() });
      return reply(flow, true, { quality: result.quality, takenBack: result.samples });
    }
    return null;
  }

  // ---- Methods sentence
  if (head === "flows" && sub === "steps" && action === "methods" && segments.length === 5 && method === "GET") {
    const flow = await flowFor(session, id, "read");
    const { pipelineMethodsFor } = await import("@/lib/explore/pipeline-methods");
    return json({ methods: await pipelineMethodsFor(flow.id, stepId, optionalText(query.get("runId"), 80)) });
  }

  // ---- Compare versions
  if (head === "flows" && sub === "steps" && action === "compare") {
    const compare = await import("@/lib/explore/pipeline-compare");
    if (segments.length === 5 && method === "GET") {
      await flowFor(session, id, "read");
      return json({ compare: await compare.compareView(id, stepId) });
    }
    const flow = await flowFor(session, id, "write");
    if (segments.length === 5 && method === "POST") return json({ compare: await compare.startCompareRun(flow.id, stepId, { actor: actor(), access: access() }) }, 201);
    if (segments.length === 6 && extra === "dismiss" && method === "POST") { await compare.dismissCompare(stepId); return json({ compare: await compare.compareView(flow.id, stepId) }); }
    return null;
  }

  // ---- Which one?
  if (head === "pipeline-store" && id === "which" && segments.length === 2 && method === "POST") {
    const body = await readBody(request);
    const targetKey = optionalText(body.targetKey, 200);
    if (targetKey) await requireTargetAccess(session, targetKey, "read");
    const { whichPipelines } = await import("@/lib/explore/pipeline-which");
    return json({ which: await whichPipelines({ targetKey, labKey: labKeyOf(session), access: access(), goal: optionalText(body.goal, 120), question: optionalText(body.question, 1000), ids: strings(body.ids, 6) }) });
  }

  // ---- Reference databases
  if (head === "pipeline-references") {
    const references = await import("@/lib/explore/pipeline-references");
    if (segments.length === 1 && method === "GET") {
      const pipelineId = optionalText(query.get("pipelineId"), 120);
      if (!pipelineId) throw flowError("invalid_request", "Name the pipeline with pipelineId.");
      return json({ references: await references.pipelineReferences(pipelineId), canInstall: canManageExplore(session) });
    }
    if (segments.length === 2 && id === "install" && method === "POST") {
      const body = await readBody(request);
      const pipelineId = optionalText(body.pipelineId, 120), referenceId = optionalText(body.referenceId, 120);
      if (!pipelineId || !referenceId) throw flowError("invalid_request", "Name the pipeline and the reference database.");
      const result = await references.installReference(pipelineId, referenceId, access());
      return json({ reference: result.reference, started: result.started }, result.started ? 202 : 200);
    }
    return null;
  }

  // ---- Limits
  if (head === "pipeline-settings" && segments.length === 1) {
    const limits = await import("@/lib/explore/pipeline-limits");
    if (method === "GET") return json({ settings: await limits.pipelineStepSettings(), canEdit: canManageExplore(session), compute: await limits.labComputeThisMonth(labKeyOf(session)).catch(() => null) });
    if (method === "PUT") return json({ settings: await limits.savePipelineStepSettings(await readBody(request), access()), canEdit: true });
  }
  return null;
}
