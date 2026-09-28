/**
 * NCBI GEO series (GSE): the series matrix and the supplementary files, with exact sizes from NCBI's HTTPS file
 * server, and every sample's characteristics as a Samples table. GEO publishes no checksums for these files, so the
 * download is checked by size and SeqDesk's own SHA-256 (and MD5) are recorded as its fingerprint. Raw reads stay in
 * SRA: the preview names the linked SRA/BioProject so they can be fetched through ENA instead.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

import { buildStableRequestHash, assertPathInsideBase } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  httpProblem,
  LOOKUP_TIMEOUT_MS,
  manifestEntry,
  mapWithLimit,
  sizeWarnings,
  SOURCE_USER_AGENT,
  type RecordAsset,
} from "./public-record-download";
import { pickRecordFiles, storedRecordFilename } from "./record-selection";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "NCBI GEO";
const HOST = "https://ftp.ncbi.nlm.nih.gov";
const HARD_MAX = 100;
const SERIES = /^GSE\d{1,9}$/;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
/** Series matrices are small text tables; above this the sample table is left out rather than read into memory. */
const MAX_MATRIX_BYTES = 64 * 1024 * 1024;

/** "GSE52778", a GEO link (acc.cgi?acc=GSE…, /geo/series/…/GSE…/) or "geo:GSE…". */
export function parseGeoSeriesRef(value: string): string | null {
  const trimmed = value.trim();
  const direct = /^(?:geo:\s*)?(GSE\d{1,9})$/i.exec(trimmed);
  if (direct) return direct[1].toUpperCase();
  const link = /^(?:https?:\/\/)?(?:www\.|ftp\.)?ncbi\.nlm\.nih\.gov\/geo\/(?:query\/acc\.cgi\?(?:[^#]*&)?acc=|series\/GSE\d{0,6}nnn\/|download\/\?(?:[^#]*&)?acc=)(GSE\d{1,9})\b/i.exec(trimmed);
  return link ? link[1].toUpperCase() : null;
}

export const geoSeriesInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  series: z.string().trim().max(500).transform((value, ctx) => {
    const ref = parseGeoSeriesRef(value);
    if (ref) return ref;
    ctx.addIssue({ code: "custom", message: "Use a GEO series accession such as GSE52778, or a GEO series link." });
    return z.NEVER;
  }),
  maxFiles: z.coerce.number().int().min(1).max(HARD_MAX).default(20),
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});
type GeoSeriesInput = z.infer<typeof geoSeriesInputSchema>;

/** GEO's folder for a series: GSE52778 → /geo/series/GSE52nnn/GSE52778/. */
export function geoSeriesFolder(series: string): string {
  const digits = series.slice(3);
  const stem = digits.length > 3 ? `GSE${digits.slice(0, -3)}nnn` : "GSEnnn";
  return `${HOST}/geo/series/${stem}/${series}/`;
}

export function isGeoFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "ftp.ncbi.nlm.nih.gov" && !parsed.port && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && /^\/geo\/series\/GSE\d{0,6}nnn\/GSE\d{1,9}\/(?:matrix|suppl)\/[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function fetchText(url: string, notFound: string, method: "GET" | "HEAD" = "GET"): Promise<{ text: string; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(url, { method, redirect: "error", headers: { "user-agent": SOURCE_USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? `${SOURCE} did not answer in time. Try again later.` : `${SOURCE} could not be reached. Try again later.`);
  }
  if (response.status === 404) { await response.body?.cancel().catch(() => {}); throw new Error(notFound); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw httpProblem(SOURCE, response.status); }
  if (method === "HEAD") return { text: "", headers: response.headers };
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_TEXT_BYTES) throw new Error(`${SOURCE} sent more data than expected. Try again later.`);
  return { text: body.toString("utf8"), headers: response.headers };
}

/** The SOFT header of a series (acc.cgi … form=text view=brief): repeated "!Series_key = value" lines. */
export function parseSeriesSoft(soft: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of soft.split(/\r?\n/)) {
    const match = /^!Series_([A-Za-z0-9_/]+)\s*=\s?(.*)$/.exec(line);
    if (!match) continue;
    (out[match[1]] ??= []).push(match[2].trim());
  }
  return out;
}

/** File names from an Apache index page (NCBI's HTTPS file server), without parent/absolute links. */
export function parseIndexFileNames(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/href="([^"/?#][^"?#]*)"/g)) {
    const name = decodeURIComponent(match[1]);
    if (!name.endsWith("/") && !name.includes("/") && !/^https?:/i.test(name) && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$/.test(name)) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function licenceNote(): Record<string, string> {
  return { licence: "NCBI GEO: no licence restrictions set by NCBI; submitters may claim rights — check the series and its paper", licenceUrl: "https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html" };
}

export function mapGeoSeries(input: GeoSeriesInput, soft: Record<string, string[]>, listed: { filename: string; url: string; bytes: number; modified?: string; role: string }[]): WorkbenchImportPreview {
  const series = input.series;
  if (soft.geo_accession?.[0] && soft.geo_accession[0] !== series) throw new Error(`${SOURCE} returned a different series for ${series}. Try again later.`);
  const title = soft.title?.[0] || series;
  const samples = soft.sample_id?.length ?? 0;
  const platforms = soft.platform_id ?? [];
  const sra = (soft.relation ?? []).map(value => /^SRA:\s*\S*?term=(SRP\d+)/.exec(value)?.[1] ?? /^BioProject:\s*\S*\/(PRJ[A-Z]{2}\d+)/.exec(value)?.[1]).filter((value): value is string => Boolean(value));
  const all: RecordAsset[] = listed.map(file => ({ url: file.url, filename: file.filename, bytes: file.bytes, etag: file.modified ? `modified:${file.modified}` : "", role: file.role }))
    .sort((a, b) => (a.role === b.role ? a.filename.localeCompare(b.filename) : a.role === "series-matrix" ? -1 : 1));
  const pick = pickRecordFiles(all, {
    source: SOURCE, record: series, files: input.files, maxFiles: input.maxFiles, downloadable: true,
    // The series matrix (sample characteristics) always; supplementary files up to 50 MiB, never the per-sample RAW archive.
    preselect: asset => asset.role === "series-matrix" || (asset.bytes > 0 && asset.bytes <= 50 * 1024 ** 2 && !/_RAW\.tar$/i.test(asset.filename)),
  });
  const warnings: string[] = [];
  if (sra.length) warnings.push(`Raw reads of this series are in SRA (${[...new Set(sra)].join(", ")}); fetch them with the NCBI SRA connector (it takes this GSE) instead of the processed files.`);
  if (!all.some(asset => asset.role === "series-matrix")) warnings.push("GEO has no series matrix for this series, so no sample table can be made from it.");
  else warnings.push("The series matrix is turned into a Samples table (one row per GSM sample, its characteristics as columns) after the download.");
  warnings.push(...pick.warnings);
  if (pick.selected.length) warnings.push("GEO does not publish checksums; files are checked by size and SeqDesk records its own SHA-256 and MD5 as their fingerprint.");
  warnings.push(...sizeWarnings(pick.selected, SOURCE));
  const detail = [series, samples ? `${samples} samples` : undefined, platforms.length ? platforms.join(", ") : undefined, soft.type?.[0], soft.status?.[0]?.replace(/^Public on /, "public ")].filter(Boolean).join(" · ");
  return {
    providerId: "geo-series",
    summary: { label: `GEO ${series} · ${title}`, totalFound: all.length, selectedCount: pick.selected.length, capped: pick.capped, cap: input.maxFiles, hardMax: HARD_MAX },
    genomes: [],
    assets: pick.selected,
    choices: pick.choices,
    records: [{ id: series, title, detail }],
    sampleMetadata: {
      ...licenceNote(),
      ...(soft.pubmed_id?.length ? { pubmed: soft.pubmed_id.join(", ") } : {}),
      ...(sra.length ? { rawReads: [...new Set(sra)].join(", ") } : {}),
      ...(samples ? { samples: String(samples) } : {}),
    },
    ...(warnings.length ? { warnings } : {}),
  };
}

/** Split one series-matrix line into its quoted tab-separated cells. */
function matrixCells(line: string): string[] {
  return line.split("\t").map(cell => cell.replace(/^"|"$/g, "").trim());
}

/**
 * The sample table of a series matrix: one row per GSM, with title, source, organism, each characteristic
 * ("treatment: Dex" → column "treatment"), platform and the BioSample/SRA links.
 */
export function seriesMatrixSamples(matrix: string): { columns: string[]; rows: string[][] } {
  const lines = matrix.split(/\r?\n/).filter(line => line.startsWith("!Sample_"));
  const byKey = new Map<string, string[][]>();
  for (const line of lines) {
    const [key, ...cells] = matrixCells(line);
    const name = key.slice("!Sample_".length);
    byKey.set(name, [...(byKey.get(name) ?? []), cells]);
  }
  const ids = byKey.get("geo_accession")?.[0] ?? [];
  if (!ids.length) return { columns: [], rows: [] };
  const columns: string[] = ["sample", "title"];
  const values: Record<string, string[]> = { sample: ids, title: byKey.get("title")?.[0] ?? [] };
  for (const [key, column] of [["source_name_ch1", "source"], ["organism_ch1", "organism"], ["molecule_ch1", "molecule"], ["platform_id", "platform"], ["library_strategy", "library_strategy"], ["instrument_model", "instrument"]] as const) {
    const row = byKey.get(key)?.[0];
    if (row?.some(Boolean)) { columns.push(column); values[column] = row; }
  }
  for (const row of byKey.get("characteristics_ch1") ?? []) {
    // Each characteristics line usually holds one attribute across samples; keep every key it names.
    const keys = new Set(row.map(cell => /^([^:]{1,80}):/.exec(cell)?.[1]?.trim()).filter((key): key is string => Boolean(key)));
    for (const key of keys) {
      const column = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "characteristic";
      if (!values[column]) { columns.push(column); values[column] = ids.map(() => ""); }
      row.forEach((cell, index) => {
        const match = /^([^:]{1,80}):\s*(.*)$/.exec(cell);
        if (match && match[1].trim() === key) values[column][index] = match[2];
      });
    }
  }
  const links: Record<string, string[]> = { biosample: ids.map(() => ""), sra: ids.map(() => "") };
  for (const row of byKey.get("relation") ?? []) {
    row.forEach((cell, index) => {
      const biosample = /^BioSample:\s*\S*?(SAM[END][A-Z]?\d+)/.exec(cell)?.[1];
      const sra = /^SRA:\s*\S*?term=(SR[XSRP]\d+)/.exec(cell)?.[1];
      if (biosample) links.biosample[index] = biosample;
      if (sra) links.sra[index] = sra;
    });
  }
  for (const key of ["biosample", "sra"]) if (links[key].some(Boolean)) { columns.push(key); values[key] = links[key]; }
  const rows = ids.map((_, index) => columns.map(column => values[column]?.[index] ?? ""));
  return { columns, rows };
}

export function samplesTsv(table: { columns: string[]; rows: string[][] }): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ").trim();
  return `${[table.columns, ...table.rows].map(row => row.map(clean).join("\t")).join("\n")}\n`;
}

async function listFolder(series: string, sub: "matrix" | "suppl", role: string) {
  const url = `${geoSeriesFolder(series)}${sub}/`;
  let listing: string;
  try { listing = (await fetchText(url, "")).text; } catch (error) {
    if (error instanceof Error && error.message === "") return [];
    throw error;
  }
  const names = parseIndexFileNames(listing).filter(name => name !== "filelist.txt");
  if (names.length > HARD_MAX) throw new Error(`${series} has more than ${HARD_MAX} ${sub} files; this connector takes smaller series.`);
  // Exact sizes: the index shows rounded ones ("2.5M"); a HEAD per file gives Content-Length and Last-Modified.
  return mapWithLimit(names, 4, async filename => {
    const fileUrl = `${url}${encodeURIComponent(filename)}`;
    if (!isGeoFileUrl(fileUrl)) throw new Error(`${SOURCE} listed a file name that cannot be fetched safely.`);
    const { headers } = await fetchText(fileUrl, `${SOURCE} no longer offers ${filename}.`, "HEAD");
    const bytes = Number(headers.get("content-length"));
    return { filename, url: fileUrl, bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0, modified: headers.get("last-modified") ?? undefined, role };
  });
}

export const geoSeriesImporter: WorkbenchImporterProvider<GeoSeriesInput> = {
  id: "geo-series",
  label: "GEO series",
  description: "Preview and download a GEO series' matrix and supplementary files with their sizes; sample characteristics become a Samples table.",
  category: "dataset",
  inputSchema: geoSeriesInputSchema,
  async preflight() {
    return { ok: true, message: "Uses NCBI GEO's public HTTPS file server." };
  },
  async preview(input) {
    const soft = parseSeriesSoft((await fetchText(`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${input.series}&targ=self&form=text&view=brief`, `${SOURCE} has no public series ${input.series}.`)).text);
    if (!soft.geo_accession?.length) throw new Error(`${SOURCE} has no public series ${input.series}.`);
    const [matrix, suppl] = await Promise.all([listFolder(input.series, "matrix", "series-matrix"), listFolder(input.series, "suppl", "supplementary")]);
    return mapGeoSeries(input, soft, [...matrix, ...suppl]);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("geo-series", {
      record: input.series,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, version: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const series = context.input.series;
    const record = context.preview.records?.[0];
    if (!record || record.id !== series) throw new Error("The GEO preview is incomplete. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets: context.preview.assets ?? [],
      allowUrl: isGeoFileUrl,
      storedFilename: storedRecordFilename,
    });
    const manifest = result.files.map(manifestEntry);
    // The Samples table, derived from the series matrix (or matrices, one per platform).
    const matrices = result.files.filter(file => file.role === "series-matrix" && file.bytes <= MAX_MATRIX_BYTES);
    let sampleCount = 0;
    if (matrices.length) {
      const tables = await Promise.all(matrices.map(async file => {
        const raw = await fs.readFile(path.join(result.directory, file.storedFilename));
        return seriesMatrixSamples((file.filename.endsWith(".gz") ? gunzipSync(raw, { maxOutputLength: MAX_MATRIX_BYTES }) : raw).toString("utf8"));
      }));
      const columns = [...new Set(tables.flatMap(table => table.columns))];
      const rows = tables.flatMap(table => table.rows.map(row => columns.map(column => row[table.columns.indexOf(column)] ?? "")));
      if (rows.length) {
        const storedFilename = `${String(result.files.length + 1).padStart(4, "0")}-${series}_samples.tsv`;
        const destination = path.join(result.directory, storedFilename);
        assertPathInsideBase(destination, result.directory, "GEO samples table");
        const body = Buffer.from(samplesTsv({ columns, rows }), "utf8");
        await fs.writeFile(destination, body, { flag: "wx", mode: 0o600 });
        sampleCount = rows.length;
        manifest.push({ role: "samples", filename: `${series}_samples.tsv`, storedFilename: `files/${storedFilename}`, sourceUrl: matrices[0].url, sourceVersion: "derived:series-matrix",
          bytes: body.length, md5: crypto.createHash("md5").update(body).digest("hex"), sha256: crypto.createHash("sha256").update(body).digest("hex") });
        await context.log(`Made a Samples table of ${rows.length} samples × ${columns.length} columns from the series matrix.`);
      }
    }
    const terms = context.preview.sampleMetadata ?? {};
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) downloaded from GEO series ${series}${sampleCount ? `, with a Samples table of ${sampleCount} samples` : ""}.`,
      sourceType: "geo-series",
      sourceMetadata: {
        source: "NCBI GEO",
        record: series,
        requested: context.input.series,
        ...terms,
        ...(context.input.files ? { selectedFiles: context.input.files } : {}),
        title: record.title,
        detail: record.detail,
        sourcePage: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${series}`,
        retrievedAt: new Date().toISOString(),
        checksums: "GEO publishes no checksums: sizes checked against NCBI's file server, SHA-256 and MD5 recorded by SeqDesk as the fingerprint.",
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: manifest,
      },
      storagePath: result.directory,
      sizeBytes: result.sizeBytes,
      checksumSha256: result.checksumSha256,
    };
  },
};
