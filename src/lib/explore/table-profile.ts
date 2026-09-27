/**
 * Provenance check for numeric matrices (count tables and their relatives). When a table is made from an
 * import or an upload, its number columns are profiled once: whole numbers or not, negative values, column
 * sums that are nearly equal (scaled to one library size), value ranges that look log-scaled. The finding is
 * kept on the dataset version (provenance.profile) and read back as one sentence with a short why, in Data
 * and in a recipe input's type check ("normalised, not raw counts").
 */

/** Bumped when the rules change, so stored findings are made again. */
export const PROFILE_VERSION = 2 as const;

export type TableProfileVerdict = "raw-counts" | "normalised" | "log-scale" | "signed";

export interface TableProfile {
  version: typeof PROFILE_VERSION;
  verdict: TableProfileVerdict;
  /** "raw counts, whole numbers" / "normalised, not raw counts" / "log-scaled, not raw counts" / … */
  sentence: string;
  /** Why, in a few words a person can check ("41% of values have decimals; column sums all ≈ 1,000,000"). */
  why: string;
  numericColumns: number;
  rows: number;
  wholeShare: number;
  negativeCount: number;
  min: number;
  max: number;
  /** Relative spread of column sums, (max − min) / median. */
  sumSpread: number | null;
}

type Column = { key: string; type: string; role?: string | null };

const NUMERIC = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
/** Delimited files keep cells as text; XLSX gives numbers. Both count. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && NUMERIC.test(value)) return Number(value);
  return null;
}

const fmt = (n: number) => Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : Number(n.toPrecision(3)).toString();
const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Profile the number columns of a table; null when it is not a matrix (fewer than two number columns, or
 * no numbers at all). `rows` should be all rows so column sums mean something.
 */
export function profileNumericMatrix(columns: Column[], rows: Array<Record<string, unknown>>): TableProfile | null {
  const numeric = columns.filter((column) => column.type === "number").map((column) => column.key);
  // A matrix is mostly number columns (one per sample) beside an id column or two; a sample sheet is not.
  const other = columns.length - numeric.length;
  if (numeric.length < 2 || numeric.length <= 2 * other || columns.some((column) => column.role === "sample") || rows.length === 0) return null;
  let count = 0;
  let whole = 0;
  let negative = 0;
  let min = Infinity;
  let max = -Infinity;
  const sums = numeric.map(() => 0);
  for (const row of rows) {
    numeric.forEach((key, index) => {
      const value = numberOf(row[key]);
      if (value === null) return;
      count += 1;
      if (Number.isInteger(value)) whole += 1;
      if (value < 0) negative += 1;
      if (value < min) min = value;
      if (value > max) max = value;
      sums[index] += value;
    });
  }
  if (count === 0) return null;
  const wholeShare = whole / count;
  const sorted = [...sums].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const sumSpread = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : null;
  const equalSums = sumSpread !== null && sumSpread < 0.02;
  const base = { version: PROFILE_VERSION, numericColumns: numeric.length, rows: rows.length, wholeShare, negativeCount: negative, min, max, sumSpread };

  if (wholeShare === 1 && negative === 0) {
    return { ...base, verdict: "raw-counts", sentence: "raw counts, whole numbers",
      why: `every value is a whole number of zero or more; column sums ${fmt(sorted[0])}–${fmt(sorted[sorted.length - 1])}` };
  }
  const decimals = `${pct(1 - wholeShare)} of values have decimals`;
  if (negative > 0) {
    // Negative values cannot be counts: log ratios, centred or log-transformed values.
    const logLike = max <= 30;
    return { ...base, verdict: logLike ? "log-scale" : "signed", sentence: logLike ? "log-scaled, not raw counts" : "transformed, not raw counts",
      why: `${fmt(negative)} negative value${negative === 1 ? "" : "s"} (min ${fmt(min)}, max ${fmt(max)})${logLike ? ", a range typical of log values" : ""}` };
  }
  if (max <= 30 && wholeShare < 0.5) {
    return { ...base, verdict: "log-scale", sentence: "log-scaled, not raw counts",
      why: `${decimals} and all values lie between ${fmt(min)} and ${fmt(max)}, a range typical of log values` };
  }
  return { ...base, verdict: "normalised", sentence: "normalised, not raw counts",
    why: equalSums
      ? `${decimals}; column sums are all ≈ ${fmt(median)}, scaled to one library size`
      : `${decimals}, so these are scaled values rather than read counts` };
}

/** The finding as one line: "Normalised, not raw counts: 98% of values have decimals; …". */
export function profileLine(profile: Pick<TableProfile, "sentence" | "why">): string {
  return `${profile.sentence.charAt(0).toUpperCase()}${profile.sentence.slice(1)}: ${profile.why}.`;
}

export function readProfile(provenance: unknown): TableProfile | null {
  let value = provenance;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const profile = value && typeof value === "object" ? (value as { profile?: unknown }).profile : null;
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Partial<TableProfile>;
  return p.version === PROFILE_VERSION && typeof p.sentence === "string" && typeof p.why === "string" && typeof p.verdict === "string" ? p as TableProfile : null;
}
