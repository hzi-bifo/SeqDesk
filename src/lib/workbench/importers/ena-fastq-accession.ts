import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { assertPathInsideBase, stableStringify } from "@/lib/workbench/storage";
import type {
  WorkbenchFilePreviewItem,
  WorkbenchImporterProvider,
} from "./types";

const ENA_FILE_REPORT_URL = "https://www.ebi.ac.uk/ena/portal/api/filereport";
const DEFAULT_MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024 * 1024;
const ACCESSION_PATTERN = /^(?:[EDS]RR\d+|[EDS]RS\d+|[EDS]RP\d+|PRJ(?:EB|DB|NA)\d+)$/i;

export const enaFastqAccessionInputSchema = z.object({
  accession: z.string().trim().toUpperCase().regex(ACCESSION_PATTERN),
  maxFiles: z.coerce.number().int().min(1).max(100).default(20),
});

type EnaFastqAccessionInput = z.infer<typeof enaFastqAccessionInputSchema>;

interface EnaFileReportRow {
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
  return (value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function verifiedEnaDownloadUrl(value: string): string {
  const normalized = value.startsWith("ftp://")
    ? `https://${value.slice("ftp://".length)}`
    : value.startsWith("https://")
      ? value
      : `https://${value}`;
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.hostname !== "ftp.sra.ebi.ac.uk") {
    throw new Error("ENA returned an unexpected download host");
  }
  return url.toString();
}

function parseRows(rows: EnaFileReportRow[]): WorkbenchFilePreviewItem[] {
  return rows.flatMap((row) => {
    const urls = parseDelimited(row.fastq_ftp);
    const md5s = parseDelimited(row.fastq_md5);
    const sizes = parseDelimited(row.fastq_bytes);
    return urls.map((rawUrl, index) => {
      const url = verifiedEnaDownloadUrl(rawUrl);
      const size = Number(sizes[index]);
      const md5 = md5s[index]?.toLowerCase();
      return {
        runAccession: row.run_accession || "unknown-run",
        sampleAccession: row.sample_accession || undefined,
        studyAccession: row.study_accession || undefined,
        scientificName: row.scientific_name || undefined,
        instrumentPlatform: row.instrument_platform || undefined,
        instrumentModel: row.instrument_model || undefined,
        libraryLayout: row.library_layout || undefined,
        url,
        filename: path.posix.basename(new URL(url).pathname),
        md5: md5 && /^[a-f0-9]{32}$/.test(md5) ? md5 : undefined,
        bytes: Number.isSafeInteger(size) && size >= 0 ? size : undefined,
      };
    });
  });
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
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`ENA file report failed with HTTP ${response.status}`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("ENA returned an invalid file report");
  const allFiles = parseRows(rows as EnaFileReportRow[]);
  const files = allFiles.slice(0, input.maxFiles);
  const knownBytes = files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const warnings: string[] = [];
  if (allFiles.length > files.length) {
    warnings.push(
      `This accession has ${allFiles.length} FASTQ files; the import is capped at ${files.length}.`
    );
  }
  if (knownBytes > maxDownloadBytes()) {
    warnings.push("The selected FASTQ files exceed this server's configured ENA download limit.");
  }

  return {
    providerId: "ena-fastq-accession",
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
  remainingBytes: number
): Promise<{ bytes: number; md5: string }> {
  const url = verifiedEnaDownloadUrl(file.url);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${file.filename}: HTTP ${response.status}`);
  }

  const temporary = `${destination}.part`;
  const md5 = crypto.createHash("md5");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > remainingBytes) {
        callback(new Error("ENA download exceeds the configured size limit"));
        return;
      }
      md5.update(chunk);
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
    await fs.rename(temporary, destination);
    return { bytes, md5: digest };
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

    const downloaded: Array<WorkbenchFilePreviewItem & { verifiedMd5: string; bytes: number }> = [];
    let downloadedBytes = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const remainingBytes = maxDownloadBytes() - downloadedBytes;
      if (remainingBytes <= 0 || (file.bytes !== undefined && file.bytes > remainingBytes)) {
        throw new Error("Selected ENA files exceed the configured download size limit");
      }
      const destination = path.join(context.storage.cacheDir, file.filename);
      assertPathInsideBase(destination, context.storage.cacheDir, "ENA FASTQ destination");
      await context.log(`Downloading ${file.runAccession}/${file.filename} from ENA.`);
      await context.update({
        status: "running",
        phase: "downloading",
        progress: Math.floor((index / files.length) * 90),
        targetPath: destination,
      });
      const result = await downloadFile(file, destination, remainingBytes);
      downloadedBytes += result.bytes;
      downloaded.push({ ...file, verifiedMd5: result.md5, bytes: result.bytes });
    }

    const totalBytes = downloaded.reduce((sum, file) => sum + file.bytes, 0);
    const checksumSha256 = crypto
      .createHash("sha256")
      .update(downloaded.map((file) => `${file.filename}:${file.verifiedMd5}`).join("\n"))
      .digest("hex");
    await context.update({ phase: "verifying", progress: 95 });
    await context.log(`Verified ${downloaded.length} ENA FASTQ file(s).`);

    return {
      cacheKey: context.cacheKey,
      name: `ENA ${context.input.accession} FASTQ`,
      description: `${downloaded.length} public sequencing read file(s) downloaded from ENA`,
      sourceType: "ena-fastq-accession",
      sourceMetadata: {
        accession: context.input.accession,
        files: downloaded.map((file) => ({
          runAccession: file.runAccession,
          sampleAccession: file.sampleAccession,
          studyAccession: file.studyAccession,
          scientificName: file.scientificName,
          instrumentPlatform: file.instrumentPlatform,
          instrumentModel: file.instrumentModel,
          libraryLayout: file.libraryLayout,
          filename: file.filename,
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
