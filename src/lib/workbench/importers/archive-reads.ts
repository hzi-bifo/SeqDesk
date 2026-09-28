/**
 * Archive FASTQ runs as SeqDesk read records (study → sample → reads), with the same rules as the ENA importer:
 * one single-end file or a complete R1/R2 pair per run, pairs checked for equal read counts and identical read names,
 * and mates ordered by their _1/_2 names, never guessed.
 */
import type { SourceProcessing } from "../import-processing";
import type { WorkbenchImportResult } from "./types";

export interface ArchiveReadFile {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  sourceMd5?: string;
  md5: string;
  sha256: string;
  records: number;
  readNamesSha256: string;
}

export interface ArchiveRun {
  run: string;
  paired: boolean;
  studyKey: string;
  studyTitle?: string;
  sampleKey: string;
  sampleTitle?: string;
  metadata: Record<string, unknown>;
  files: ArchiveReadFile[];
}

type ScientificImport = NonNullable<WorkbenchImportResult["scientificImport"]>;

const mate = (name: string) => /(?:_|[._-]R)([12])(?:[._-]|$)/i.exec(name)?.[1];

export function archiveReadImport(run: ArchiveRun, processing: SourceProcessing): ScientificImport {
  const files = [...run.files];
  if (files.length !== (run.paired ? 2 : 1)) throw new Error(`Run ${run.run} does not have ${run.paired ? "a complete two-file pair" : "one single-end file"}; it cannot become a read record.`);
  if (run.paired) {
    files.sort((a, b) => (mate(a.filename) ?? "").localeCompare(mate(b.filename) ?? ""));
    if (mate(files[0].filename) !== "1" || mate(files[1].filename) !== "2") throw new Error(`Run ${run.run} has ambiguous mate file names; SeqDesk does not guess R1/R2.`);
    if (files[0].records !== files[1].records || files[0].readNamesSha256 !== files[1].readNamesSha256) throw new Error(`The two files of run ${run.run} have different read names or counts.`);
  }
  if (!run.studyKey || !run.sampleKey) throw new Error(`Run ${run.run} has no study or sample in the archive record.`);
  return {
    synthetic: false,
    studyKey: run.studyKey, studyTitle: run.studyTitle || run.studyKey,
    sampleKey: run.sampleKey, sampleTitle: run.sampleTitle || run.sampleKey,
    technology: run.paired ? "short" : "single",
    readKey: run.run,
    metadata: {
      ...run.metadata,
      runAccession: run.run,
      sourceFiles: files.map(file => ({ filename: file.filename, url: file.url, bytes: file.bytes, sourceMd5: file.sourceMd5, verifiedMd5: file.md5, localSha256: file.sha256 })),
      pairingValidated: run.paired,
      processingHistory: "Not inferred from archive origin",
    },
    processing,
    reads: files.map(file => ({ path: file.path, sha256: file.sha256, md5: file.md5, records: file.records, bytes: file.bytes })),
  };
}
