/**
 * Pipeline steps on the Analysis integration API (capability `explore.pipeline-steps`, SERVER-API "Pipeline steps").
 * Every route answers with the Flow error contract ({error, code, …}). The capability is advertised, and the routes
 * work, only once the database and Prisma client have the pipeline-steps migration (pipelineStepsAvailable).
 *
 *   POST   flows/:id/steps {pipeline:{…}}                       add a pipeline step (explore-flow.ts hands it here)
 *   PUT    flows/:id/steps/:stepId/pipeline                     change its settings, version, preset, sample list, tables, pinned run
 *   GET    flows/:id/steps/:stepId/preflight                    Ready to run: checks in words, each with one fix
 *   POST   flows/:id/steps/:stepId/resume {memory?,time?,force?} Resume a stopped pipeline step (a new recipe run)
 *   POST   flows/:id/pipeline-preflight {pipelineId,…}          the checks for a pipeline before it is added
 *   POST   flows/:id/run-plan {scope}                           what Run recipe would do (Run confirmation)
 *   GET    flows/:id/pipeline-runs[?pipelineId]                 finished runs in the study's Data a step can read, pinned
 *   GET    pipeline-presets[?pipelineId]  POST pipeline-presets  PATCH|DELETE pipeline-presets/:id
 *   GET    pipeline-requests[?status]  POST pipeline-requests  POST pipeline-requests/:id/decide|withdraw
 *   GET    pipeline-store[?targetKey]                           the store and this server's pipelines, for members, with fit
 *   GET    data-summary?targetKey                               a study's data in one line
 */
import { decideServerCapability } from "@/lib/authorization/api";
import { canManageExplore, requireTargetAccess } from "@/lib/explore/authorization";
import { addPipelineStep, pinnableRuns, pipelineStepsAvailable, preflightPipeline, requirePipelineSteps, updatePipelineStep, type PipelineSamplesSpec } from "@/lib/explore/pipeline-steps";
import { createInstallRequest, dataSummary, decideInstallRequest, deletePreset, installRequestView, listInstallRequests, listPresets, pipelineStore, savePreset, withdrawInstallRequest } from "@/lib/explore/pipeline-lab";
import { previewRunPlan, resumePipelineStep } from "@/lib/explore/run-plan";
import { flowError, requestIdOf } from "./flow-contract";
import { actorOf, flowChanged, flowFor, labKeyOf, pipelineAccessOf, readBody, recipeFor, type FlowRouteContext } from "./explore-flow";

const optionalText = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const object = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function parseSamples(raw: unknown): { from: "data" } | { from: "table"; datasetId?: string | null; fromStep?: { stepId: string; output: string } | null; column?: string | null } | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const samples = object(raw);
  if (!samples) throw flowError("invalid_request", 'samples must be {"from":"data"} or {"from":"table","datasetId"|"fromStep","column"?}.');
  if (samples.from === "data") return { from: "data" };
  if (samples.from !== "table") throw flowError("invalid_request", 'samples.from must be "data" or "table".');
  const fromStep = object(samples.fromStep);
  return {
    from: "table", datasetId: optionalText(samples.datasetId, 80), column: optionalText(samples.column, 80),
    fromStep: fromStep && typeof fromStep.stepId === "string" && typeof fromStep.output === "string" ? { stepId: fromStep.stepId, output: fromStep.output } : null,
  };
}

const params = (raw: unknown): Record<string, unknown> | null => {
  if (raw === undefined || raw === null) return null;
  const value = object(raw);
  if (!value || Object.keys(value).length > 200) throw flowError("invalid_request", "params must be an object of settings.");
  return value;
};
const outputs = (raw: unknown): string[] | null => (Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string" && value.length <= 120).slice(0, 50) : null);

/** POST flows/:id/steps with `pipeline`: a pipeline step, a pinned existing run, or a step waiting for an install. */
export async function addPipelineStepFromBody(context: FlowRouteContext, flow: { id: string; targetKey: string }, body: Record<string, unknown>): Promise<Response> {
  const { session, json } = context;
  await requirePipelineSteps();
  const pipeline = object(body.pipeline) ?? {};
  const stepId = await addPipelineStep(flow.id, {
    pipelineId: optionalText(pipeline.pipelineId, 120), version: optionalText(pipeline.version, 40), params: params(pipeline.params), presetId: optionalText(pipeline.presetId, 80),
    samples: parseSamples(pipeline.samples) ?? null, outputs: outputs(pipeline.outputs), pinnedRunId: optionalText(pipeline.pinnedRunId ?? pipeline.runId, 80),
    request: object(pipeline.request) ? { reason: optionalText(object(pipeline.request)!.reason, 500) } : null,
    after: optionalText(body.after, 80), name: optionalText(body.name, 200), purpose: optionalText(body.purpose, 200), requestId: requestIdOf(body.requestId),
    labKey: labKeyOf(session), actor: actorOf(session),
  });
  await flowChanged(flow.id);
  const recipe = await recipeFor(session, flow);
  return json({ step: recipe.steps.find((step) => step.id === stepId) ?? null, recipe }, 201);
}

/** The pipeline-step routes; null when the path is not one of them. */
export async function handlePipelineSteps({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub, stepId, action] = segments;
  const access = () => pipelineAccessOf(session);

  if (head === "flows" && sub === "steps" && segments.length === 5 && action === "pipeline" && method === "PUT") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const changed = await updatePipelineStep(flow.id, stepId, {
      params: params(body.params), replaceParams: body.replaceParams === true, version: optionalText(body.version, 40),
      presetId: body.presetId === null ? null : optionalText(body.presetId, 80) ?? undefined, samples: parseSamples(body.samples), outputs: outputs(body.outputs),
      pinnedRunId: optionalText(body.pinnedRunId, 80), expectedRevisionId: optionalText(body.expectedRevisionId, 80) ?? undefined, labKey: labKeyOf(session), actor: actorOf(session),
    });
    if (changed) await flowChanged(flow.id);
    const recipe = await recipeFor(session, flow);
    return json({ changed, step: recipe.steps.find((step) => step.id === stepId) ?? null, recipe });
  }
  if (head === "flows" && sub === "steps" && segments.length === 5 && action === "preflight" && method === "GET") {
    const flow = await flowFor(session, id, "read");
    return json({ preflight: await preflightPipeline(flow.id, { stepId }, access(), labKeyOf(session)) });
  }
  if (head === "flows" && sub === "steps" && segments.length === 5 && action === "resume" && method === "POST") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const run = await resumePipelineStep(flow.id, stepId, { memory: optionalText(body.memory, 20), time: optionalText(body.time, 20), process: optionalText(body.process, 120), force: body.force === true, requestId: requestIdOf(body.requestId), actor: actorOf(session), access: access() });
    await flowChanged(flow.id);
    return json({ run }, 201);
  }
  if (head === "flows" && segments.length === 3 && sub === "pipeline-preflight" && method === "POST") {
    const flow = await flowFor(session, id, "read");
    const body = await readBody(request);
    const pipelineId = optionalText(body.pipelineId, 120);
    if (!pipelineId) throw flowError("invalid_request", "Name the pipeline with pipelineId.");
    const samples = parseSamples(body.samples);
    // A sample list a step above makes (the add form's "from step 1"): its table, which that step declared when added.
    let fromStepDataset: string | null = null;
    if (samples && samples.from === "table" && !samples.datasetId && samples.fromStep) {
      const { loadRecipe } = await import("@/lib/explore/recipe");
      const model = await loadRecipe(flow.id);
      fromStepDataset = model ? [...model.datasets.values()].find((dataset) => dataset.producer === samples.fromStep!.stepId && dataset.artifactName === samples.fromStep!.output)?.id ?? null : null;
    }
    const spec: PipelineSamplesSpec | null = samples && samples.from === "table" ? { from: "table", datasetId: samples.datasetId ?? fromStepDataset, column: samples.column ?? null } : null;
    return json({ preflight: await preflightPipeline(flow.id, { draft: { pipelineId, version: optionalText(body.version, 40), params: params(body.params), presetId: optionalText(body.presetId, 80), samples: spec } }, access(), labKeyOf(session)) });
  }
  if (head === "flows" && segments.length === 3 && sub === "run-plan" && method === "POST") {
    const flow = await flowFor(session, id, "read");
    const body = await readBody(request);
    const raw = body.scope;
    const scope = raw === undefined || raw === null || raw === "all" ? "all" as const : raw === "outOfDate" ? "outOfDate" as const
      : object(raw) && Array.isArray(object(raw)!.steps) ? { steps: (object(raw)!.steps as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 200) } : null;
    if (!scope) throw flowError("invalid_request", 'scope must be "all", "outOfDate" or {"steps":[…]}.');
    return json({ plan: await previewRunPlan(flow.id, scope, actorOf(session), access(), labKeyOf(session)) });
  }
  if (head === "flows" && segments.length === 3 && sub === "pipeline-runs" && method === "GET") {
    const flow = await flowFor(session, id, "read");
    await requirePipelineSteps();
    return json({ runs: await pinnableRuns(flow.targetKey, query.get("pipelineId")) });
  }

  if (head === "pipeline-presets") {
    await requirePipelineSteps();
    const viewer = { userId: session.user.id, canManage: canManageExplore(session) };
    if (segments.length === 1 && method === "GET") return json({ presets: await listPresets(labKeyOf(session), query.get("pipelineId"), viewer) });
    if (segments.length === 1 && method === "POST") {
      const body = await readBody(request);
      return json({ preset: await savePreset(labKeyOf(session), { pipelineId: optionalText(body.pipelineId, 120), name: body.name, note: body.note, params: body.params, versions: body.versions, thresholds: body.thresholds }, actorOf(session), access()) }, 201);
    }
    if (segments.length === 2 && method === "PATCH") {
      const body = await readBody(request);
      return json({ preset: await savePreset(labKeyOf(session), { id, name: body.name, note: body.note, params: body.params, versions: body.versions, thresholds: body.thresholds }, actorOf(session), access()) });
    }
    if (segments.length === 2 && method === "DELETE") {
      await deletePreset(labKeyOf(session), id, actorOf(session), access());
      return json({ deleted: true });
    }
  }

  if (head === "pipeline-requests") {
    await requirePipelineSteps();
    const viewer = { userId: session.user.id, canManage: canManageExplore(session) };
    if (segments.length === 1 && method === "GET") return json({ requests: await listInstallRequests(labKeyOf(session), viewer, { status: optionalText(query.get("status"), 20) }) });
    if (segments.length === 1 && method === "POST") {
      const body = await readBody(request);
      const flowId = optionalText(body.flowId, 80);
      const flow = flowId ? await flowFor(session, flowId, "read") : null;
      // install: a store pipeline · wanted (also "pipeline-wanted"): one not in the store · reference: a missing reference database.
      const kind = body.kind === "wanted" || body.kind === "pipeline-wanted" ? "wanted" as const : body.kind === "reference" || body.kind === "install-reference" ? "reference" as const : "install" as const;
      const row = await createInstallRequest({ labKey: labKeyOf(session), kind, pipelineId: optionalText(body.pipelineId, 120), referenceId: optionalText(body.referenceId, 120), version: optionalText(body.version, 40),
        text: optionalText(body.text, 1000), reason: optionalText(body.reason, 500), targetKey: flow?.targetKey ?? optionalText(body.targetKey, 200), flowId: flow?.id ?? null, stepPosition: optionalText(body.after, 80), actor: actorOf(session) });
      return json({ request: await installRequestView(row.id, viewer) }, 201);
    }
    if (segments.length === 3 && sub === "decide" && method === "POST") {
      const body = await readBody(request);
      return json({ request: await decideInstallRequest(id, { decision: body.decision, note: body.note }, actorOf(session), access()) });
    }
    if (segments.length === 3 && sub === "withdraw" && method === "POST") return json({ request: await withdrawInstallRequest(id, actorOf(session)) });
  }

  if (head === "pipeline-store" && segments.length === 1 && method === "GET") {
    await requirePipelineSteps();
    const targetKey = query.get("targetKey");
    if (targetKey) await requireTargetAccess(session, targetKey, "read");
    else if (!decideServerCapability(session, "analysis.read_own").allowed) throw flowError("forbidden", "Your SeqDesk account may not read the pipelines.");
    return json(await pipelineStore({ targetKey, labKey: labKeyOf(session), access: access() }));
  }
  if (head === "data-summary" && segments.length === 1 && method === "GET") {
    const targetKey = query.get("targetKey") ?? "";
    if (!/^project:[A-Za-z0-9_-]{1,128}$/.test(targetKey)) throw flowError("invalid_request", "Choose an Analysis study.");
    await requireTargetAccess(session, targetKey, "read");
    return json({ summary: await dataSummary(targetKey) });
  }
  return null;
}

/** Whether the server can serve pipeline steps now (for /info). */
export { pipelineStepsAvailable };
