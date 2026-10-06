/**
 * Words and steps, both ways (sheet 94): a change of ONE step that an edited
 * Methods sentence asks for (`explore.sentence-changes`).
 *
 * The web client asks the model through the collaboration server's AI route
 * (SeqDesk never calls one) and checks the answer; this module checks it again
 * before it is kept, so nothing unchecked is ever shown:
 * - every number written in the sentence is a setting (after the change), a
 *   value the step's run recorded, or was in the sentence before;
 * - settings are the step's own (or declared in its new code), of their kind,
 *   within their bounds and options;
 * - the new code reads and writes the same tables, and every package it names
 *   (`pkg::fn`, `library()`, `import`) is in the step's environment;
 * - only this step changes: the route is per step and a table it reads instead
 *   must be in Data or made by an earlier step.
 * The proposal is kept in pencil as a `step-change` proposal of the flow. On a
 * step another person checked on the current run it is a request to them:
 * only they accept it, and SeqDesk's notifications tell them. Accepting makes
 * a new revision (the step turns out of date; nothing runs) and keeps the
 * edited sentence; Undo makes the previous revision's code, settings and
 * tables a new revision again and puts the previous sentence back.
 */
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createRevision, parseInputBindings, RevisionConflict } from "./analyses";
import { readEnvironmentSpecs } from "./environments";
import { methodsAcceptedBy, type MethodsPerson } from "./methods-draft";
import { serializeProposal, type Proposal } from "./proposals";
import { loadRecipe, type RecipeActor } from "./recipe";
import { stepPackagesOf } from "./step-environments";
import { parseJsonObject } from "./schema";

const MAX_TEXT = 1000;
const MAX_CODE = 512 * 1024;
const TOKEN = /\{([A-Za-z0-9_]+)(?::?([%xf=]+))?\}%?/g;

type Value = string | number | boolean;
export type SentenceChangeInput = {
  before: string;
  after: string;
  baseRevisionId: string;
  params: Record<string, Value>;
  code: string | null;
  inputs: { alias: string; table: string }[];
  why: string;
  ignored: string[];
  alsoAffects: { label: string; words: string }[];
  checks: { ok: boolean; note?: boolean; text: string }[];
  model: string | null;
  prompt: string;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);

/** The body of POST analyses/:id/sentence-change, validated. */
export function parseSentenceChange(body: Record<string, unknown>): SentenceChangeInput {
  const before = typeof body.before === "string" ? body.before.trim() : "";
  const after = typeof body.after === "string" ? body.after.trim() : "";
  if (!after) throw flowError("invalid_request", "A sentence change needs the edited sentence (after).");
  if (before.length > MAX_TEXT || after.length > MAX_TEXT) throw flowError("invalid_request", "The methods sentence is too long.");
  const baseRevisionId = text(body.baseRevisionId, 80);
  if (!baseRevisionId) throw flowError("invalid_request", "baseRevisionId must name the step revision the edit started from.");
  const params: Record<string, Value> = {};
  if (body.params !== undefined && body.params !== null) {
    if (typeof body.params !== "object" || Array.isArray(body.params) || Object.keys(body.params).length > 20) throw flowError("invalid_request", "params must map at most 20 settings to values.");
    for (const [key, value] of Object.entries(body.params as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_]{1,80}$/.test(key)) throw flowError("invalid_request", `${key.slice(0, 80)} is not a setting name.`);
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") throw flowError("invalid_request", `${key} needs a number, text or yes/no.`);
      if (typeof value === "number" && !Number.isFinite(value)) throw flowError("invalid_request", `${key} needs a finite number.`);
      if (typeof value === "string" && value.length > 500) throw flowError("invalid_request", `${key} is too long.`);
      params[key] = value;
    }
  }
  if (body.code !== undefined && body.code !== null && typeof body.code !== "string") throw flowError("invalid_request", "code must be text.");
  const code = typeof body.code === "string" && body.code.trim() ? body.code : null;
  if (code && Buffer.byteLength(code, "utf8") > MAX_CODE) throw flowError("invalid_request", "The code is larger than 512 KB");
  const inputs = list(body.inputs, 5).map((raw) => ({ alias: text((raw as Record<string, unknown>)?.alias, 80), table: text((raw as Record<string, unknown>)?.table, 200) })).filter((i) => i.table);
  const checks = list(body.checks, 8).map((raw) => {
    const c = raw as Record<string, unknown>;
    return { ok: c?.ok !== false, ...(c?.note === true ? { note: true } : {}), text: text(c?.text, 300) };
  }).filter((c) => c.text);
  return {
    before, after, baseRevisionId, params, code, inputs, why: text(body.why, 300),
    ignored: list(body.ignored, 5).map((x) => text(x, 200)).filter(Boolean),
    alsoAffects: list(body.alsoAffects, 5).map((raw) => ({ label: text((raw as Record<string, unknown>)?.label, 20), words: text((raw as Record<string, unknown>)?.words, 300) })).filter((a) => a.words),
    checks, model: text(body.model, 120) || null, prompt: text(body.prompt, 12000),
  };
}

/** A sentence kept although its step does something else (◇), as stored on the sentence. */
export function parseMethodsMismatch(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const words = text(m.words, 300);
  if (!words) return null;
  const value = m.value;
  return {
    words,
    ...(text(m.previous, MAX_TEXT) ? { previous: text(m.previous, MAX_TEXT) } : {}),
    ...(typeof m.key === "string" && /^[A-Za-z0-9_]{1,80}$/.test(m.key) ? { key: m.key } : {}),
    ...((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean" || (typeof value === "string" && value.length <= 200) ? { value } : {}),
    ...(text(m.changeTo, 80) ? { changeTo: text(m.changeTo, 80) } : {}),
  };
}

/* ------------------------------------------------------------------ the checks */

/** The packages an environment spec lists ("- r-base=4.5.*" → "r-base"). */
export function specPackages(spec: string): string[] {
  const out: string[] = [];
  let inDeps = false;
  for (const line of spec.split("\n")) {
    if (/^dependencies\s*:/.test(line)) { inDeps = true; continue; }
    if (inDeps && /^\S/.test(line) && !/^\s*-/.test(line)) inDeps = false;
    const m = inDeps ? /^\s*-\s*([A-Za-z0-9_.-]+)/.exec(line) : null;
    if (m) out.push(m[1]!);
  }
  return out;
}
/** A package as code names it: "bioconductor-deseq2" → "deseq2", "r-vegan" → "vegan", "scikit-bio" → "skbio". */
export function codePackage(spec: string): string {
  const name = spec.trim().toLowerCase().replace(/^[\w-]+::/, "").replace(/[<>=!~ ].*$/, "").replace(/^(r-|bioconductor-)/, "");
  return ({ "scikit-bio": "skbio", "scikit-learn": "sklearn", "matplotlib-base": "matplotlib", "seaborn-base": "seaborn", "python-kaleido": "kaleido" } as Record<string, string>)[name] ?? name;
}
const R_BASE = new Set(["base", "stats", "utils", "graphics", "grdevices", "methods", "tools", "parallel", "splines", "stats4", "grid"]);
const PY_STDLIB = new Set(["math", "statistics", "json", "re", "os", "sys", "itertools", "collections", "functools", "random", "csv", "pathlib", "typing", "dataclasses", "datetime", "warnings", "string", "textwrap", "operator", "copy", "decimal", "fractions", "seqdesk_explore"]);

const stripped = (code: string) => code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""').replace(/#.*$/gm, "");
/** Tables the code reads and writes (sx.input / sx.output / sx.figure, R or Python). */
export function codeTables(code: string): { reads: string[]; writes: string[] } {
  const reads = [...code.matchAll(/(?:sx|seqdesk_explore)\s*(?:\$|\.)\s*input\(\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  const writes = [...code.matchAll(/(?:sx|seqdesk_explore)\s*(?:\$|\.)\s*(?:output|figure)\(\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  return { reads: [...new Set(reads)].sort(), writes: [...new Set(writes)].sort() };
}
/** Packages the code names: R `pkg::fn`, `library(pkg)`, `require(pkg)`; Python imports (their top module). */
export function namedPackages(code: string, language: string): string[] {
  if (language === "python") {
    const body = stripped(code);
    const out = [...body.matchAll(/^\s*import\s+([\w.]+)/gm), ...body.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)].map((m) => m[1]!.split(".")[0]!.toLowerCase());
    return [...new Set(out)];
  }
  const out = [...stripped(code).matchAll(/(?<![\w.$])([A-Za-z][\w.]*)::/g)].map((m) => m[1]!.toLowerCase());
  for (const m of code.matchAll(/(?:library|require|requireNamespace)\(\s*["']?([\w.]+)["']?/g)) out.push(m[1]!.toLowerCase());
  return [...new Set(out)];
}

const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/g;
const VERSION = /(?:\bversion\s+|\bv)(\d+(?:\.\d+)+)\b|(?<![\w.])(\d+\.\d+\.\d+(?:\.\d+)?)(?![\w.])/gi;
/** The numbers the words of a sentence state outside its `{key}` tokens (the tokens are settings and run values). */
export function literalNumbers(template: string): number[] {
  const words = template.replace(TOKEN, " ").replace(VERSION, " ");
  return (words.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
}
const forms = (value: unknown): number[] => (typeof value === "number" && Number.isFinite(value) ? [value, value * 100, Math.pow(2, value)] : []);
function grounded(n: number, candidates: number[]): boolean {
  return candidates.some((c) => {
    if (Math.abs(n - c) < 1e-9) return true;
    for (let k = 0; k <= 4; k++) { const f = Math.pow(10, k); if (Math.round(c * f) / f === n) return true; }
    return false;
  });
}

export type StepForCheck = {
  label: string; language: string; stepKind?: string;
  params: { key: string; value: unknown; label?: string; min?: number | null; max?: number | null; options?: unknown[] | null }[];
  code: string;
  runValues: unknown[];
  ledgerNumbers: number[];
  envPackages: string[];
};
export type CheckedSentenceChange = { problems: string[]; params: Record<string, { from: unknown; to: Value }>; codeChanged: boolean };

/** The server's own checks of a proposed change (see the module comment); `problems` empty means it may be kept. */
export function checkSentenceChange(input: Pick<SentenceChangeInput, "before" | "after" | "params" | "code" | "inputs">, step: StepForCheck, tables: Set<string>): CheckedSentenceChange {
  const problems: string[] = [];
  const params: CheckedSentenceChange["params"] = {};
  const newCode = input.code && input.code.trim() !== step.code.trim() ? input.code : null;
  if (newCode && step.stepKind === "pipeline") problems.push(`step ${step.label} is a pipeline step: it changes in its settings, not in code`);
  const declared = (key: string) => new RegExp(`(?:sx|seqdesk_explore)\\s*(?:\\$|\\.)\\s*param\\(\\s*["']${key}["']`).test(newCode ?? step.code);
  for (const [key, value] of Object.entries(input.params)) {
    const param = step.params.find((p) => p.key === key);
    const name = param?.label || key;
    if (!param && !declared(key)) { problems.push(`${key} is not a setting of step ${step.label}`); continue; }
    if (param && param.value !== null && param.value !== undefined && typeof param.value !== "object" && typeof param.value !== typeof value) { problems.push(`${name} needs ${typeof param.value === "number" ? "a number" : typeof param.value === "boolean" ? "yes or no" : "text"}`); continue; }
    if (param?.options?.length && !param.options.some((o) => String((o && typeof o === "object" ? (o as { value?: unknown }).value : o)) === String(value))) { problems.push(`${name} is one of ${param.options.map((o) => String(o && typeof o === "object" ? (o as { label?: unknown; value?: unknown }).label ?? (o as { value?: unknown }).value : o)).join(", ")}`); continue; }
    if (typeof value === "number" && typeof param?.min === "number" && value < param.min) { problems.push(`${name} must be at least ${param.min}`); continue; }
    if (typeof value === "number" && typeof param?.max === "number" && value > param.max) { problems.push(`${name} can be at most ${param.max}`); continue; }
    if (param && JSON.stringify(param.value) === JSON.stringify(value)) continue;
    params[key] = { from: param?.value ?? null, to: value };
  }
  const rebinds = input.inputs.filter((i) => i.table);
  for (const r of rebinds) if (!tables.has(r.table)) problems.push(`${r.table} is not a table in Data or made by an earlier step`);
  if (!Object.keys(params).length && !newCode && !rebinds.length) problems.push(`the change leaves step ${step.label} as it is`);
  // Numbers: settings after the change, recorded values, the ledger, and what the sentence said before.
  const merged = step.params.map((p) => (p.key in params ? params[p.key]!.to : p.value));
  const candidates = [...merged.flatMap(forms), ...Object.values(input.params).flatMap(forms), ...step.runValues.flatMap(forms), ...step.ledgerNumbers, ...literalNumbers(input.before)];
  const stray = literalNumbers(input.after).filter((n) => !grounded(n, candidates));
  if (stray.length) problems.push(`${[...new Set(stray)].map((n) => n.toLocaleString("en-GB")).join(", ")} in the sentence ${stray.length === 1 ? "is" : "are"} neither a setting nor a recorded value of step ${step.label}`);
  if (newCode) {
    const was = codeTables(step.code), now = codeTables(newCode);
    if (was.reads.join("|") !== now.reads.join("|")) problems.push(`the new code reads ${now.reads.join(", ") || "nothing"} instead of ${was.reads.join(", ") || "nothing"}; what a step reads changes in Reads › Change`);
    if (was.writes.join("|") !== now.writes.join("|")) problems.push(`the new code writes ${now.writes.join(", ") || "nothing"} instead of ${was.writes.join(", ") || "nothing"}; later steps read those tables`);
    const available = new Set(step.envPackages.map(codePackage));
    const before = new Set(namedPackages(step.code, step.language));
    for (const pkg of namedPackages(newCode, step.language).filter((p) => !before.has(p))) {
      const ok = step.language === "python" ? PY_STDLIB.has(pkg) || available.has(pkg) : R_BASE.has(pkg) || available.has(pkg);
      if (!ok) problems.push(`${pkg} is not in the step’s environment`);
    }
  }
  return { problems, params, codeChanged: !!newCode };
}

/* ------------------------------------------------------------------ the step as the check reads it */

async function stepForCheck(flowId: string, stepId: string) {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const step = model.steps.find((s) => s.id === stepId);
  if (!step) throw flowError("not_found", "That step is not part of this flow.");
  const label = model.labels.get(step.id) ?? "?";
  const values = parseJsonObject(step.revision?.params) ?? {};
  const meta = (step.paramMeta && typeof step.paramMeta === "object" ? step.paramMeta : {}) as Record<string, { label?: string; min?: number; max?: number; options?: unknown[] }>;
  const params = [...new Set([...Object.keys(values), ...Object.keys(meta)])].map((key) => ({ key, value: values[key] ?? null, label: meta[key]?.label, min: meta[key]?.min ?? null, max: meta[key]?.max ?? null, options: meta[key]?.options ?? null }));
  // What the step's latest finished run recorded (its values and ledger counts).
  const run = await db.exploreAnalysisRun.findFirst({ where: { analysisId: stepId, status: "completed" }, orderBy: { createdAt: "desc" }, select: { results: true } }).catch(() => null);
  const results = (() => { try { return run?.results ? JSON.parse(run.results) as Record<string, unknown> : {}; } catch { return {}; } })();
  const metrics = results.metrics && typeof results.metrics === "object" ? Object.values(results.metrics as Record<string, unknown>) : [];
  const ledger = Array.isArray(results.ledger) ? results.ledger : [];
  const ledgerNumbers = JSON.stringify(ledger).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  const specs = await readEnvironmentSpecs().catch(() => new Map<string, string>());
  const envPackages = [...specPackages(specs.get(step.environmentName) ?? ""), ...stepPackagesOf(step.packages).packages];
  // Tables it may read instead: the study's Data and what the steps before it make.
  const order = model.steps.map((s) => s.id);
  const earlier = new Set(order.slice(0, order.indexOf(stepId)));
  const tables = new Set<string>();
  for (const d of model.datasets.values()) {
    if (d.producer && !earlier.has(d.producer)) continue;
    tables.add(d.name);
    if (d.artifactName) tables.add(d.artifactName);
  }
  const check: StepForCheck = { label, language: step.language, stepKind: step.stepKind, params, code: step.revision?.code ?? "", runValues: metrics, ledgerNumbers, envPackages };
  return { model, step, label, check, tables };
}

/* ------------------------------------------------------------------ who checked the step */

type Person = { userId: string; memberId: string | null; name: string | null };
async function personOf(userId: string, memberId: string | null): Promise<Person> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }).catch(() => null);
  return { userId, memberId, name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null : null };
}
/** Another person's check on the step in the flow's current run (else the newest run that has one). */
export async function checkerOf(flowId: string, stepId: string, actor: RecipeActor): Promise<Person | null> {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { currentRunId: true } });
  const key = (runId: string) => `labdesk://run/${runId}#step/${stepId}`;
  const holds = await db.exploreRunHold.findMany({ where: { kind: "check", key: { endsWith: `#step/${stepId}` } }, orderBy: { createdAt: "desc" }, take: 20 });
  const mine = (h: { createdById: string; memberId: string | null }) => h.createdById === actor.userId || (!!actor.memberId && h.memberId === actor.memberId);
  const current = flow?.currentRunId ? holds.find((h) => h.key === key(flow.currentRunId!)) : undefined;
  const hold = current ?? holds.find((h) => h.key.startsWith("labdesk://run/"));
  if (!hold || mine(hold)) return null;
  return personOf(hold.createdById, hold.memberId);
}

async function notify(userId: string, data: { eventType: string; title: string; body: string | null; sourceId: string; dedupe: string }) {
  await db.inAppNotification.create({ data: { userId, eventType: data.eventType, severity: "info", sourceType: "step-change", sourceId: data.sourceId, dedupeKey: data.dedupe, title: data.title.slice(0, 200), body: data.body?.slice(0, 1000) ?? null } }).catch(() => undefined);
}

/* ------------------------------------------------------------------ propose, accept, undo */

/** Keeps a checked change of one step in pencil; an earlier pending change of the step is set aside. */
export async function proposeSentenceChange(stepId: string, input: SentenceChangeInput, actor: RecipeActor & { name?: string | null }): Promise<Proposal> {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { id: true, flowId: true, currentRevisionId: true, methodsSentence: true, name: true } });
  if (!analysis?.flowId) throw flowError("not_found", "This step is not part of an analysis.");
  if (analysis.currentRevisionId !== input.baseRevisionId) throw flowError("step_conflict", "This step changed since the sentence was edited. Read it again and edit once more.", { stepId, current: { revisionId: analysis.currentRevisionId } });
  // The words the edit started from must be the words the step has now (or its draft in pencil).
  const stored = analysis.methodsSentence && typeof analysis.methodsSentence === "object" ? String((analysis.methodsSentence as { text?: unknown }).text ?? "") : "";
  if (input.before && stored && stored.trim() !== input.before) {
    const draft = await db.exploreStepProposal.findFirst({ where: { flowId: analysis.flowId, kind: "methods", state: "pending", analysisId: stepId }, select: { text: true } });
    if ((draft?.text ?? "").trim() !== input.before) throw flowError("sentence_conflict", "Someone changed this sentence while it was being edited. Nothing was proposed.", { current: stored });
  }
  const { label, check, tables, model } = await stepForCheck(analysis.flowId, stepId);
  const checked = checkSentenceChange(input, check, tables);
  if (checked.problems.length) throw flowError("invalid_request", `The change did not pass its checks: ${checked.problems.join("; ")}.`, { problems: checked.problems });
  const inputs = input.inputs.map((i) => {
    const binding = model.steps.find((s) => s.id === stepId)?.bindings.find((b) => b.alias === i.alias);
    const dataset = [...model.datasets.values()].find((d) => d.name === i.table || d.artifactName === i.table);
    return { alias: i.alias, from: binding ? model.datasets.get(binding.datasetId)?.artifactName ?? model.datasets.get(binding.datasetId)?.name ?? i.alias : i.alias, to: i.table, datasetId: dataset?.id ?? null };
  });
  const requestTo = await checkerOf(analysis.flowId, stepId, actor);
  await db.exploreStepProposal.updateMany({ where: { flowId: analysis.flowId, kind: "step-change", state: "pending", analysisId: stepId }, data: { state: "discarded", discardReason: "Edited again" } });
  const changed = Object.fromEntries(Object.entries(checked.params).map(([k, v]) => [k, v.to]));
  const created = await db.exploreStepProposal.create({
    data: {
      flowId: analysis.flowId, kind: "step-change", state: "pending", analysisId: stepId, purpose: `Change step ${label} from its sentence`, why: input.why,
      text: input.after, code: checked.codeChanged ? input.code : null, language: check.language === "r" ? "r" : check.language === "shell" ? "shell" : "python",
      params: changed as Prisma.InputJsonValue,
      values: {
        before: input.before, baseRevisionId: input.baseRevisionId, baseCode: checked.codeChanged ? check.code : null,
        paramsBefore: Object.fromEntries(Object.entries(checked.params).map(([k, v]) => [k, v.from])), inputs, checks: input.checks, ignored: input.ignored,
        alsoAffects: input.alsoAffects, requestTo, model: input.model, prompt: input.prompt,
      } as unknown as Prisma.InputJsonValue,
      requestedById: actor.userId, requestedByMemberId: actor.memberId ?? null,
    },
  });
  if (requestTo) {
    const flow = await db.exploreFlow.findUnique({ where: { id: analysis.flowId }, select: { name: true } });
    await notify(requestTo.userId, { eventType: "step-change.request", sourceId: created.id, dedupe: `step-change:${created.id}:${requestTo.userId}`,
      title: `${actor.name || "A member"} asks to change step ${label} of ${flow?.name ?? "an analysis"}, which you checked`,
      body: [input.why, `“${input.after.replace(TOKEN, "…")}”`].filter(Boolean).join(" · ") });
  }
  return serializeProposal(created);
}

type StoredChange = { before?: string; baseRevisionId?: string; inputs?: { alias: string; to: string; datasetId: string | null }[]; requestTo?: Person | null; undo?: Record<string, unknown> };
const valuesOf = (proposal: { values: Prisma.JsonValue | null }) => (proposal.values && typeof proposal.values === "object" && !Array.isArray(proposal.values) ? proposal.values as unknown as StoredChange : {});

/** Before a pending change is claimed: a request is accepted only by the person it waits for. */
export function assertMayAccept(proposal: { values: Prisma.JsonValue | null }, actor: RecipeActor) {
  const to = valuesOf(proposal).requestTo;
  if (to && to.userId !== actor.userId && !(actor.memberId && to.memberId === actor.memberId))
    throw flowError("forbidden", `Only ${to.name || "the person who checked this step"} can accept this change: they checked the step, so it waits for them.`);
}

/** Applies an accepted change: a new revision of the step with the settings and code (and the tables it reads), then
 *  the edited sentence. The step turns out of date; nothing runs. Keeps what Undo needs on the proposal. */
export async function applySentenceChange(proposal: { id: string; flowId: string; analysisId: string | null; text: string | null; code: string | null; params: Prisma.JsonValue | null; values: Prisma.JsonValue | null; prompt?: string | null }, actor: RecipeActor & { name?: string | null }): Promise<{ stepId: string }> {
  const stepId = proposal.analysisId!;
  const stored = valuesOf(proposal);
  const { check, tables, label, step } = await stepForCheck(proposal.flowId, stepId);
  if (step.currentRevisionId !== stored.baseRevisionId) throw flowError("step_conflict", `Step ${label} changed after this change was proposed. Nothing was applied; edit the sentence again.`, { stepId, current: { revisionId: step.currentRevisionId } });
  const params = (proposal.params && typeof proposal.params === "object" && !Array.isArray(proposal.params) ? proposal.params : {}) as Record<string, Value>;
  const inputs = (stored.inputs ?? []).map((i) => ({ alias: i.alias, table: i.to }));
  const checked = checkSentenceChange({ before: stored.before ?? "", after: proposal.text ?? "", params, code: proposal.code, inputs }, check, tables);
  if (checked.problems.length) throw flowError("invalid_request", `The change does not pass its checks any more: ${checked.problems.join("; ")}. Nothing was applied.`, { problems: checked.problems });
  const previous = step.revision;
  const sentenceBefore = (await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { methodsSentence: true } }))?.methodsSentence ?? null;
  let revisionId = previous?.id ?? null;
  if (Object.keys(checked.params).length || checked.codeChanged) {
    try {
      const revision = await createRevision({
        analysisId: stepId, expectedRevisionId: previous?.id, code: checked.codeChanged ? proposal.code! : undefined,
        params: { ...(parseJsonObject(previous?.params) ?? {}), ...Object.fromEntries(Object.entries(checked.params).map(([k, v]) => [k, v.to])) },
        author: "agent", authorUserId: actor.userId, authorMemberId: actor.memberId ?? null, message: "From its sentence (accepted change)", prompt: null,
      });
      revisionId = revision.id;
    } catch (error) {
      if (error instanceof RevisionConflict) throw flowError("step_conflict", error.message, { stepId });
      throw error;
    }
  }
  if (inputs.length) {
    const { setStepInputs } = await import("./recipe-edit");
    const bindings = step.bindings.map((b) => {
      const change = (stored.inputs ?? []).find((i) => i.alias === b.alias);
      return change?.datasetId ? { alias: b.alias, datasetId: change.datasetId } : { alias: b.alias, datasetId: b.datasetId };
    });
    await setStepInputs(proposal.flowId, stepId, { inputs: bindings, expectedRevisionId: revisionId ?? undefined, actor });
    revisionId = (await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { currentRevisionId: true } }))?.currentRevisionId ?? revisionId;
  }
  const revision = revisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: revisionId }, select: { codeHash: true, params: true } }) : null;
  const now = parseJsonObject(revision?.params) ?? {};
  const keys = [...new Set([...(proposal.text ?? "").matchAll(TOKEN)].map((m) => m[1]!))];
  const by: MethodsPerson = { memberId: actor.memberId ?? null, name: actor.name ?? null };
  await db.exploreAnalysis.update({ where: { id: stepId }, data: { methodsSentence: {
    text: proposal.text ?? "", tokens: keys.filter((k) => k in now).map((key) => ({ key, value: now[key] ?? null })), revisionId, ...(revision?.codeHash ? { codeHash: revision.codeHash } : {}),
    author: "person", acceptedById: actor.userId, acceptedAt: new Date().toISOString(), ...methodsAcceptedBy(by),
  } as Prisma.InputJsonValue } });
  const undo = { previousRevisionId: previous?.id ?? null, acceptedRevisionId: revisionId, sentence: sentenceBefore };
  await db.exploreStepProposal.update({ where: { id: proposal.id }, data: { values: { ...(stored as Record<string, unknown>), undo } as Prisma.InputJsonValue } });
  return { stepId };
}

/** Tells the person who asked that the person who checked the step accepted or declined it. */
export async function tellRequester(proposal: { id: string; requestedById: string; analysisId: string | null; values: Prisma.JsonValue | null }, actor: RecipeActor & { name?: string | null }, accepted: boolean) {
  const to = valuesOf(proposal).requestTo;
  if (!to || proposal.requestedById === actor.userId) return;
  await notify(proposal.requestedById, { eventType: accepted ? "step-change.accepted" : "step-change.declined", sourceId: proposal.id, dedupe: `step-change:${proposal.id}:${accepted ? "accepted" : "declined"}`,
    title: `${actor.name || to.name || "The person who checked the step"} ${accepted ? "accepted" : "declined"} your change to a checked step`, body: null });
}

/** Undo of an accepted change: the previous revision's code, settings and tables as a new revision, and the previous
 *  sentence. Refused when the step changed again since. */
export async function undoSentenceChange(id: string, actor: RecipeActor): Promise<{ proposal: Proposal; stepId: string }> {
  const proposal = await db.exploreStepProposal.findUnique({ where: { id } });
  if (!proposal || proposal.kind !== "step-change") throw flowError("not_found", "Proposal not found");
  const undo = valuesOf(proposal).undo;
  if (proposal.state !== "accepted" || !undo) throw flowError("invalid_request", "Only an accepted change can be undone.");
  const stepId = proposal.analysisId!;
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { currentRevisionId: true } });
  if (!analysis) throw flowError("not_found", "This step is no longer in the recipe.");
  if (analysis.currentRevisionId !== undo.acceptedRevisionId) throw flowError("step_conflict", "The step changed again after the change was accepted. Nothing was undone; go back through the step’s versions.", { stepId, current: { revisionId: analysis.currentRevisionId } });
  const previous = typeof undo.previousRevisionId === "string" ? await db.exploreAnalysisRevision.findUnique({ where: { id: undo.previousRevisionId } }) : null;
  if (previous && previous.id !== analysis.currentRevisionId) {
    try {
      await createRevision({ analysisId: stepId, expectedRevisionId: analysis.currentRevisionId ?? undefined, code: previous.code, params: parseJsonObject(previous.params) ?? {}, inputs: parseInputBindings(previous.inputs),
        author: "user", authorUserId: actor.userId, authorMemberId: actor.memberId ?? null, message: `Undo: back to revision ${previous.number}` });
    } catch (error) {
      if (error instanceof RevisionConflict) throw flowError("step_conflict", error.message, { stepId });
      throw error;
    }
  }
  await db.exploreAnalysis.update({ where: { id: stepId }, data: { methodsSentence: (undo.sentence ?? PrismaRuntime.DbNull) as Prisma.InputJsonValue } });
  const updated = await db.exploreStepProposal.update({ where: { id }, data: { state: "undone", values: { ...(valuesOf(proposal) as Record<string, unknown>), undone: { by: actor.userId, at: new Date().toISOString() } } as Prisma.InputJsonValue } });
  return { proposal: serializeProposal(updated), stepId };
}
