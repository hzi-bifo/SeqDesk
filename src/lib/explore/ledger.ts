/**
 * The data ledger of a step run: what the step did to the rows (and columns)
 * of its tables, built by the runner from what it staged, what the step wrote
 * and the `drop()` calls in the code. Without drops a line carries counts and
 * no reasons; reasons are never invented (FLOW-GAPS D16).
 */
import fs from "fs";
import readline from "readline";

export interface LedgerDims {
  rows: number;
  cols: number;
}

export interface LedgerReason {
  count: number;
  reason: string;
  axis: "rows" | "columns";
  keys: string[];
}

export interface LedgerLine {
  label: string;
  alias: string | null;
  output: string | null;
  in: LedgerDims | null;
  out: LedgerDims | null;
  samples: { in: number | null; out: number | null } | null;
  reasons: LedgerReason[];
}

export interface LedgerInput {
  alias: string;
  dims: LedgerDims | null;
  samples: number | null;
}

export interface LedgerOutput {
  name: string;
  dims: LedgerDims | null;
  samples: number | null;
}

export interface ManifestDrop {
  input?: unknown;
  count?: unknown;
  reason?: unknown;
  axis?: unknown;
  keys?: unknown;
}

/** Drops as the manifest carries them, cleaned: bad entries are skipped, not guessed at. */
export function parseDrops(raw: unknown): Array<LedgerReason & { input: string | null }> {
  if (!Array.isArray(raw)) return [];
  const drops: Array<LedgerReason & { input: string | null }> = [];
  for (const entry of raw.slice(0, 200) as ManifestDrop[]) {
    if (!entry || typeof entry !== "object") continue;
    const reason = typeof entry.reason === "string" ? entry.reason.trim().slice(0, 280) : "";
    const count = typeof entry.count === "number" && Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : null;
    if (!reason || count === null) continue;
    drops.push({
      input: typeof entry.input === "string" && entry.input ? entry.input : null,
      count,
      reason,
      axis: entry.axis === "columns" ? "columns" : "rows",
      keys: Array.isArray(entry.keys) ? entry.keys.filter((key): key is string => typeof key === "string").slice(0, 20).map((key) => key.slice(0, 200)) : [],
    });
  }
  return drops;
}

const strip = (drop: LedgerReason & { input: string | null }): LedgerReason => ({ count: drop.count, reason: drop.reason, axis: drop.axis, keys: drop.keys });

/**
 * Pair the step's inputs with its output tables. One input: every output
 * reads from it. Several: an output is paired with the input its drops name
 * when exactly one is named, otherwise it stands alone (counts only).
 * Inputs no output line uses get a line of their own when drops name them.
 */
export function buildLedger(inputs: LedgerInput[], outputs: LedgerOutput[], rawDrops: unknown): LedgerLine[] {
  const drops = parseDrops(rawDrops);
  const byAlias = new Map(inputs.map((input) => [input.alias, input] as const));
  const namedInputs = [...new Set(drops.map((drop) => drop.input).filter((alias): alias is string => Boolean(alias && byAlias.has(alias))))];
  const single = inputs.length === 1 ? inputs[0] : null;
  const pairedDefault = single ?? (namedInputs.length === 1 ? byAlias.get(namedInputs[0]) ?? null : null);
  const reasonsFor = (alias: string | null) => drops.filter((drop) => (single ? true : drop.input === alias)).map(strip);
  const lines: LedgerLine[] = [];
  const used = new Set<string>();
  for (const output of outputs) {
    const input = pairedDefault;
    if (input) used.add(input.alias);
    lines.push({
      label: input ? `${input.alias} → ${output.name}` : output.name,
      alias: input?.alias ?? null,
      output: output.name,
      in: input?.dims ?? null,
      out: output.dims,
      samples: input?.samples != null || output.samples != null ? { in: input?.samples ?? null, out: output.samples } : null,
      reasons: input ? reasonsFor(input.alias) : [],
    });
  }
  for (const input of inputs) {
    if (used.has(input.alias)) continue;
    const reasons = reasonsFor(input.alias);
    if (!reasons.length && outputs.length) continue;
    lines.push({ label: input.alias, alias: input.alias, output: null, in: input.dims, out: null, samples: input.samples != null ? { in: input.samples, out: null } : null, reasons });
  }
  // Drops that name no known input are kept on a line of their own, never merged into another table's story.
  const orphans = single ? [] : drops.filter((drop) => !drop.input || !byAlias.has(drop.input)).map(strip);
  if (orphans.length) lines.push({ label: "other", alias: null, output: null, in: null, out: null, samples: null, reasons: orphans });
  return lines;
}

const MAX_SCAN_BYTES = 200 * 1024 * 1024;

/**
 * Rows, columns and (when a sample column is named) distinct samples of a
 * tab-separated table, read line by line. Files over 200 MB are not scanned.
 */
export async function scanTable(filePath: string, options: { delimiter?: string; sampleColumn?: string | null } = {}): Promise<{ dims: LedgerDims; samples: number | null } | null> {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_SCAN_BYTES) return null;
  const delimiter = options.delimiter ?? "\t";
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  let sampleIndex = -1;
  let rows = 0;
  const samples = new Set<string>();
  try {
    for await (const line of lines) {
      if (header === null) {
        header = line.split(delimiter);
        sampleIndex = options.sampleColumn ? header.indexOf(options.sampleColumn) : -1;
        continue;
      }
      if (line === "") continue;
      rows += 1;
      if (sampleIndex >= 0) {
        const value = line.split(delimiter)[sampleIndex];
        if (value) samples.add(value);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (header === null) return null;
  return { dims: { rows, cols: header.length }, samples: sampleIndex >= 0 ? samples.size : null };
}
