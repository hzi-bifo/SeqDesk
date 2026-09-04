/**
 * Numeric and ordering helpers that reproduce the pandas / numpy / Python semantics
 * the INDIVO reference relies on. Each helper documents which reference operation
 * it mirrors, because the golden fixtures compare rounded values and tie orders and
 * a "close enough" implementation would drift at rounding boundaries.
 */

import type { SubjectTimelineCuration, SubjectTimelineRow } from "./types";

/** Text values INDIVO treats as missing after trimming (analysis._text_or_none / _site_value). */
const MISSING_TEXT = new Set(["", "none", "nan", "null", "undefined"]);

/** analysis._text_or_none: trimmed text, or null for empty / pandas-style missing sentinels. */
export function textOrNone(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return MISSING_TEXT.has(text.toLowerCase()) ? null : text;
}

/** analysis._site_label: the site text, or the literal "None" when no site metadata exists. */
export function siteLabel(value: string | null | undefined): string {
  return textOrNone(value) ?? "None";
}

/**
 * analysis._taxon_key / curation._name_key: strip + casefold. JavaScript has no
 * casefold(); toLowerCase() agrees with it for Latin-script taxon names (casefold
 * additionally maps a few special characters such as the German sharp s).
 */
export function taxonKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Python str ordering (code points). Array.prototype.sort's default compares UTF-16 code units. */
export function comparePyStrings(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const nextLeft = left.next();
    const nextRight = right.next();
    if (nextLeft.done) {
      return nextRight.done ? 0 : -1;
    }
    if (nextRight.done) {
      return 1;
    }
    const codeLeft = nextLeft.value.codePointAt(0) ?? 0;
    const codeRight = nextRight.value.codePointAt(0) ?? 0;
    if (codeLeft !== codeRight) {
      return codeLeft < codeRight ? -1 : 1;
    }
  }
}

export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedUnique<T>(values: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  return Array.from(new Set(values)).sort(compare);
}

/** Distinct values in first-seen order (Python dict.fromkeys). */
export function uniqueInOrder<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

/** Groups items by key, preserving first-seen key order and item order within a group. */
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey);
    if (group) {
      group.push(item);
    } else {
      groups.set(groupKey, [item]);
    }
  }
  return groups;
}

/**
 * pandas groupby sum / mean / transform("sum") (pandas/_libs/groupby.pyx group_sum,
 * group_mean): Kahan-compensated summation in row order. The compensation reset
 * mirrors GH#50367 (infinite inputs).
 */
export function kahanSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const y = value - compensation;
    const t = sum + y;
    compensation = t - sum - y;
    if (compensation !== compensation) {
      compensation = 0;
    }
    sum = t;
  }
  return sum;
}

/** pandas groupby mean: Kahan sum divided by the observation count. */
export function kahanMean(values: readonly number[]): number {
  return kahanSum(values) / values.length;
}

/**
 * numpy add.reduce over a contiguous float64 axis (ndarray.sum() on a 1-D array or
 * the contiguous axis of a 2-D block): pairwise summation with a block size of 128
 * and an 8-way unrolled accumulator, seeded with the identity 0.0.
 */
export function numpySum(values: readonly number[]): number {
  return 0 + pairwiseSum(values, 0, values.length);
}

function pairwiseSum(values: readonly number[], start: number, n: number): number {
  if (n < 8) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      result += values[start + i];
    }
    return result;
  }
  if (n <= 128) {
    const partial = [
      values[start],
      values[start + 1],
      values[start + 2],
      values[start + 3],
      values[start + 4],
      values[start + 5],
      values[start + 6],
      values[start + 7],
    ];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) {
        partial[j] += values[start + i + j];
      }
    }
    let result =
      (partial[0] + partial[1] + (partial[2] + partial[3])) +
      (partial[4] + partial[5] + (partial[6] + partial[7]));
    for (; i < n; i++) {
      result += values[start + i];
    }
    return result;
  }
  let half = Math.floor(n / 2);
  half -= half % 8;
  return pairwiseSum(values, start, half) + pairwiseSum(values, start + half, n - half);
}

/**
 * DataFrame.sum(axis=1) on a single float block (the "Other" columns of the
 * composition pivots): numpy accumulates sequentially across the columns when the
 * frame has two or more rows (the reduction axis is strided), but a single-row frame
 * is a contiguous 1-D reduction and uses the pairwise algorithm.
 */
export function frameRowSum(rowValues: readonly number[], nRows: number): number {
  if (nRows <= 1) {
    return numpySum(rowValues);
  }
  let total = 0;
  for (const value of rowValues) {
    total += value;
  }
  return total;
}

const FLOAT_VIEW = new DataView(new ArrayBuffer(8));

function decompose(value: number): { negative: boolean; mantissa: bigint; exponent: number } {
  FLOAT_VIEW.setFloat64(0, value);
  const high = FLOAT_VIEW.getUint32(0);
  const low = FLOAT_VIEW.getUint32(4);
  const negative = high >>> 31 === 1;
  const biased = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << BigInt(32)) | BigInt(low);
  let exponent: number;
  if (biased === 0) {
    exponent = -1074;
  } else {
    mantissa |= BigInt(1) << BigInt(52);
    exponent = biased - 1075;
  }
  return { negative, mantissa, exponent };
}

/**
 * Python's round(x, ndigits) for floats: round-half-to-even applied to the EXACT
 * binary value of x (CPython formats with _Py_dg_dtoa mode 3 and parses back), so
 * 0.45 rounds to 0.5 (its double is slightly above 0.45) while an exact tie such as
 * 0.125 rounds to 0.12. This differs from Math.round (half up) and from numpy's
 * round (which scales first, see numpyRound). Negative ndigits round to tens etc.
 */
export function pyRound(value: number, ndigits: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }
  const { negative, mantissa, exponent } = decompose(value);
  // value * 10^ndigits as the exact fraction numerator / denominator
  let numerator = mantissa;
  let denominator = BigInt(1);
  if (exponent >= 0) {
    numerator <<= BigInt(exponent);
  } else {
    denominator <<= BigInt(-exponent);
  }
  if (ndigits >= 0) {
    numerator *= BigInt(10) ** BigInt(ndigits);
  } else {
    denominator *= BigInt(10) ** BigInt(-ndigits);
  }
  let quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * BigInt(2);
  if (
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && quotient % BigInt(2) === BigInt(1))
  ) {
    quotient += BigInt(1);
  }
  const magnitude =
    ndigits >= 0
      ? Number(`${quotient}e-${ndigits}`)
      : Number(quotient * BigInt(10) ** BigInt(-ndigits));
  return negative ? -magnitude : magnitude;
}

/** numpy rint: round half to even on the value itself; a zero result keeps the sign of the input. */
export function rint(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const floor = Math.floor(value);
  const fraction = value - floor;
  let result: number;
  if (fraction < 0.5) {
    result = floor;
  } else if (fraction > 0.5) {
    result = floor + 1;
  } else {
    result = floor % 2 === 0 ? floor : floor + 1;
  }
  if (result === 0 && (value < 0 || Object.is(value, -0))) {
    return -0;
  }
  return result;
}

/**
 * numpy.round / Series.round(decimals): rint(x * 10^decimals) / 10^decimals. The
 * scaling happens in floating point, so 1.115 becomes 1.12 here but 1.11 in Python's
 * round(); INDIVO uses this variant for the stacked / series arrays.
 */
export function numpyRound(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return rint(value * factor) / factor;
}

/**
 * analysis._read_count: float(f"{x:.12g}") (12 significant digits, half-even on the
 * exact value); non-finite input yields the fallback. Integer-valued results are
 * plain numbers either way in JavaScript.
 */
export function readCount(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value === 0) {
    return 0;
  }
  const exponent10 = Number(Math.abs(value).toExponential().split("e")[1]);
  return pyRound(value, 11 - exponent10);
}

/** A clinical row with its within-library relative abundance (percent). */
export interface MicrobiomeRow extends SubjectTimelineRow {
  ra: number;
}

/**
 * analysis.microbiome: drop curated artifacts and non-positive counts, then
 * renormalize RA = 100 * count / sum(count) within each library (pandas transform("sum")
 * is Kahan-compensated in row order; the division order (100 * count) / total matters).
 */
export function microbiome(
  rows: readonly SubjectTimelineRow[],
  curation: SubjectTimelineCuration,
): MicrobiomeRow[] {
  const artifacts = new Set(curation.artifacts.map(taxonKey));
  const kept = rows.filter((row) => row.count > 0 && !artifacts.has(taxonKey(row.taxon)));
  const totals = new Map<string, number>();
  for (const [sample, group] of groupBy(kept, (row) => row.sample)) {
    totals.set(
      sample,
      kahanSum(group.map((row) => row.count)),
    );
  }
  return kept.map((row) => {
    const total = totals.get(row.sample) ?? 0;
    return { ...row, ra: total > 0 ? (100 * row.count) / total : 0 };
  });
}

/**
 * analysis.top_taxa on the cohort: taxa ranked by their summed RA over every
 * library (pandas groupby sum, Kahan in row order), descending. The reference sorts
 * with an unstable quicksort; exact ties are broken here by taxon name so the result
 * is deterministic.
 */
export function topTaxa(rows: readonly MicrobiomeRow[], k: number): string[] {
  if (k <= 0) {
    return [];
  }
  const totals = new Map<string, number>();
  for (const [taxon, group] of groupBy(rows, (row) => row.taxon)) {
    totals.set(taxon, kahanSum(group.map((row) => row.ra)));
  }
  return Array.from(totals.entries())
    .sort((a, b) => compareNumbers(b[1], a[1]) || comparePyStrings(a[0], b[0]))
    .slice(0, k)
    .map(([taxon]) => taxon);
}

/** Equal-library mean profiles per day (the pivot_table -> groupby(level).mean() step). */
export interface DailyProfiles {
  /** sorted collection days that have at least one retained library */
  days: number[];
  /** pivot columns: every taxon of the rows, Python-sorted */
  taxa: string[];
  /** days x taxa mean RA over the day's libraries (absent taxa contribute 0) */
  matrix: number[][];
  /** distinct libraries per day, aligned with `days` */
  librariesByDay: number[];
}

interface LibraryProfile {
  day: number;
  sample: string;
  cells: Map<string, number[]>;
}

/**
 * pivot_table(index=[relDay, id_mapped], columns=taxonName, values=RA, aggfunc="sum",
 * fill_value=0.0).groupby(level="relDay").mean(): duplicate cells are Kahan-summed in
 * row order, libraries are ordered by (day, sample id) and each day's mean is a Kahan
 * sum over that ordered library list (explicit zeros included) divided by the count.
 */
export function dailyMeanProfiles(rows: readonly MicrobiomeRow[]): DailyProfiles {
  const taxa = sortedUnique(
    rows.map((row) => row.taxon),
    comparePyStrings,
  );
  const libraries = new Map<string, LibraryProfile>();
  for (const row of rows) {
    const key = `${row.timepoint} ${row.sample}`;
    let library = libraries.get(key);
    if (!library) {
      library = { day: row.timepoint, sample: row.sample, cells: new Map() };
      libraries.set(key, library);
    }
    const cell = library.cells.get(row.taxon);
    if (cell) {
      cell.push(row.ra);
    } else {
      library.cells.set(row.taxon, [row.ra]);
    }
  }
  const ordered = Array.from(libraries.values()).sort(
    (a, b) => compareNumbers(a.day, b.day) || comparePyStrings(a.sample, b.sample),
  );
  const dense = ordered.map((library) =>
    taxa.map((taxon) => {
      const cell = library.cells.get(taxon);
      return cell ? kahanSum(cell) : 0;
    }),
  );
  const days: number[] = [];
  const matrix: number[][] = [];
  const librariesByDay: number[] = [];
  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (end < ordered.length && ordered[end].day === ordered[start].day) {
      end += 1;
    }
    const block = dense.slice(start, end);
    days.push(ordered[start].day);
    librariesByDay.push(block.length);
    matrix.push(taxa.map((_, column) => kahanMean(block.map((values) => values[column]))));
    start = end;
  }
  return { days, taxa, matrix, librariesByDay };
}

/**
 * pivot_table(index=relDay, columns=taxonName, values=numReads, aggfunc="sum",
 * fill_value=0): reads per day and taxon, Kahan-summed in row order.
 */
export function readsByDay(
  rows: readonly MicrobiomeRow[],
  days: readonly number[],
  taxa: readonly string[],
): number[][] {
  const cells = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.timepoint} ${row.taxon}`;
    const cell = cells.get(key);
    if (cell) {
      cell.push(row.count);
    } else {
      cells.set(key, [row.count]);
    }
  }
  return days.map((day) =>
    taxa.map((taxon) => {
      const cell = cells.get(`${day} ${taxon}`);
      return cell ? kahanSum(cell) : 0;
    }),
  );
}

/**
 * analysis._bc_similarity: 1 - sum|x - y| / (sum x + sum y) over the sorted union of
 * taxa (missing taxa count as 0), or null when both profiles are empty. The three
 * sums are numpy reductions (pairwise).
 */
export function brayCurtisSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number | null {
  const union = sortedUnique([...a.keys(), ...b.keys()], comparePyStrings);
  const x = union.map((taxon) => a.get(taxon) ?? 0);
  const y = union.map((taxon) => b.get(taxon) ?? 0);
  const total = numpySum(x) + numpySum(y);
  if (!(total > 0)) {
    return null;
  }
  const distance = numpySum(x.map((value, index) => Math.abs(value - y[index])));
  return 1 - distance / total;
}

/** Index of the first maximum (pandas idxmax / numpy argmax semantics), -1 when empty. */
export function firstArgMax(values: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (best < 0 || values[i] > values[best]) {
      best = i;
    }
  }
  return best;
}
