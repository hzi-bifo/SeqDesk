/**
 * Structured value definitions: what a recorded metric counts, so a cited
 * number carries its own filters ("n_de: DE genes, trt vs untrt, padj < 0.05,
 * |log2FC| >= 1, DESeq2 1.50.2"). A step passes it with
 * `sx$metric(name, value, label =, definition = list(...))` (R) or
 * `sx.metric(name, value, label=, definition={...})` (Python); the helpers
 * write it into outputs/manifest.json under metricMeta.<key>.definition.
 * Client-safe (no imports).
 */

export const DEFINITION_OPS = ["<", "<=", ">", ">=", "==", "!=", "|x| >=", "|x| >", "|x| <", "|x| <="] as const;
export type DefinitionOp = (typeof DEFINITION_OPS)[number];

export interface MetricDefinitionFilter {
  /** The step parameter the filter reads (padj_cutoff), or a column when no parameter drives it. */
  param: string;
  op: DefinitionOp;
  value: number | string;
  /** What is compared, for people: "padj", "log2FC". Optional. */
  column?: string;
}

export interface MetricDefinition {
  label?: string;
  unit?: string;
  /** What is counted or measured: "DE genes". */
  what?: string;
  /** "dex: trt vs untrt". */
  contrast?: string;
  filters: MetricDefinitionFilter[];
  /** "Wald test, BH-adjusted". */
  test?: string;
  /** "DESeq2 1.50.2". */
  method?: string;
}

const text = (raw: unknown, max = 160): string | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const OP_ALIASES: Record<string, DefinitionOp> = { "=": "==", "abs>=": "|x| >=", "abs>": "|x| >", "abs<": "|x| <", "abs<=": "|x| <=", "|x|>=": "|x| >=", "|x|>": "|x| >", "|x|<": "|x| <", "|x|<=": "|x| <=", "≥": ">=", "≤": "<=" };

function parseOp(raw: unknown): DefinitionOp | null {
  if (typeof raw !== "string") return null;
  const compact = raw.trim();
  if ((DEFINITION_OPS as readonly string[]).includes(compact)) return compact as DefinitionOp;
  return OP_ALIASES[compact.replace(/\s+/g, "")] ?? null;
}

/** Keep only well-formed parts; null when nothing usable is left. */
export function parseMetricDefinition(raw: unknown): MetricDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const filters: MetricDefinitionFilter[] = [];
  const rawFilters = Array.isArray(entry.filters) ? entry.filters : entry.filters && typeof entry.filters === "object" ? [entry.filters] : [];
  for (const item of rawFilters.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const filter = item as Record<string, unknown>;
    const param = text(filter.param, 80);
    const op = parseOp(filter.op);
    const value = typeof filter.value === "number" && Number.isFinite(filter.value) ? filter.value : text(filter.value, 80);
    if (!param || !op || value === undefined) continue;
    const column = text(filter.column, 80);
    filters.push({ param, op, value, ...(column ? { column } : {}) });
  }
  const out: MetricDefinition = { filters };
  for (const key of ["label", "unit", "what", "contrast", "test", "method"] as const) {
    const value = text(entry[key], key === "unit" ? 40 : 160);
    if (value) out[key] = value;
  }
  return filters.length || out.what || out.contrast || out.test || out.method ? out : null;
}

const formatNumber = (value: number | string) => (typeof value === "number" ? String(value) : value);

/** "padj < 0.05", "|log2FC| ≥ 1". */
export function formatDefinitionFilter(filter: MetricDefinitionFilter): string {
  const subject = filter.column ?? filter.param.replace(/_cutoff$|_threshold$/, "");
  const pretty = (op: string) => op.replace(">=", "≥").replace("<=", "≤").replace("!=", "≠").replace("==", "=");
  if (filter.op.startsWith("|x|")) return `|${subject}| ${pretty(filter.op.slice(4))} ${formatNumber(filter.value)}`;
  return `${subject} ${pretty(filter.op)} ${formatNumber(filter.value)}`;
}

/** "trt vs untrt · padj < 0.05 · |log2FC| ≥ 1 · DESeq2 1.50.2". */
export function formatMetricDefinition(definition: MetricDefinition): string {
  return [definition.contrast, ...definition.filters.map(formatDefinitionFilter), definition.test, definition.method].filter(Boolean).join(" · ");
}
