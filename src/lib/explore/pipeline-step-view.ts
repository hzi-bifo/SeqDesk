/**
 * What the recipe shows of a pipeline step (SERVER-API "Pipeline steps", `step.pipeline`): the pipeline and its
 * version, what it runs on in words, its settings with their meaning, the tables it keeps and the files it makes, its
 * stages, the lab preset it came from (and whether it differs or was updated), the pinned run and a newer one, the
 * viewed or active run in plain words, and whether it can run here. One run number is the recipe's ("Run #2"); the
 * pipeline run's own number stays in `run.runNumber` for Details.
 */
import { db } from "@/lib/db";
import { getPipelineEnabled } from "@/lib/pipelines/enablement";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { getPipelineDatabaseStatuses } from "@/lib/pipelines/database-downloads";
import type { ParamMetaEntry } from "./recipe-view";
import type { RecipeModel, RecipeStep, StepRecord } from "./recipe";
import {
  fileOutputsOf, parsePipelineStepConfig, pinnableRuns, pipelineInfo, pipelineSettings, pipelineStartAccess, stagesOf, stepReads, storedPipelineConfig, tableOutputsOf,
  type PinnableRun, type PipelineAccess, type PipelineSetting, type PipelineStepConfig,
} from "./pipeline-steps";
import { snapshotOf, type PipelineSnapshot } from "./pipeline-step-runs";

export interface PipelineStepRunView extends PipelineSnapshot {
  stepRunId: string;
  flowRunId: string | null;
  flowRunNumber: number | null;
  /** queued | running | completed | failed | cancelled, the step run's own status. */
  stepStatus: string;
}

export interface PipelineStepView {
  pipelineId: string;
  name: string;
  version: string;
  /** The version installed now when it differs from the step's pinned version (the "new version" notice). */
  installedVersion: string | null;
  description: string | null;
  source: { kind: "seqdesk" | "nf-core" | "lab"; label: string };
  samples: { from: "data" | "table"; datasetId: string | null; stepId: string | null; column: string | null; count: number; words: string };
  settings: PipelineSetting[];
  settingsCount: number;
  outputs: Array<{ outputId: string; name: string; label: string; tableKind: string | null; datasetId: string | null; version: number | null }>;
  files: Array<{ outputId: string; label: string; kind: "report" | "figure" | "file" }>;
  stages: string[];
  references: Array<{ id: string; label: string; installed: boolean; sizeBytes: number | null }>;
  preset: { id: string; name: string; updatedAt: string; updated: boolean; differs: Array<{ key: string; label: string; value: unknown; preset: unknown }> } | null;
  pinnedRun: PinnableRun | null;
  newerRun: PinnableRun | null;
  run: PipelineStepRunView | null;
  available: { installed: boolean; enabled: boolean; canStart: boolean; words: string | null; request: { id: string; status: string; requestedBy: string | null; at: string; note: string | null } | null };
  /** "3 samples new since Run #2": the reads in Data changed since the step's run. */
  readsChanged: string | null;
  /* Sheet 96 (explore.pipeline-records; optional): the quality line of the shown run, its Methods sentence and
     citations from the record, the version notice, the samples left out of it, and whether new samples can run alone. */
  quality?: import("./pipeline-quality").PipelineQuality | null;
  methods?: import("./pipeline-methods").PipelineMethods | null;
  versions?: import("./pipeline-compare").PipelineVersions | null;
  leftOut?: Array<{ sample: string; reason: string; stage: string; by: string | null; at: string; words: string }>;
  incremental?: { allowed: boolean; words: string | null };
}

/** Param meta for a pipeline step's settings, from the pipeline's schema (title, description, range, options, default). */
export function pipelineParamMeta(settings: PipelineSetting[]): Record<string, ParamMetaEntry> {
  const meta: Record<string, ParamMetaEntry> = {};
  for (const setting of settings) {
    const entry: ParamMetaEntry = { label: setting.title };
    if (setting.description) entry.meaning = setting.description;
    if (setting.minimum !== null) entry.min = setting.minimum;
    if (setting.maximum !== null) entry.max = setting.maximum;
    if (setting.enum) entry.options = setting.enum;
    if (setting.default !== null && setting.default !== undefined && setting.default !== "") entry.usual = setting.default;
    meta[setting.key] = entry;
  }
  return meta;
}

function sourceOf(provider: string | undefined, pipelineId: string): PipelineStepView["source"] {
  const text = `${provider ?? ""} ${pipelineId}`.toLowerCase();
  if (text.includes("nf-core")) return { kind: "nf-core", label: "nf-core" };
  if (provider && !/seqdesk/i.test(provider)) return { kind: "lab", label: provider };
  return { kind: "seqdesk", label: "SeqDesk" };
}

export interface PipelineViewContext {
  model: RecipeModel;
  /** The viewed run's records (the run whose results the page shows). */
  viewed: Map<string, StepRecord>;
  /** The active recipe run and the steps it executes (their step runs carry the live snapshot). */
  activeRunId: string | null;
  readsChanged: Map<string, string>;
  access?: PipelineAccess | null;
  labKey?: string | null;
  /**
   * The recipe as it is now (not a run a person picked): a pipeline step run that stopped (failed or cancelled) in a
   * recipe run started after this time (the current run's start; null when there is none) is the run shown, so the
   * block says where it stopped, what Resume keeps and the one fix. Undefined when a chosen run is viewed.
   */
  stoppedAfter?: Date | null;
}

/** The `pipeline` object of every pipeline step of a recipe. */
export async function pipelineStepViews(context: PipelineViewContext): Promise<Map<string, PipelineStepView>> {
  const views = new Map<string, PipelineStepView>();
  const steps = context.model.steps.filter((step) => step.stepKind === "pipeline");
  if (!steps.length) return views;
  const viewedIds = steps.map((step) => context.viewed.get(step.id)?.stepRunId).filter((id): id is string => Boolean(id));
  const [viewedRuns, activeRuns, flowRuns, stoppedRuns] = await Promise.all([
    viewedIds.length ? db.exploreAnalysisRun.findMany({ where: { id: { in: viewedIds } }, select: { id: true, analysisId: true, status: true, results: true, flowRunId: true } }) : [],
    context.activeRunId ? db.exploreAnalysisRun.findMany({ where: { flowRunId: context.activeRunId, analysisId: { in: steps.map((step) => step.id) } }, select: { id: true, analysisId: true, status: true, results: true, flowRunId: true } }) : [],
    context.activeRunId ? db.exploreFlowRun.findMany({ where: { id: context.activeRunId }, select: { id: true, number: true } }) : [],
    context.stoppedAfter !== undefined ? stoppedStepRuns(steps, context.stoppedAfter) : new Map<string, RunRow & { number: number | null }>(),
  ]);
  const start = context.access ? await pipelineStartAccess(context.model.flow.targetKey, context.access) : { ok: true, words: null };
  const settingsNow = await getExecutionSettings().catch(() => null);
  for (const step of steps) {
    const config = parsePipelineStepConfig(step.pipeline);
    if (!config) continue;
    views.set(step.id, await viewOf(step, config, {
      context, start, settingsNow,
      viewedRun: viewedRuns.find((run) => run.analysisId === step.id) ?? null,
      activeRun: activeRuns.filter((run) => run.analysisId === step.id).at(-1) ?? null,
      activeNumber: flowRuns[0]?.number ?? null,
      stoppedRun: stoppedRuns.get(step.id) ?? null,
    }));
  }
  return views;
}

type RunRow = { id: string; analysisId: string; status: string; results: string | null; flowRunId: string | null };

/**
 * Per step, its latest step run when that one stopped (failed or cancelled, with a pipeline record) in a numbered recipe
 * run after `after`, at the step's current revision: the stopped state the recipe shows until the step runs again.
 */
async function stoppedStepRuns(steps: RecipeStep[], after: Date | null): Promise<Map<string, RunRow & { number: number | null }>> {
  const out = new Map<string, RunRow & { number: number | null }>();
  const rows = await db.exploreAnalysisRun.findMany({
    where: { analysisId: { in: steps.map((step) => step.id) }, executionMode: "pipeline", flowRunId: { not: null }, trial: false, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "desc" }, select: { id: true, analysisId: true, status: true, results: true, flowRunId: true, revisionId: true },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.analysisId)) latest.set(row.analysisId, row);
  const stopped = [...latest.values()].filter((row) => (row.status === "failed" || row.status === "cancelled") && row.results && steps.find((step) => step.id === row.analysisId)?.revision?.id === row.revisionId);
  const numbers = stopped.length ? await db.exploreFlowRun.findMany({ where: { id: { in: stopped.map((row) => row.flowRunId!) } }, select: { id: true, number: true } }) : [];
  for (const row of stopped) out.set(row.analysisId, { id: row.id, analysisId: row.analysisId, status: row.status, results: row.results, flowRunId: row.flowRunId, number: numbers.find((flowRun) => flowRun.id === row.flowRunId)?.number ?? null });
  return out;
}

async function viewOf(step: RecipeStep, config: PipelineStepConfig, input: { context: PipelineViewContext; start: { ok: boolean; words: string | null }; settingsNow: Awaited<ReturnType<typeof getExecutionSettings>> | null; viewedRun: RunRow | null; activeRun: RunRow | null; activeNumber: number | null; stoppedRun?: (RunRow & { number: number | null }) | null }): Promise<PipelineStepView> {
  const { context } = input;
  const { model } = context;
  const info = pipelineInfo(config.pipelineId);
  const stored = info ? await storedPipelineConfig(config.pipelineId).catch(() => ({})) : {};
  const settings = info ? pipelineSettings(info.definition, config.params, stored) : [];
  const enabled = info ? await getPipelineEnabled(config.pipelineId).catch(() => false) : false;
  const reads = config.pinnedRunId ? null : await stepReads(model.flow.targetKey, config.samples).catch(() => null);
  const samplesDataset = config.samples?.datasetId ? model.datasets.get(config.samples.datasetId) : undefined;
  const contracts = tableOutputsOf(config.pipelineId);
  const outputs = config.outputs.map((output) => {
    const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === step.id && candidate.artifactName === output.name);
    const contract = contracts.find((entry) => entry.outputId === output.outputId);
    return { outputId: output.outputId, name: output.name, label: contract?.label ?? output.name, tableKind: contract?.tableKind ?? dataset?.tableKind ?? null, datasetId: dataset?.id ?? null, version: dataset?.current?.number ?? null };
  });
  const databases = info && input.settingsNow ? await getPipelineDatabaseStatuses(config.pipelineId, { ...stored, ...config.params }, input.settingsNow.pipelineRunDir, (input.settingsNow as { pipelineDatabaseDir?: string | null }).pipelineDatabaseDir).catch(() => []) : [];

  // The preset it came from: changed since the step used it ("Preset updated · Use it"), and settings that differ.
  let preset: PipelineStepView["preset"] = null;
  if (config.presetId) {
    const row = await db.explorePipelinePreset.findUnique({ where: { id: config.presetId } }).catch(() => null);
    if (row && !row.archivedAt) {
      const { _thresholds: _ignored, ...presetParams } = (row.params && typeof row.params === "object" && !Array.isArray(row.params) ? row.params : {}) as Record<string, unknown>;
      void _ignored;
      const differs = [...new Set([...Object.keys(presetParams), ...Object.keys(config.params)])].filter((key) => JSON.stringify(presetParams[key]) !== JSON.stringify(config.params[key]))
        .map((key) => ({ key, label: settings.find((setting) => setting.key === key)?.title ?? key, value: config.params[key] ?? null, preset: presetParams[key] ?? null }));
      preset = { id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), updated: Boolean(step.revision && row.updatedAt > step.revision.createdAt), differs };
    }
  }

  // The pinned run, and a newer finished run of the same pipeline in Data ("Use it").
  let pinnedRun: PinnableRun | null = null, newerRun: PinnableRun | null = null;
  if (config.pinnedRunId) {
    const runs = await pinnableRuns(model.flow.targetKey, config.pipelineId).catch(() => []);
    pinnedRun = runs.find((run) => run.id === config.pinnedRunId) ?? null;
    const newest = runs[0];
    newerRun = newest && pinnedRun && newest.id !== pinnedRun.id && (newest.completedAt ?? "") > (pinnedRun.completedAt ?? "") ? newest : null;
  }

  // The run shown: the active run's when the step executes in it, else one that stopped since the current run (where
  // it stopped, what Resume keeps, its fix), else the viewed run's.
  const live = input.activeRun;
  const stopped = live ? null : input.stoppedRun ?? null;
  const shown = live ?? stopped ?? input.viewedRun;
  const snapshot = shown ? snapshotOf(shown.results) : null;
  const flowRunNumber = live ? input.activeNumber : stopped ? stopped.number : context.viewed.get(step.id)?.flowRunNumber ?? null;
  const run: PipelineStepRunView | null = shown && snapshot ? { ...snapshot, stepRunId: shown.id, flowRunId: shown.flowRunId, flowRunNumber, stepStatus: shown.status } : null;
  // Sheet 96: quality, Methods, versions, left-out samples (from the record; never guessed).
  const records96 = await recordExtras(step, config, context, shown?.results ?? null, flowRunNumber).catch(() => ({}));

  const request = config.requestId ? await db.explorePipelineInstallRequest.findUnique({ where: { id: config.requestId } }).catch(() => null) : null;
  const installed = Boolean(info) || Boolean(config.pinnedRunId);
  const words = !installed ? `Waiting to be installed${request ? ` · asked by ${request.requestedByName ?? "a member"}` : ""}`
    : !info ? null
    : !enabled ? `${info.name} is switched off on this server`
    : config.version && config.version !== info.version ? `This server has ${info.name} ${info.version}; the step uses ${config.version}`
    : !input.start.ok ? input.start.words : null;
  return {
    pipelineId: config.pipelineId, name: info?.name ?? config.pipelineId, version: config.version || info?.version || "",
    installedVersion: info && config.version && info.version !== config.version ? info.version : null,
    description: info?.description ?? null, source: sourceOf(info?.pkg.manifest.package.provider, config.pipelineId),
    samples: {
      from: config.samples?.from === "table" ? "table" : "data", datasetId: config.samples?.datasetId ?? null, stepId: samplesDataset?.producer ?? null,
      column: reads?.sampleList?.column ?? config.samples?.column ?? null, count: reads?.samples.length ?? 0,
      words: config.pinnedRunId ? `the samples of ${pinnedRun?.runNumber ?? "the pinned run"}` : reads?.words ?? "all samples in Data",
    },
    settings, settingsCount: settings.length, outputs, files: fileOutputsOf(config.pipelineId), stages: stagesOf(config.pipelineId),
    references: databases.map((database) => ({ id: database.id, label: database.label, installed: database.status === "downloaded", sizeBytes: database.sizeBytes ?? null })),
    preset, pinnedRun, newerRun, run,
    available: { installed, enabled: Boolean(config.pinnedRunId) || enabled, canStart: Boolean(config.pinnedRunId) || (installed && enabled && input.start.ok), words,
      request: request ? { id: request.id, status: request.status, requestedBy: request.requestedByName, at: request.createdAt.toISOString(), note: request.decisionNote } : null },
    readsChanged: context.readsChanged.get(step.id) ?? null,
    ...records96,
  };
}

async function recordExtras(step: RecipeStep, config: PipelineStepConfig, context: PipelineViewContext, results: string | null, flowRunNumber: number | null): Promise<Partial<PipelineStepView>> {
  if (config.requestId) return {};
  const [{ qualityOf, exclusionHome }, { pipelineMethodsOf }, { pipelineVersions }, { peekStoreLatest }, { pipelineRecord }, { exclusionWords }] = await Promise.all([
    import("./pipeline-quality"), import("./pipeline-methods"), import("./pipeline-compare"), import("./pipeline-lab"), import("./pipeline-record"), import("./sample-exclusions"),
  ]);
  const home = exclusionHome(context.model, step, config);
  const incremental = pipelineRecord(config.pipelineId).incremental;
  return {
    quality: config.pinnedRunId ? null : await qualityOf(context.model, step, config).catch(() => null),
    methods: await pipelineMethodsOf(context.model, step, results ? { results, revisionId: context.viewed.get(step.id)?.revisionId ?? null, flowRunNumber } : null).catch(() => null),
    versions: pipelineVersions(config, peekStoreLatest(config.pipelineId)),
    leftOut: home.exclusions.filter((entry) => entry.stage === "before" || !entry.stepId || entry.stepId === step.id).map((entry) => ({ sample: entry.sample, reason: entry.reason, stage: entry.stage, by: entry.by.name, at: entry.at, words: exclusionWords(entry) })),
    incremental: { allowed: incremental.allowed, words: incremental.reason },
  };
}
