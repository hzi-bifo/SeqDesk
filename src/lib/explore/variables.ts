/**
 * Variables a report can cite: the numbers every analysis step records with
 * its run (`sx.metric("n_samples", 874)`), addressed as `step.metric` where
 * the step part is the step's name as a slug. Text blocks cite them R-style,
 * `` `r cohort_overview.n_samples` ``, with an optional number of decimals,
 * `` `r beta_diversity.permanova_group_p | 3` ``.
 */
import type { ReportAnalysis } from "./reports";

export type VariableValue = string | number | boolean | null;

export interface VariableStep extends ReportAnalysis {
  slug: string;
}

export interface ReportVariables {
  steps: VariableStep[];
  bySlug: Map<string, VariableStep>;
}

export interface VariableRef {
  step: string;
  metric: string;
  digits: number | null;
}

export interface ResolvedVariable {
  ref: VariableRef;
  step: VariableStep | null;
  found: boolean;
  value: VariableValue | undefined;
  /** What the page shows: the formatted value, or the reference marked as unknown. */
  text: string;
}

/** "Cohort overview" -> "cohort_overview": readable in Markdown, stable across spaces and case. */
export function stepSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "step";
}

/** The steps of a report with unique slugs; a second "Alpha diversity" becomes alpha_diversity_2. */
export function buildVariables(analyses: ReportAnalysis[]): ReportVariables {
  const steps: VariableStep[] = [];
  const bySlug = new Map<string, VariableStep>();
  for (const analysis of analyses) {
    const base = stepSlug(analysis.name);
    let slug = base;
    for (let index = 2; bySlug.has(slug); index += 1) slug = `${base}_${index}`;
    const step: VariableStep = { ...analysis, slug };
    steps.push(step);
    bySlug.set(slug, step);
  }
  return { steps, bySlug };
}

const REF_PATTERN = /^r\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(?:\|\s*(\d))?\s*$/;

/** The inside of an inline code span, such as "r cohort_overview.n_samples | 2"; null when it is ordinary code. */
export function parseVariableRef(text: string): VariableRef | null {
  const match = text.trim().match(REF_PATTERN);
  if (!match) return null;
  return { step: match[1].toLowerCase(), metric: match[2], digits: match[3] === undefined ? null : Number(match[3]) };
}

export function formatVariableValue(value: VariableValue | undefined, digits: number | null = null): string {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "n/a";
    if (digits !== null) return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
    return Number(value.toPrecision(4)).toString();
  }
  return String(value);
}

/** Resolve one inline code span against the report's variables; null when it is not a variable reference. */
export function resolveVariable(text: string, variables: ReportVariables): ResolvedVariable | null {
  const ref = parseVariableRef(text);
  if (!ref) return null;
  const step = variables.bySlug.get(ref.step) ?? null;
  // Metric names keep their case (permanova_group_R2), but a citation may not.
  const key = step ? (Object.prototype.hasOwnProperty.call(step.metrics, ref.metric) ? ref.metric : Object.keys(step.metrics).find((name) => name.toLowerCase() === ref.metric.toLowerCase())) : undefined;
  const found = Boolean(step && key !== undefined);
  const value = found && step && key !== undefined ? step.metrics[key] : undefined;
  return { ref, step, found, value, text: found ? formatVariableValue(value, ref.digits) : `?${ref.step}.${ref.metric}` };
}

/** The Markdown to write for a variable: `` `r step.metric` ``. */
export function variableReference(step: VariableStep, metric: string): string {
  return `\`r ${step.slug}.${metric}\``;
}

const INLINE_CODE = /`([^`\n]+)`/g;

/** Replace every variable reference in Markdown with its value, for renderers without a custom code element. */
export function resolveVariablesInMarkdown(markdown: string, variables: ReportVariables): string {
  return markdown.replace(INLINE_CODE, (whole, inner: string) => {
    const resolved = resolveVariable(inner, variables);
    return resolved ? resolved.text : whole;
  });
}
