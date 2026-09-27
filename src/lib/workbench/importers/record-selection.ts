/**
 * File choice for the DOI-record connectors (figshare, Dryad, MGnify): every file of a record is listed, the
 * obvious data tables and small files are pre-ticked, and a person's ticks (`files`) replace that default.
 * Zenodo keeps its own copy of the same rules.
 */
import type { RecordAsset } from "./public-record-download";
import type { WorkbenchImportPreview } from "./types";
import { isDataTableName } from "./zenodo-record";

const DEFAULT_TABLE_MAX = 1024 ** 3;
const DEFAULT_OTHER_MAX = 5 * 1024 ** 2;

export function pickRecordFiles(all: RecordAsset[], options: {
  source: string;
  record: string;
  files?: string[];
  maxFiles: number;
  downloadable: boolean;
  /** Pre-tick rule when no ticks were given; default: data tables up to 1 GiB, other files up to 5 MiB. */
  preselect?: (asset: RecordAsset) => boolean;
}): { selected: RecordAsset[]; capped: boolean; choices: NonNullable<WorkbenchImportPreview["choices"]>; warnings: string[] } {
  const { files, maxFiles, downloadable, source } = options;
  if (files) {
    const unknown = files.filter(name => !all.some(asset => asset.filename === name));
    if (unknown.length) throw new Error(`${source} ${options.record} has no file named ${unknown.slice(0, 3).join(", ")}. Preview it again.`);
  }
  const preselect = options.preselect ?? ((asset: RecordAsset) => isDataTableName(asset.filename) ? asset.bytes <= DEFAULT_TABLE_MAX : asset.bytes > 0 && asset.bytes <= DEFAULT_OTHER_MAX);
  const candidates = files ? all.filter(asset => files.includes(asset.filename)) : all.filter(preselect);
  const chosen = files ? candidates : candidates.slice(0, maxFiles);
  const capped = downloadable && !files && candidates.length > chosen.length;
  const selected = downloadable ? chosen : [];
  const skipped = files ? [] : all.filter(asset => !candidates.includes(asset));
  const warnings: string[] = [];
  if (all.length === 0 && downloadable) warnings.push("This record has no files to download.");
  if (capped) warnings.push(`This record has ${candidates.length} files; the first ${chosen.length} by name are ticked. Tick others or raise the file limit to include more.`);
  if (downloadable && skipped.length) warnings.push(`${skipped.length} of ${all.length} files are not ticked (large or not a data table); tick them to include them.`);
  return {
    selected,
    capped,
    choices: all.map(asset => ({ filename: asset.filename, bytes: asset.bytes, selected: selected.includes(asset), table: isDataTableName(asset.filename) })),
    warnings,
  };
}

/** A stored file name: numbered, safe characters, the original extension kept. */
export function storedRecordFilename(asset: RecordAsset, index: number): string {
  return `${String(index + 1).padStart(4, "0")}-${asset.filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(-160) || "file"}`;
}
