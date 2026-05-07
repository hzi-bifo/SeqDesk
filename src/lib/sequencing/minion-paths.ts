import path from "path";

/**
 * MinKNOW writes basecalled FASTQs into format-specific subdirectories of the
 * run output folder. Depending on protocol settings the layout can be any of:
 *
 *   <run>/fastq_pass/barcode01/FAS00000_pass_barcode01_<short_pr>_<short_run>_0.fastq.gz
 *   <run>/fastq_pass/<sample-alias>/FAS00000_pass_<alias>_<short_pr>_<short_run>_0.fastq.gz
 *   <run>/fastq_pass/unclassified/FAS00000_pass_unclassified_<short_pr>_<short_run>_0.fastq.gz
 *   <run>/fastq_pass/FAS00000_pass_<short_pr>_<short_run>_0.fastq.gz   # non-barcoded run
 *   <run>/fastq_fail/...                                                 # quality-failed reads
 *   <run>/fastq_skip/...                                                 # un-basecalled (e.g. modbase skip)
 *
 * With data-pooling enabled, the run folder may collapse and the layout starts
 * directly at `fastq_pass/...` under `<protocol_group>/<sample>/`.
 *
 * Filenames follow the ONT pattern:
 *   <flow_cell>_<basecall_status>_<alias>_<short_protocol_run>_<short_run>_<batch>.fastq.gz
 * where `<alias>` is omitted on non-barcoded runs and `_pass`/`_fail`/`_skip`
 * indicates the basecall status. Duplex builds add a `_duplex` suffix.
 */

export type FastqTier = "pass" | "fail" | "skip";

export interface MinknowFilenameParts {
  flowCellId: string | null;
  basecallStatus: FastqTier | null;
  duplex: boolean;
  alias: string | null;
  shortProtocolRunId: string | null;
  shortRunId: string | null;
  batchNumber: number | null;
}

export interface ParsedMinknowFastqPath {
  /** From the parent dir name (`fastq_pass` / `fastq_fail` / `fastq_skip`). */
  tier: FastqTier;
  /** Canonical barcode token (`barcode01`, `unclassified`) when the path identifies one, else `null`. */
  barcode: string | null;
  /** Raw subdir name when it doesn't match a barcode shape (e.g. user-supplied alias). */
  barcodeAlias: string | null;
  /** True when the file lives in a barcode/alias subdir; false when it is directly under `fastq_pass/`. */
  hasBarcodeDir: boolean;
  /** Parsed pieces of the filename itself. */
  filename: MinknowFilenameParts;
}

const TIER_DIRS: Record<string, FastqTier> = {
  fastq_pass: "pass",
  fastq_fail: "fail",
  fastq_skip: "skip",
};

const BARCODE_RE = /^barcode\d{2,4}$/i;
const UNCLASSIFIED_RE = /^unclassified$/i;
// ONT filename pattern; alias group is optional for non-barcoded runs.
//   <flowcell>_<status>[_duplex][_<alias>]_<shortProtocolRun>_<shortRun>_<batch>[.fastq[.gz]]
// Tolerate `_duplex` marker on the status (e.g. `pass_duplex`).
// Capture groups (positional — named groups need ES2018, project targets ES2017):
//   1: flowCellId, 2: basecallStatus, 3: duplex marker, 4: alias (optional),
//   5: shortProtocolRunId, 6: shortRunId, 7: batchNumber
const FILENAME_RE =
  /^([A-Z0-9]+)_(pass|fail|skip)(_duplex)?(?:_([A-Za-z0-9._-]+?))?_([a-z0-9]{4,})_([a-z0-9]{4,})_(\d+)(?:\.fastq(?:\.gz)?)?$/;

const KNOWN_EXTENSIONS = [".fastq.gz", ".fq.gz", ".fastq", ".fq"];

export function isFastqExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return KNOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Reduce any of `Barcode01`, `BC01`, `barcode001`, `unclassified` to a canonical token.
 * Returns `null` if the input doesn't look like a barcode dir name.
 */
export function normalizeBarcode(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (UNCLASSIFIED_RE.test(trimmed)) return "unclassified";
  if (BARCODE_RE.test(trimmed)) return trimmed.toLowerCase();
  // Some demultiplexers emit `BC01` — accept that shape too.
  const bcMatch = /^bc(\d{2,4})$/i.exec(trimmed);
  if (bcMatch) return `barcode${bcMatch[1]}`;
  return null;
}

export function parseMinknowFilename(fileName: string): MinknowFilenameParts {
  const empty: MinknowFilenameParts = {
    flowCellId: null,
    basecallStatus: null,
    duplex: false,
    alias: null,
    shortProtocolRunId: null,
    shortRunId: null,
    batchNumber: null,
  };
  const base = fileName.split("/").pop() ?? fileName;
  const match = FILENAME_RE.exec(base);
  if (!match) return empty;
  const [, flow, status, duplex, alias, shortPr, shortRun, batchStr] = match;
  const batch = Number.parseInt(batchStr ?? "", 10);
  return {
    flowCellId: flow ?? null,
    basecallStatus: (status as FastqTier | undefined) ?? null,
    duplex: Boolean(duplex),
    alias: alias ?? null,
    shortProtocolRunId: shortPr ?? null,
    shortRunId: shortRun ?? null,
    batchNumber: Number.isFinite(batch) ? batch : null,
  };
}

/**
 * Parse the full FASTQ path into structured metadata. Returns `null` when the
 * path does not contain a recognised tier directory (`fastq_pass` etc.) — the
 * caller can then decide to ignore the file or treat it as `UNMATCHED`.
 */
export function parseMinknowFastqPath(filePath: string): ParsedMinknowFastqPath | null {
  const parts = filePath.split(path.sep).filter(Boolean);
  if (parts.length < 2) return null;

  const fileName = parts[parts.length - 1];
  const filename = parseMinknowFilename(fileName);

  // Walk from the file end backwards looking for a recognised tier dir.
  for (let i = parts.length - 2; i >= 0; i--) {
    const segment = parts[i];
    const tier = TIER_DIRS[segment];
    if (!tier) continue;

    // Everything between the tier and the file is potential subdir content.
    // Standard MinKNOW only uses one level of subdir (the barcode/alias), so the
    // subdir is parts[i+1] when it isn't the file itself.
    const subdirRaw = i + 1 < parts.length - 1 ? parts[i + 1] : null;
    const hasSub = subdirRaw !== null && subdirRaw !== fileName;
    const normalizedFromDir = hasSub ? normalizeBarcode(subdirRaw) : null;

    if (hasSub && normalizedFromDir) {
      return {
        tier,
        barcode: normalizedFromDir,
        barcodeAlias: null,
        hasBarcodeDir: true,
        filename,
      };
    }
    if (hasSub) {
      // Subdir present but not a barcode shape — treat as alias dir.
      return {
        tier,
        barcode: null,
        barcodeAlias: subdirRaw,
        hasBarcodeDir: true,
        filename,
      };
    }
    // No subdir: non-barcoded run, file directly under fastq_<tier>/.
    return {
      tier,
      barcode: null,
      barcodeAlias: null,
      hasBarcodeDir: false,
      filename,
    };
  }
  return null;
}

/**
 * Backwards-compatible wrapper retained while the stream-monitor and call sites
 * migrate to {@link parseMinknowFastqPath}. Returns `null` for paths the new
 * parser can't classify; otherwise emits the legacy `{ barcode, pass }` shape
 * where `barcode` is set to `"no_barcode"` for non-barcoded runs (mirroring the
 * original behaviour).
 */
export function parseBarcodeFromPath(
  filePath: string,
): { barcode: string; pass: boolean } | null {
  const parsed = parseMinknowFastqPath(filePath);
  if (!parsed) return null;
  if (parsed.tier === "skip") return null;
  const pass = parsed.tier === "pass";
  if (parsed.barcode) return { barcode: parsed.barcode, pass };
  if (parsed.barcodeAlias) return { barcode: parsed.barcodeAlias.toLowerCase(), pass };
  return { barcode: "no_barcode", pass };
}
