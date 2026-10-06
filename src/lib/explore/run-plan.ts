/**
 * What Run recipe would do, before it does it (identity sheet 96 "Run recipe, when a pipeline would start again"):
 * which steps run and which are reused, which pipelines start (and for how long, and as whom), which are reused from
 * a finished run with the same inputs, and the cheap way: only the steps after the pipelines, on their last result.
 * The question is asked only when a pipeline would really start. Also the step's Resume (a new recipe run of that
 * step that continues its failed pipeline run in place).
 */
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { durationWords } from "@/lib/pipelines/plain-status";
import { failedStepAfter, planRun, revisionsUsedBy, runRecords, startFlowRun, type FlowActor, type FlowRunSummary, type StartFlowRunInput } from "./flow-runs";
import { computeStepStates, loadRecipe, type StepRecord } from "./recipe";
import { downstreamOf } from "./recipe-order";
import { parsePipelineStepConfig, pipelineInfo, pipelineReadsChanged, pipelineStepOf, preflightConfig, requirePipelineSteps, type PipelineAccess, type PipelineCheck } from "./pipeline-steps";
import { provisionalReuse, resumableRunOf } from "./pipeline-step-runs";

export interface RunPlanStep {
  stepId: string;
  label: string;
  name: string;
  kind: "code" | "pipeline" | "samples";
  /** run: executes · reuse: the result of an earlier run is read · skip: neither (nothing to reuse yet). */
  action: "run" | "reuse" | "skip";
  reusedFrom: { flowRunId: string; number: number | null } | null;
  pipeline?: {
    pipelineId: string;
    name: string;
    /** A new pipeline run starts (hours of compute). */
    starts: boolean;
    /** A finished run with the same inputs is read instead ("reused from Run #2"). */
    reuses: { pipelineRunId: string; runNumber: string; flowRunNumber: number | null } | null;
    /** The same work is already running for another recipe run: this one waits on it. */
    joins: { pipelineRunId: string; runNumber: string } | null;
    /** Why it runs: "3 samples new since Run #2", "a setting changed since Run #2", "it has not run yet". */
    why: string;
    estimate: { seconds: number | null; words: string };
    samples: number;
    /** CPU hours a new run would use, from finished runs here (per sample); null when unknown. */
    cpuHours?: number | null;
    /** Samples new since the step's last run, and whether it may run only those (pipelines that allow it). */
    newSamples?: { count: number; allowed: boolean; words: string } | null;
  };
}

export interface RunPlanPreview {
  scope: StartFlowRunInput["scope"];
  steps: RunPlanStep[];
  startsPipelines: number;
  /** Ask before running: a pipeline would really start. */
  ask: boolean;
  words: string;
  estimate: { seconds: number | null; words: string };
  runsAs: { userId: string; name: string | null };
  where: string | null;
  /** The run cannot start yet: the first step that is not ready, and why. */
  blocked: { stepId: string; label: string; words: string; check: PipelineCheck | null } | null;
  /** The cheap way: the steps after the pipelines only, on the pipelines' last finished result. */
  alternatives: Array<{ kind: "after-pipelines"; scope: { steps: string[] }; words: string } | { kind: "new-samples-only"; scope: StartFlowRunInput["scope"]; newSamplesOnly: string[]; words: string }>;
  /** A pipeline would wait: the study's limit of pipelines at once is reached (an admin setting). */
  limit?: { max: number; active: number; words: string } | null;
  /** The lab's compute this month, when the server can tell (from the traces of its runs); absent otherwise. */
  compute?: { cpuHours: number; since: string; words: string } | null;
}

/**
 * "step 3", "steps 3 to 5", "steps 1 and 3", "steps 3, 4 and 6", "steps 3 to 5 and 7": steps by their place in the plan;
 * only neighbours in the plan (three or more) read as a range, so steps that do not run in between are never hidden.
 */
export function stepsWords(entries: Array<{ label: string; index: number }>): string {
  if (!entries.length) return "";
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const runs: Array<typeof sorted> = [];
  for (const entry of sorted) {
    const last = runs.at(-1);
    if (last && entry.index === last[last.length - 1].index + 1) last.push(entry);
    else runs.push([entry]);
  }
  const items = runs.flatMap((run) => (run.length >= 3 ? [`${run[0].label} to ${run[run.length - 1].label}`] : run.map((entry) => entry.label)));
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `${sorted.length === 1 ? "step" : "steps"} ${list}`;
}

export async function previewRunPlan(flowId: string, scope: StartFlowRunInput["scope"], actor: FlowActor, access: PipelineAccess, labKey?: string | null): Promise<RunPlanPreview> {
  await requirePipelineSteps();
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  if (!model.steps.length) throw flowError("invalid_request", "This flow has no steps yet.");
  const currentRun = model.flow.currentRunId ? await runRecords(model.flow.currentRunId) : null;
  const current = currentRun?.records ?? new Map<string, StepRecord>();
  const readsChanged = await pipelineReadsChanged(model, current);
  const states = computeStepStates({ model, records: current, revisionsUsed: await revisionsUsedBy(current), failedAt: await failedStepAfter(flowId, currentRun?.run ?? null, model), readsChanged });
  const plan = planRun(model, scope, current, states);
  const executing = new Set(plan.filter((entry) => entry.execute).map((entry) => entry.analysisId));
  const steps: RunPlanStep[] = [];
  let blocked: RunPlanPreview["blocked"] = null;
  let where: string | null = null;
  let seconds = 0, timed = false;
  for (const entry of plan) {
    const step = model.steps.find((candidate) => candidate.id === entry.analysisId)!;
    const out: RunPlanStep = { stepId: entry.analysisId, label: entry.label, name: entry.name, kind: step.stepKind, action: entry.execute ? "run" : entry.reusedFrom ? "reuse" : "skip", reusedFrom: entry.reusedFrom ? { flowRunId: entry.reusedFrom.flowRunId, number: entry.reusedFrom.number } : null };
    const config = step.stepKind === "pipeline" ? parsePipelineStepConfig(step.pipeline) : null;
    if (config && entry.execute) {
      const info = pipelineInfo(config.pipelineId);
      const state = states.get(step.id);
      const record = current.get(step.id);
      const why = readsChanged.get(step.id) ?? (state?.reason === "paramChanged" ? `a setting changed since Run #${record?.flowRunNumber ?? "?"}` : state?.reason === "codeChanged" ? `its version or sample list changed since Run #${record?.flowRunNumber ?? "?"}`
        : state?.reason === "upstreamChanged" || state?.reason === "inputChanged" ? "what it reads changed" : state?.state === "notRun" ? "it has not run yet" : state?.state === "failed" ? "its last run stopped" : "you chose to run it again");
      const preflight = config.pinnedRunId ? null : await preflightConfig(model, config, step.id, access);
      const upstreamRuns = [...(model.upstream.get(step.id) ?? [])].some((id) => executing.has(id));
      const failing = preflight?.checks.find((check) => !check.ok && !(upstreamRuns && check.id === "samples")) ?? null;
      if (failing && !blocked) blocked = { stepId: step.id, label: entry.label, words: `Step ${entry.label} is not ready: ${failing.words.replace(/\.$/, "")}.`, check: failing };
      where = where ?? preflight?.where ?? null;
      let reuses: NonNullable<RunPlanStep["pipeline"]>["reuses"] = null, joins: NonNullable<RunPlanStep["pipeline"]>["joins"] = null;
      // Whether the same work exists: only knowable when nothing it reads runs first.
      const same = !upstreamRuns && info ? await provisionalReuse(model.flow.targetKey, config) : null;
      if (same?.status === "completed") {
        const used = await db.exploreAnalysisRun.findFirst({ where: { pipelineRunId: same.pipelineRunId, status: "completed", flowRunId: { not: null } }, orderBy: { createdAt: "asc" }, select: { flowRun: { select: { number: true } } } });
        reuses = { pipelineRunId: same.pipelineRunId, runNumber: same.runNumber, flowRunNumber: used?.flowRun?.number ?? null };
      } else if (same?.status === "active") joins = { pipelineRunId: same.pipelineRunId, runNumber: same.runNumber };
      // Someone who may not start pipelines here can still run what reuses a finished run.
      if (failing?.id === "permission" && reuses && blocked?.stepId === step.id) blocked = null;
      const starts = !config.pinnedRunId && !reuses && !joins;
      if (starts && preflight?.estimate.seconds != null) { seconds += preflight.estimate.seconds; timed = true; }
      out.pipeline = { pipelineId: config.pipelineId, name: info?.name ?? config.pipelineId, starts, reuses, joins, why, estimate: preflight?.estimate ? { seconds: preflight.estimate.seconds, words: preflight.estimate.words } : { seconds: null, words: "no estimate yet" }, samples: preflight?.estimate.samples ?? 0 };
      if (starts && info) {
        const [{ cpuHoursPerSample }, { newSamplesOption }, { stepReads }] = await Promise.all([import("./pipeline-limits"), import("./pipeline-step-incremental"), import("./pipeline-steps")]);
        const rate = await cpuHoursPerSample(config.pipelineId).catch(() => null);
        out.pipeline.cpuHours = rate !== null && out.pipeline.samples ? Math.max(1, Math.round(rate * out.pipeline.samples)) : null;
        const reads = await stepReads(model.flow.targetKey, config.samples, config.exclusions).catch(() => null);
        out.pipeline.newSamples = reads ? await newSamplesOption(step.id, config, reads, info.name).catch(() => null) : null;
      }
    }
    steps.push(out);
  }
  const starting = steps.filter((step) => step.pipeline?.starts);
  const after = steps.filter((step) => step.action === "run" && !step.pipeline?.starts);
  const placed = (ids: string[]) => ids.map((id) => ({ label: steps.find((step) => step.stepId === id)?.label ?? "?", index: steps.findIndex((step) => step.stepId === id) }));
  // The cheap way exists when every pipeline that would start has a finished result to read meanwhile.
  const alternatives: RunPlanPreview["alternatives"] = [];
  if (starting.length && starting.every((step) => current.get(step.stepId)?.status === "completed")) {
    const skipped = new Set(starting.map((step) => step.stepId));
    const downstream = downstreamOf([...skipped], model.upstream);
    const ids = after.filter((step) => !skipped.has(step.stepId) && (downstream.has(step.stepId) || step.kind !== "pipeline")).map((step) => step.stepId);
    if (ids.length) alternatives.push({ kind: "after-pipelines", scope: { steps: ids }, words: `Only the steps after it, with the result of Run #${current.get(starting[0].stepId)?.flowRunNumber ?? "?"}: ${stepsWords(placed(ids))} ${ids.length === 1 ? "reads" : "read"} the pipeline’s tables from that run; ${starting.length === 1 ? `step ${starting[0].label} stays` : "the pipeline steps stay"} out of date` });
  }
  const estimate = { seconds: timed ? seconds : null, words: timed ? `about ${durationWords(seconds)}` : starting.length ? "no estimate yet" : "seconds" };
  const rest = after.filter((step) => step.kind !== "pipeline").map((step) => step.stepId);
  // What runs before the first pipeline that starts, and what after it, in plan order.
  const firstStart = starting.length ? Math.min(...starting.map((step) => steps.indexOf(step))) : -1;
  const before = rest.filter((id) => steps.findIndex((step) => step.stepId === id) < firstStart);
  const later = rest.filter((id) => steps.findIndex((step) => step.stepId === id) > firstStart);
  const names = starting.map((step) => step.pipeline!.name).join(" and ");
  const runsAs = ` · runs as ${actor.name?.split(" ")[0] ?? "you"}${where ? ` on ${where}` : ""}`;
  const words = blocked ? blocked.words
    : starting.length && before.length ? `Runs ${stepsWords(placed(before))}, then starts ${names} (${estimate.words})${later.length ? `, then ${stepsWords(placed(later))}` : ""}${runsAs}`
    : starting.length ? `Starts ${names}: ${estimate.words}${later.length ? `, then ${stepsWords(placed(later))}` : ""}${runsAs}`
    : steps.some((step) => step.pipeline?.reuses) ? `Reuses ${steps.filter((step) => step.pipeline?.reuses).map((step) => `${step.pipeline!.name}${step.pipeline!.reuses!.flowRunNumber ? ` from Run #${step.pipeline!.reuses!.flowRunNumber}` : ""}`).join(" and ")}${rest.length ? `; runs ${stepsWords(placed(rest))}` : ""}`
    : after.length ? `Runs ${plural(after.length, "step")}` : "Nothing to run: every step is up to date";
  // New samples only: for a pipeline that may add samples to its tables (else its words say why not, on the step).
  for (const step of starting) if (step.pipeline?.newSamples?.allowed) alternatives.push({ kind: "new-samples-only", scope, newSamplesOnly: [step.stepId], words: `${step.pipeline.newSamples.words} (step ${step.label})` });
  const { pipelineCapacity, labComputeThisMonth } = await import("./pipeline-limits");
  const capacity = starting.length ? await pipelineCapacity(model.flow.targetKey).catch(() => null) : null;
  const compute = starting.length ? await labComputeThisMonth(labKey ?? null).catch(() => null) : null;
  return { scope, steps, startsPipelines: starting.length, ask: starting.length > 0 && !blocked, words, estimate, runsAs: { userId: actor.userId, name: actor.name ?? null }, where, blocked, alternatives,
    ...(capacity && !capacity.free ? { limit: { max: capacity.max, active: capacity.active, words: capacity.words ?? "" } } : {}),
    ...(compute ? { compute: { cpuHours: compute.cpuHours, since: compute.since, words: compute.words } } : {}) };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Resume a pipeline step that stopped: a new run of the recipe from that step, whose pipeline run continues the failed
 * one in place (Nextflow -resume keeps the finished stages), with more memory or time when asked. Refused when the
 * reads in Data changed since (Resume would use the old ones; Run again uses the new).
 */
export async function resumePipelineStep(flowId: string, stepId: string, input: { memory?: string | null; time?: string | null; process?: string | null; force?: boolean; requestId?: string; actor: FlowActor; access: PipelineAccess; leaveOut?: string[] | null }): Promise<FlowRunSummary> {
  await requirePipelineSteps();
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  pipelineStepOf(model, stepId);
  const resumable = await resumableRunOf(stepId, model.flow.targetKey);
  if (!resumable) {
    // A second Resume while the first one runs: say that, as starting any run would.
    const active = await db.exploreFlowRun.findFirst({ where: { flowId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
    if (active) throw flowError("run_active", active.kind === "trial" ? `Trial ${active.trialNumber} of this flow is still running. Wait for it or stop it first.` : `Run #${active.number ?? "?"} of this flow is still running. Wait for it or stop it first.`,
      { run: { id: active.id, number: active.number, trialNumber: active.trialNumber, kind: active.kind, status: active.status } });
    throw flowError("invalid_request", "There is no stopped pipeline run of this step to resume. Run the recipe instead.");
  }
  if (resumable.readsChanged && !input.force) throw flowError("reads_changed", `The reads in Data changed since this run (${resumable.readsChanged}). Resume would use the reads it started with; Run again uses the new ones.`, { stepId });
  return startFlowRun(flowId, {
    scope: { steps: [stepId] }, requestId: input.requestId, actor: input.actor,
    pipelines: { access: input.access, resume: { stepId, pipelineRunId: resumable.pipelineRunId, memory: input.memory ?? null, time: input.time ?? null, process: input.process ?? null, ...(input.leaveOut?.length ? { leaveOut: input.leaveOut } : {}) } },
  });
}
