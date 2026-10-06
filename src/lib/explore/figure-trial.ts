/**
 * Figure trials: run one step of a completed flow run again, with its code as
 * it is or with a proposed revision of its plotting code, on the exact input
 * files that run read, in the step's own environment and sandbox. A figure
 * trial is a trial run (kind "trial") with one step: it never becomes the
 * current run, writes no tables and leaves the recipe as it is. Its result
 * compares the new figure with the run's: the step's values and tables must
 * be unchanged, and the figure records (lib/figure/continualfig) must plot the
 * same data. Accepting it saves the code as the step's next revision.
 */
import path from "path";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createRevision, RevisionConflict } from "./analyses";
import { pinEnvironment } from "./environment-lock";
import { resolveReadyEnvironment } from "./environments";
import { flowRunChanged } from "./flow-events";
import { advanceFlowRun, planOf, runRecords, serializeFlowRunById, stepValues, type FlowActor, type FlowRunSummary, type PlanEntry } from "./flow-runs";

export type FigureTrialMode = "record" | "style";
const MAX_CODE = 400_000;

interface FigureTrialMeta {
  samples: 0;
  figure: { stepId: string; fromRunId: string; fromStepRunId: string; baseRevisionId: string; accepted?: { by: string | null; userId: string; at: string; revisionId: string; revisionNumber: number } };
}

function metaOf(run: { trialSample: Prisma.JsonValue }): FigureTrialMeta["figure"] | null {
  const figure = (run.trialSample as { figure?: FigureTrialMeta["figure"] } | null)?.figure;
  return figure && typeof figure.stepId === "string" ? figure : null;
}

export async function startFigureTrial(fromRunId: string, input: { stepId: string; code?: string | null; mode?: FigureTrialMode; requestId?: string; actor: FlowActor }): Promise<FlowRunSummary> {
  if (input.code !== undefined && input.code !== null && (typeof input.code !== "string" || !input.code.trim() || input.code.length > MAX_CODE)) throw flowError("invalid_request", "code must be the step's complete script.");
  if (input.requestId) {
    const existing = await db.exploreFlowRun.findUnique({ where: { requestId: input.requestId } });
    if (existing) return serializeFlowRunById(existing.id);
  }
  const loaded = await runRecords(fromRunId);
  if (!loaded) throw flowError("not_found", "Run not found");
  const { run: source, records, stepRuns } = loaded;
  if (source.status !== "completed") throw flowError("not_completed", "A figure can be tried only on a completed run.");
  const record = records.get(input.stepId);
  const entry = planOf(source).find((candidate) => candidate.analysisId === input.stepId);
  if (!record || !entry || record.status !== "completed") throw flowError("invalid_request", "This step did not complete in that run.");
  const stepRun = stepRuns.get(record.stepRunId);
  if (!stepRun?.runFolder) throw flowError("invalid_request", "The run folder of this step is gone, so its inputs cannot be read again.");
  const active = await db.exploreFlowRun.findFirst({ where: { flowId: source.flowId, status: { in: ["queued", "running"] } }, select: { kind: true, number: true, trialNumber: true } });
  if (active) throw flowError("run_active", active.kind === "trial" ? `Trial ${active.trialNumber} of this flow is still running. Wait for it or stop it first.` : `Run #${active.number ?? "?"} of this flow is still running. Wait for it or stop it first.`);
  // The same environment the step ran in: its base, or its derived `<base>+<key>` environment (built again if needed).
  if (!entry.packages && !(await resolveReadyEnvironment(entry.environmentName))) throw flowError("environment_missing", `Environment ${entry.environmentName} is not built yet.`, { environment: entry.environmentName });
  const plan: PlanEntry[] = [{
    ...entry,
    revisionId: record.revisionId,
    execute: true,
    dependsOn: [],
    reusedFrom: null,
    figureTrial: { inputsFrom: stepRun.id, codeOverride: input.code ?? null, continualfig: input.mode === "style" ? "style" : "record" },
  }];
  const environment = await pinEnvironment(entry.environmentName, entry.language).catch(() => null);
  const meta: FigureTrialMeta = { samples: 0, figure: { stepId: input.stepId, fromRunId: source.id, fromStepRunId: stepRun.id, baseRevisionId: record.revisionId } };
  const created = await db.$transaction(async (tx) => {
    const counter = await tx.exploreFlow.update({ where: { id: source.flowId }, data: { trialCounter: { increment: 1 } }, select: { trialCounter: true } });
    return tx.exploreFlowRun.create({
      data: {
        flowId: source.flowId, number: null, trialNumber: counter.trialCounter, kind: "trial",
        flowRevisionId: source.flowRevisionId, recipeRevision: source.recipeRevision, status: "queued",
        startedById: input.actor.userId, startedByMemberId: input.actor.memberId ?? null, startedByName: input.actor.name?.slice(0, 200) ?? null,
        stepCount: 1, doneCount: 0, plan: plan as unknown as Prisma.InputJsonValue,
        environment: environment ? (environment as unknown as Prisma.InputJsonValue) : undefined,
        trialSample: meta as unknown as Prisma.InputJsonValue, requestId: input.requestId ?? null,
      },
    });
  });
  await flowRunChanged(created.id, "queued");
  await advanceFlowRun(created.id);
  return serializeFlowRunById(created.id);
}

type FigureRecord = { data_rows?: number; data_summary?: unknown; [key: string]: unknown };

interface StepSide {
  stepRunId: string;
  status: string;
  code: string;
  figures: Array<{ name: string; png: string | null; svg: string | null; record: FigureRecord | null }>;
  values: Array<{ key: string; label: string; value: unknown }>;
  tables: Array<{ name: string; checksum: string | null }>;
  errorTail: string | null;
}

async function sideOf(stepRunId: string, codeOverride: string | null): Promise<StepSide> {
  const stepRun = await db.exploreAnalysisRun.findUnique({ where: { id: stepRunId }, select: { id: true, status: true, results: true, errorTail: true, revision: { select: { code: true } } } });
  if (!stepRun) throw flowError("not_found", "Step run not found");
  const artifacts = await db.exploreArtifact.findMany({ where: { runId: stepRunId }, select: { id: true, kind: true, format: true, name: true, path: true, checksum: true }, orderBy: { createdAt: "asc" } });
  const names = [...new Set(artifacts.filter((artifact) => artifact.kind === "figure").map((artifact) => artifact.name))];
  const url = (artifact?: { id: string }) => (artifact ? `explore/runs/${stepRunId}/artifacts/${artifact.id}` : null);
  const figures = await Promise.all(names.map(async (name) => {
    const own = artifacts.filter((artifact) => artifact.kind === "figure" && artifact.name === name);
    const any = own[0]!;
    const recordPath = path.join(path.dirname(any.path), `${path.basename(any.path).replace(/\.[^.]+$/, "")}.figure.json`);
    const record = await fs.readFile(recordPath, "utf8").then((text) => JSON.parse(text) as FigureRecord).catch(() => null);
    return { name, png: url(own.find((artifact) => artifact.format === "png")), svg: url(own.find((artifact) => artifact.format === "svg")), record };
  }));
  return {
    stepRunId, status: stepRun.status, code: codeOverride ?? stepRun.revision?.code ?? "",
    figures,
    values: stepValues(stepRun.results).map((value) => ({ key: value.key, label: value.label, value: value.value })),
    tables: artifacts.filter((artifact) => artifact.kind === "table").map((artifact) => ({ name: artifact.name, checksum: artifact.checksum })),
    errorTail: stepRun.errorTail,
  };
}

const close = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : JSON.stringify(a) === JSON.stringify(b));

function sameFrame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a.rows !== b.rows) return false;
  const ca = (a.columns ?? {}) as Record<string, Record<string, unknown>>;
  const cb = (b.columns ?? {}) as Record<string, Record<string, unknown>>;
  const shared = Object.keys(ca).filter((key) => key in cb);
  return shared.every((key) => ["n", "sum", "min", "max"].every((field) => close(ca[key]?.[field], cb[key]?.[field])));
}

/** Whether two figure records plot the same data; null when either has no data summary to compare. Pure. */
export function samePlottedData(before: FigureRecord | null, after: FigureRecord | null): boolean | null {
  const a = before?.data_summary as Record<string, unknown> | null | undefined;
  const b = after?.data_summary as Record<string, unknown> | null | undefined;
  if (!a || !b) return null;
  // R (ggplot2): the plot's data frame, its rows and every numeric column both sides have, then each layer's own data.
  if ("rows" in a || "rows" in b) {
    if (!sameFrame(a, b)) return false;
    // Layers that carry their own data (geom_point(data = ...)) are compared pairwise; layers only one side has are additions.
    if (Array.isArray(a.layers) && Array.isArray(b.layers)) {
      const count = Math.min(a.layers.length, b.layers.length);
      for (let index = 0; index < count; index += 1) {
        const la = a.layers[index] as Record<string, unknown>;
        const lb = b.layers[index] as Record<string, unknown>;
        if (la.inherited !== lb.inherited) return false;
        if (!la.inherited && !sameFrame(la, lb)) return false;
      }
    }
    return true;
  }
  // Python (matplotlib): per panel, the points and image cells and their sums.
  const pa = (a.axes ?? []) as Array<Record<string, number>>;
  const pb = (b.axes ?? []) as Array<Record<string, number>>;
  const total = (panels: Array<Record<string, number>>, key: string) => panels.reduce((sum, panel) => sum + (panel[key] ?? 0), 0);
  return ["points", "point_sum", "image_cells", "image_sum"].every((key) => close(total(pa, key), total(pb, key)));
}

/** The numbers check: the step's values and tables equal the run's, and each figure plots the same data. Pure. */
export function figureCheck(before: StepSide, after: StepSide) {
  const values = before.values.map((value) => {
    const other = after.values.find((candidate) => candidate.key === value.key);
    return { key: value.key, label: value.label, before: value.value, after: other?.value ?? null, same: !!other && close(value.value, other.value) };
  });
  const tables = before.tables.map((table) => {
    const other = after.tables.find((candidate) => candidate.name === table.name);
    return { name: table.name, same: !!other && !!table.checksum && table.checksum === other.checksum };
  });
  const figures = before.figures.map((figure) => {
    const other = after.figures.find((candidate) => candidate.name === figure.name);
    return { name: figure.name, drawn: !!other, sameData: other ? samePlottedData(figure.record, other.record) : false };
  });
  const same = values.every((value) => value.same) && tables.every((table) => table.same) && figures.every((figure) => figure.drawn && figure.sameData === true);
  // Unknown equivalence (no data summary, e.g. a heatmap) is not proof of the same data: it is reported, never passed.
  const unverified = figures.filter((figure) => figure.drawn && figure.sameData === null).map((figure) => figure.name);
  return { same, values, tables, figures, unverified };
}

export async function figureTrialResult(trialRunId: string) {
  const trial = await db.exploreFlowRun.findUnique({ where: { id: trialRunId } });
  const meta = trial ? metaOf(trial) : null;
  if (!trial || !meta) throw flowError("not_found", "Figure trial not found");
  const entry = planOf(trial)[0];
  const own = await db.exploreAnalysisRun.findFirst({ where: { flowRunId: trial.id, analysisId: meta.stepId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const before = await sideOf(meta.fromStepRunId, null);
  const after = own ? await sideOf(own.id, entry?.figureTrial?.codeOverride ?? null) : null;
  return {
    trial: { id: trial.id, trialNumber: trial.trialNumber, status: trial.status, failure: trial.failureWords, detail: trial.failureDetail },
    stepId: meta.stepId, fromRunId: meta.fromRunId, baseRevisionId: meta.baseRevisionId,
    mode: entry?.figureTrial?.continualfig ?? "record", proposed: entry?.figureTrial?.codeOverride !== null && entry?.figureTrial?.codeOverride !== undefined,
    environment: { name: entry?.environmentName ?? null, lockDigest: (trial.environment as { lockDigest?: string } | null)?.lockDigest ?? null },
    before, after,
    check: after && trial.status === "completed" ? figureCheck(before, after) : null,
    accepted: meta.accepted ?? null,
  };
}

/** "Use as final": the trial's code becomes the step's next revision, noting who accepted it. */
export async function acceptFigureTrial(trialRunId: string, actor: FlowActor) {
  const result = await figureTrialResult(trialRunId);
  const trial = await db.exploreFlowRun.findUnique({ where: { id: trialRunId } });
  const meta = trial ? metaOf(trial) : null;
  const code = planOf(trial!)[0]?.figureTrial?.codeOverride;
  if (!trial || !meta) throw flowError("not_found", "Figure trial not found");
  if (meta.accepted) return { revision: { id: meta.accepted.revisionId, number: meta.accepted.revisionNumber }, accepted: meta.accepted, flowId: trial.flowId };
  if (trial.status !== "completed" || !result.check) throw flowError("not_completed", "Only a completed figure trial can be used.");
  if (!result.check.same) {
    const unverified = result.check.unverified.length > 0;
    throw flowError("invalid_request", unverified
      ? `The plotted data of ${result.check.unverified.join(", ")} could not be compared, so the trial cannot replace the step's code.`
      : "The trial changed the step's numbers, so it cannot replace the step's code.");
  }
  if (!code) throw flowError("invalid_request", "This trial ran the step's code as it is; there is nothing to save.");
  const who = actor.name ?? "someone";
  // Settings may have been saved since (a new revision with the same code): the rewrite still applies to that code.
  const [analysis, base] = await Promise.all([
    db.exploreAnalysis.findUnique({ where: { id: meta.stepId }, select: { currentRevisionId: true } }),
    db.exploreAnalysisRevision.findUnique({ where: { id: meta.baseRevisionId }, select: { codeHash: true } }),
  ]);
  const current = analysis?.currentRevisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId }, select: { id: true, codeHash: true } }) : null;
  const expectedRevisionId = current && base && current.codeHash === base.codeHash ? current.id : meta.baseRevisionId;
  let revision;
  try {
    revision = await createRevision({
      analysisId: meta.stepId, code, expectedRevisionId,
      author: "user", authorUserId: actor.userId, authorMemberId: actor.memberId ?? null,
      message: `Improved figure from trial ${trial.trialNumber ?? ""}, accepted by ${who}`.replace(/\s+/g, " "),
    });
  } catch (error) {
    if (error instanceof RevisionConflict) throw flowError("revision_conflict", "The step's code changed since this trial started. Try the figure again on the new code.");
    throw error;
  }
  const accepted = { by: actor.name ?? null, userId: actor.userId, at: new Date().toISOString(), revisionId: revision.id, revisionNumber: revision.number };
  await db.exploreFlowRun.update({ where: { id: trial.id }, data: { trialSample: { samples: 0, figure: { ...meta, accepted } } as unknown as Prisma.InputJsonValue } });
  await flowRunChanged(trial.id, "progress");
  return { revision: { id: revision.id, number: revision.number }, accepted, flowId: trial.flowId };
}
