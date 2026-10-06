/**
 * A pencil step's inputs as step inputs when it is accepted. The assistant names what a step reads in words ("metadata
 * v1", "Sample counts by diagnosis"): a table of the study, an output of a recipe step, or an output of another pencil
 * step of the same flow. Typed references (datasetId, from, fromProposal) pass through; a bare name is resolved here,
 * so a drafted step can be added without a person rewiring it first.
 */
import { flowError } from "@/lib/integration/flow-contract";
import type { AddStepInput } from "./recipe-edit";

export interface ProposalInputContext {
  /** The study's tables the recipe knows: Data tables (no producer) and step outputs (producer + artifactName). */
  datasets: Array<{ id: string; name: string; producer: string | null; artifactName: string | null }>;
  /** The flow's steps: a step output is read only from one of them. */
  stepIds: Set<string>;
  /** Tables the flow already reads (its steps' inputs and its named Data inputs): matched before the rest of the study. */
  flowDatasetIds: Set<string>;
  /** Other step proposals of the flow, the same goal's first. */
  siblings: Array<{ id: string; purpose: string; state: string; acceptedAnalysisId: string | null; outputs: unknown }>;
}

type Ref = { alias?: unknown; name?: unknown; datasetId?: unknown; from?: { stepId?: unknown; output?: unknown }; fromProposal?: { proposalId?: unknown; output?: unknown } };

const ALIAS = /^[a-z][a-z0-9_]{0,39}$/;

/** Words to compare names by: "metadata v1" and "metadata" match, so do "Sample counts by diagnosis" and sample_counts_by_diagnosis. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+v\d+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** An output name a step can write ("Sample counts by diagnosis" → sample_counts_by_diagnosis). */
export function outputNameOf(name: string): string {
  return name.trim().toLowerCase().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "table";
}

function outputsOf(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).map((entry) => (entry && typeof entry === "object" ? (entry as { name?: unknown }).name : null)).filter((name): name is string => typeof name === "string" && !!name.trim());
}

/** One named input: an output of another pencil step (accepted: its step; pending: refused until it is), a step output,
 *  else a Data table. */
export function resolveNamedInput(name: string, ctx: ProposalInputContext): { datasetId: string } | { from: { stepId: string; output: string } } {
  const key = nameKey(name);
  if (!key) throw flowError("invalid_request", "A proposed input has no name.");
  for (const sibling of ctx.siblings) {
    const output = outputsOf(sibling.outputs).find((candidate) => nameKey(candidate) === key);
    if (!output) continue;
    if (sibling.state === "accepted" && sibling.acceptedAnalysisId && ctx.stepIds.has(sibling.acceptedAnalysisId)) return { from: { stepId: sibling.acceptedAnalysisId, output: outputNameOf(output) } };
    if (sibling.state === "pending") throw flowError("output_not_ready", `Accept "${sibling.purpose || "the step it reads from"}" first: this step reads its ${output}.`, { stepId: null, output, proposalId: sibling.id });
  }
  const produced = ctx.datasets.find((dataset) => dataset.producer && ctx.stepIds.has(dataset.producer) && dataset.artifactName && (nameKey(dataset.artifactName) === key || nameKey(dataset.name) === key));
  if (produced) return { from: { stepId: produced.producer!, output: produced.artifactName! } };
  const tables = ctx.datasets.filter((dataset) => !dataset.producer && nameKey(dataset.name) === key);
  const data = tables.find((dataset) => ctx.flowDatasetIds.has(dataset.id)) ?? (tables.length === 1 ? tables[0] : undefined);
  if (data) return { datasetId: data.id };
  if (tables.length > 1) throw flowError("invalid_request", `This step reads “${name}”, and the study has ${tables.length} tables of that name. Add the one you mean to the analysis’s Data first.`);
  throw flowError("invalid_request", `This step reads “${name}”, which is not a table in this analysis. Edit what it reads, or discard it.`);
}

/** Proposal inputs as addStep inputs. A pencil step reading another one needs that one accepted first. An alias that
 *  is not a short snake_case name is left out, and addStep names the input after its table. */
export function proposalStepInputs(raw: unknown, ctx: ProposalInputContext): AddStepInput["inputs"] {
  const inputs: AddStepInput["inputs"] = [];
  for (const entry of (Array.isArray(raw) ? raw : []) as Ref[]) {
    if (!entry || typeof entry !== "object") throw flowError("invalid_request", "Each proposed input must be an object.");
    const label = typeof entry.alias === "string" ? entry.alias : typeof entry.name === "string" ? entry.name : "";
    const alias = typeof entry.alias === "string" && ALIAS.test(entry.alias) ? { alias: entry.alias } : {};
    if (typeof entry.datasetId === "string") inputs.push({ ...alias, datasetId: entry.datasetId });
    else if (entry.from && typeof entry.from.stepId === "string" && typeof entry.from.output === "string") inputs.push({ ...alias, from: { stepId: entry.from.stepId, output: entry.from.output } });
    else if (entry.fromProposal && typeof entry.fromProposal.proposalId === "string" && typeof entry.fromProposal.output === "string") {
      const upstream = ctx.siblings.find((sibling) => sibling.id === (entry.fromProposal!.proposalId as string));
      if (!upstream?.acceptedAnalysisId) throw flowError("output_not_ready", `Accept "${upstream?.purpose || "the step it reads from"}" first.`, { stepId: null, output: entry.fromProposal.output, proposalId: entry.fromProposal.proposalId });
      inputs.push({ ...alias, from: { stepId: upstream.acceptedAnalysisId, output: entry.fromProposal.output } });
    } else if (label) inputs.push({ ...alias, ...resolveNamedInput(label, ctx) });
    else throw flowError("invalid_request", "Each proposed input needs a name, a datasetId, from or fromProposal.");
  }
  // Two names for one table read it once.
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = input.datasetId ?? `${input.from?.stepId}:${input.from?.output}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
