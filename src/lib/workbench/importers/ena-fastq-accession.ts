import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { assertPathInsideBase, stableStringify } from "@/lib/workbench/storage";
import { validateFastqFile } from "@/lib/workbench/fastq-validation";
import type {
  WorkbenchFilePreviewItem,
  WorkbenchImporterProvider,
} from "./types";

import { loadEnaMetadata } from "./ena-metadata";
import { importCollectionSchema } from "../import-collection";
import type { SourceProcessing } from "../import-processing";

export const enaReadProcessing: SourceProcessing = { state: "unknown", evidence: "not_provided", details: "Archive origin does not establish trimming/filtering history. Original repository metadata is retained." };

const ENA_FILE_REPORT_URL = "https://www.ebi.ac.uk/ena/portal/api/filereport";
const DEFAULT_MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024 * 1024;
const ACCESSION_PATTERN = /^(?:[EDS]RR\d+|[EDS]RS\d+|[EDS]RP\d+|PRJ(?:EB|DB|NA)\d+)$/i;

export const enaFastqAccessionInputSchema = z.object({
  collection: importCollectionSchema.optional(), // Legacy queued jobs may not have a named destination.
  accession: z.string().trim().toUpperCase().regex(ACCESSION_PATTERN),
  maxFiles: z.coerce.number().int().min(1).max(100).default(20),
});

type EnaFastqAccessionInput = z.infer<typeof enaFastqAccessionInputSchema>;

interface EnaFileReportRow {
  [key: string]: string | undefined;
  run_accession?: string;
  sample_accession?: string;
  study_accession?: string;
  scientific_name?: string;
  instrument_platform?: string;
  instrument_model?: string;
  library_layout?: string;
  fastq_ftp?: string;
  fastq_md5?: string;
  fastq_bytes?: string;
}

function parseDelimited(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") throw new Error("ENA returned invalid file metadata");
  return value
    .split(";")
    .map((entry) => entry.trim());
}

function verifiedEnaDownloadUrl(value: string): string {
  const normalized = value.startsWith("ftp://")
    ? `https://${value.slice("ftp://".length)}`
    : value.startsWith("https://")
      ? value
      : `https://${value}`;
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.hostname !== "ftp.sra.ebi.ac.uk" ||
      url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("ENA returned an unexpected download host");
  }
  return url.toString();
}

export function parseEnaFileRows(rows: EnaFileReportRow[]): WorkbenchFilePreviewItem[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") throw new Error("ENA returned an invalid file row");
    const urls = parseDelimited(row.fastq_ftp);
    const md5s = parseDelimited(row.fastq_md5);
    const sizes = parseDelimited(row.fastq_bytes);
    if (!urls.length) return [];
    if (!/^[EDS]RR\d+$/.test(row.run_accession || "")) throw new Error("ENA returned an invalid run accession");
    if ((md5s.length && md5s.length !== urls.length) || (sizes.length && sizes.length !== urls.length)) {
      throw new Error("ENA file metadata lists have different lengths");
    }
    return urls.map((rawUrl, index) => {
      if (!rawUrl) throw new Error("ENA returned an empty file URL");
      const url = verifiedEnaDownloadUrl(rawUrl);
      const size = sizes[index] ? Number(sizes[index]) : undefined;
      const md5 = md5s[index]?.toLowerCase();
      if (md5 && !/^[a-f0-9]{32}$/.test(md5)) throw new Error("ENA returned an invalid MD5 checksum");
      if (size !== undefined && (!/^\d+$/.test(sizes[index]) || !Number.isSafeInteger(size))) {
        throw new Error("ENA returned an invalid file size");
      }
      return {
        sourceRecord: { ...row },
        runAccession: row.run_accession!,
        sampleAccession: row.sample_accession || undefined,
        studyAccession: row.study_accession || undefined,
        scientificName: row.scientific_name || undefined,
        instrumentPlatform: row.instrument_platform || undefined,
        instrumentModel: row.instrument_model || undefined,
        libraryLayout: row.library_layout || undefined,
        url,
        filename: path.posix.basename(new URL(url).pathname),
        md5: md5 && /^[a-f0-9]{32}$/.test(md5) ? md5 : undefined,
        bytes: size,
      };
    });
  });
}

export function selectCompleteEnaRuns(files: WorkbenchFilePreviewItem[], maxFiles: number) {
  const runs = new Map<string, WorkbenchFilePreviewItem[]>();
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.url)) throw new Error("ENA returned duplicate file URLs");
    seen.add(file.url);
    const run = runs.get(file.runAccession) || [];
    run.push(file);
    runs.set(file.runAccession, run);
  }
  const selected: WorkbenchFilePreviewItem[] = [];
  for (const run of runs.values()) {
    if (selected.length + run.length > maxFiles) break;
    selected.push(...run);
  }
  return selected;
}

function maxDownloadBytes(): number {
  const value = Number(process.env.SEQDESK_WORKBENCH_ENA_MAX_BYTES);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_DOWNLOAD_BYTES;
}

async function previewEnaFastq(input: EnaFastqAccessionInput) {
  const url = new URL(ENA_FILE_REPORT_URL);
  url.searchParams.set("accession", input.accession);
  url.searchParams.set("result", "read_run");
  url.searchParams.set(
    "fields",
    [
      "study_title", "sample_title", "sample_description", "experiment_accession", "library_strategy", "library_source", "library_selection",
      "run_accession",
      "sample_accession",
      "study_accession",
      "scientific_name",
      "instrument_platform",
      "instrument_model",
      "library_layout",
      "fastq_ftp",
      "fastq_md5",
      "fastq_bytes",
    ].join(",")
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("download", "false");

  const response = await fetch(url, {
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`ENA file report failed with HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("ENA returned an empty file report");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let reportBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reportBytes += value.byteLength;
      if (reportBytes > 8 * 1024 * 1024) throw new Error("ENA file report is too large; use a narrower accession");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const rows = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!Array.isArray(rows)) throw new Error("ENA returned an invalid file report");
  const allFiles = parseEnaFileRows(rows as EnaFileReportRow[]);
  const files = selectCompleteEnaRuns(allFiles, input.maxFiles);
  const knownBytes = files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const warnings: string[] = [];
  if (allFiles.length > files.length) {
    warnings.push(
      `This accession has ${allFiles.length} FASTQ files; ${files.length} fit as complete runs. Increase maxFiles to include more runs; files from a run are never split by the cap.`
    );
  }
  if (knownBytes > maxDownloadBytes()) {
    warnings.push("The selected FASTQ files exceed this server's configured ENA download limit.");
  }

  return {
    providerId: "ena-fastq-accession",
    processing: enaReadProcessing,
    summary: {
      label: `ENA FASTQ ${input.accession}`,
      totalFound: allFiles.length,
      selectedCount: files.length,
      capped: allFiles.length > files.length,
      cap: input.maxFiles,
      hardMax: 100,
    },
    genomes: [],
    files,
    warnings,
  };
}

async function downloadFile(
  file: WorkbenchFilePreviewItem,
  destination: string,
  remainingBytes: number,
  remainingExpandedBytes: number,
  signal?: AbortSignal
): Promise<{ bytes: number; md5: string; sha256: string; records: number; expandedBytes: number; readNamesSha256: string }> {
  const url = verifiedEnaDownloadUrl(file.url);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(6 * 60 * 60 * 1000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${file.filename}: HTTP ${response.status}`);
  }

  const temporary = `${destination}.part`;
  const md5 = crypto.createHash("md5");
  const sha256 = crypto.createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > remainingBytes) {
        callback(new Error("ENA download exceeds the configured size limit"));
        return;
      }
      md5.update(chunk);
      sha256.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      meter,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    const digest = md5.digest("hex");
    if (file.bytes !== undefined && bytes !== file.bytes) {
      throw new Error(`Size verification failed for ${file.filename}`);
    }
    if (file.md5 && digest !== file.md5) {
      throw new Error(`Checksum verification failed for ${file.filename}`);
    }
    const validation = await validateFastqFile(temporary, {
      gzip: file.filename.endsWith(".gz"), maxExpandedBytes: remainingExpandedBytes, signal,
    });
    await fs.rename(temporary, destination);
    return { bytes, md5: digest, sha256: sha256.digest("hex"), ...validation };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export const enaFastqAccessionImporter: WorkbenchImporterProvider<EnaFastqAccessionInput> = {
  id: "ena-fastq-accession",
  label: "ENA FASTQ by accession",
  description:
    "Preview and download public FASTQ files for an ENA/SRA/DRA run, sample, or project accession.",
  category: "Public sequencing reads",
  inputSchema: enaFastqAccessionInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public ENA Portal API and HTTPS downloads." };
  },
  preview: previewEnaFastq,
  getCacheKey(input, preview) {
    return crypto
      .createHash("sha256")
      .update(
        stableStringify({
          provider: this.id,
          accession: input.accession,
          files: preview.files?.map((file) => ({
            run: file.runAccession,
            filename: file.filename,
            md5: file.md5,
          })),
        })
      )
      .digest("hex")
      .slice(0, 32);
  },
  async start(context) {
    const files = context.preview.files || [];
    if (files.length === 0) throw new Error("ENA did not return any public FASTQ files");
    const expectedBytes = files.reduce((sum, file) => sum + (file.bytes || 0), 0);
    if (expectedBytes > maxDownloadBytes()) {
      throw new Error("Selected ENA files exceed the configured download size limit");
    }

    // Fetch linked source records before transferring large read files.
    const metadataRecords = await loadEnaMetadata(files.flatMap(file => [file.studyAccession, file.sampleAccession, file.sourceRecord?.experiment_accession, file.runAccession].filter((value): value is string => Boolean(value))), context.signal);
    const downloaded: Array<WorkbenchFilePreviewItem & { readNamesSha256: string; storedFilename: string; verifiedMd5: string; sha256: string; records: number; bytes: number }> = [];
    let downloadedBytes = 0;
    let expandedBytes = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const remainingBytes = maxDownloadBytes() - downloadedBytes;
      if (remainingBytes <= 0 || (file.bytes !== undefined && file.bytes > remainingBytes)) {
        throw new Error("Selected ENA files exceed the configured download size limit");
      }
      // Provider filenames are metadata, not unique or trusted storage paths.
      if (!/\.(fastq|fq)(\.gz)?$/.test(file.filename)) throw new Error("ENA returned an unsupported FASTQ filename");
      const storedFilename = `${String(index + 1).padStart(4, "0")}.fastq${file.filename.endsWith(".gz") ? ".gz" : ""}`;
      const destination = path.join(context.storage.cacheDir, storedFilename);
      assertPathInsideBase(destination, context.storage.cacheDir, "ENA FASTQ destination");
      await context.log(`Downloading ${file.runAccession}/${file.filename} from ENA.`);
      await context.update({
        status: "running",
        phase: "downloading",
        progress: Math.floor((index / files.length) * 90),
        targetPath: destination,
      });
      const result = await downloadFile(file, destination, remainingBytes, maxDownloadBytes() - expandedBytes, context.signal);
      downloadedBytes += result.bytes;
      expandedBytes += result.expandedBytes;
      downloaded.push({ ...file, storedFilename, verifiedMd5: result.md5, sha256: result.sha256, records: result.records, bytes: result.bytes, readNamesSha256: result.readNamesSha256 });
    }

    const byRun = new Map<string, typeof downloaded>();
    for (const file of downloaded) byRun.set(file.runAccession, [...(byRun.get(file.runAccession) ?? []), file]);
    const scientificImports = [...byRun.values()].map(run => {
      const first = run[0];
      const paired = first.libraryLayout === "PAIRED";
      if (run.length !== (paired ? 2 : 1)) throw new Error("Unsupported archive read layout: choose a run with one single-end file or a complete two-file pair");
      if (paired && (run[0].records !== run[1].records || run[0].readNamesSha256 !== run[1].readNamesSha256)) throw new Error("Paired archive files have mismatched read identifiers or counts");
      if (paired) {
        const mate = (name: string) => /(?:_|[._-]R)([12])(?:[._-]|$)/i.exec(name)?.[1];
        run.sort((a, b) => (mate(a.filename) ?? "").localeCompare(mate(b.filename) ?? ""));
        if (mate(run[0].filename) !== "1" || mate(run[1].filename) !== "2") throw new Error("Ambiguous mate filenames; refusing to guess R1/R2");
      }
      if (!first.sampleAccession || !first.studyAccession) throw new Error("Archive sample or study identity is missing");
      return {
        synthetic: false, studyKey: first.studyAccession, studyTitle: first.sourceRecord?.study_title || first.studyAccession,
        sampleKey: first.sampleAccession, sampleTitle: first.sourceRecord?.sample_title || first.sampleAccession,
        technology: paired ? "short" as const : "single" as const, readKey: first.runAccession,
        metadata: { ...first.sourceRecord, sampleAccession: first.sampleAccession, scientificName: first.scientificName, runAccession: first.runAccession,
          sourceFiles: run.map(file => ({ filename: file.filename, url: file.url, bytes: file.bytes, sourceMd5: file.md5, verifiedMd5: file.verifiedMd5, localSha256: file.sha256 })),
          experimentAccession: first.sourceRecord?.experiment_accession, platform: first.instrumentPlatform,
          originalSample: metadataRecords[first.sampleAccession], originalStudy: metadataRecords[first.studyAccession],
          originalExperiment: metadataRecords[first.sourceRecord?.experiment_accession || ""], originalRun: metadataRecords[first.runAccession],
          pairingValidated: paired, processingHistory: "Not inferred from archive origin" },
        processing: enaReadProcessing,
        reads: run.map(file => ({ path: path.join(context.storage.cacheDir, file.storedFilename), sha256: file.sha256, md5: file.verifiedMd5, records: file.records, bytes: file.bytes })),
      };
    });
    const totalBytes = downloaded.reduce((sum, file) => sum + file.bytes, 0);
    const checksumSha256 = crypto
      .createHash("sha256")
      .update(stableStringify(downloaded.map((file) => ({ path: file.storedFilename, sha256: file.sha256 }))))
      .digest("hex");
    await context.update({ phase: "verifying", progress: 95 });
    await context.log(`Verified ${downloaded.length} ENA FASTQ file(s).`);

    return {
      scientificImports,
      cacheKey: context.cacheKey,
      name: `ENA ${context.input.accession} FASTQ`,
      description: `${downloaded.length} public sequencing read file(s) downloaded from ENA`,
      sourceType: "ena-fastq-accession",
      sourceMetadata: {
        accession: context.input.accession,
        retrievedAt: new Date().toISOString(),
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        validation: "four-line-fastq; ordered-pair-identifiers-validated",
        metadataRecords,
        files: downloaded.map((file) => ({
          runAccession: file.runAccession,
          sampleAccession: file.sampleAccession,
          studyAccession: file.studyAccession,
          scientificName: file.scientificName,
          instrumentPlatform: file.instrumentPlatform,
          instrumentModel: file.instrumentModel,
          libraryLayout: file.libraryLayout,
          filename: file.filename,
          storedFilename: file.storedFilename,
          sourceUrl: file.url,
          sha256: file.sha256,
          records: file.records,
          md5: file.md5,
          verifiedMd5: file.verifiedMd5,
          bytes: file.bytes,
        })),
      },
      storagePath: context.storage.cacheDir,
      sizeBytes: totalBytes,
      checksumSha256,
    };
  },
};
