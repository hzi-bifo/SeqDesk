/**
 * NCBI SRA runs: runs named by any SRA accession (run, experiment, sample, study, BioProject, BioSample) or by a GEO
 * series or sample, whose SRA link is followed. NCBI's E-utilities say which runs these are, with their files and
 * MD5s; each run's FASTQ is then taken from the ENA mirror when ENA has it (FASTQ, MD5-checked, the usual case), and
 * otherwise NCBI's own .sra file from its public bucket is downloaded, checked against the MD5 in NCBI's record.
 * A runs table (SeqDesk's own, from NCBI's metadata) goes with the files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import type { SourceProcessing } from "../import-processing";
import { EUTILS, NCBI_LICENCE, NCBI_LICENCE_URL, ncbiJson, ncbiText } from "./ncbi-client";
import {
  downloadRecordAssets,
  fetchSourceJson,
  formatBytes,
  manifestEntry,
  mapWithLimit,
  sizeWarnings,
  splitIdList,
  type RecordAsset,
} from "./public-record-download";
import { pickRecordFiles, storedRecordFilename } from "./record-selection";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "NCBI SRA";
const HARD_MAX_RUNS = 100;
const MAX_UIDS = 500;
const ODP = "https://sra-pub-run-odp.s3.amazonaws.com";
const ENA_FILE_REPORT = "https://www.ebi.ac.uk/ena/portal/api/filereport";
export const SRA_ACCESSION = /^(?:[SED]R[RXSP]\d{5,12}|PRJ(?:NA|EB|DB)\d{1,9}|SAM(?:N|EA|D)\d{5,12}|GS[EM]\d{1,9})$/;
const RUN = /^[SED]RR\d{5,12}$/;

const processing: SourceProcessing = { state: "unknown", evidence: "not_provided", details: "Archive origin does not establish trimming/filtering history. Original repository metadata is retained." };

export const ncbiSraRunsInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  accessions: z.preprocess(splitIdList, z.array(z.string().trim().toUpperCase()).min(1).max(20))
    .transform((values, ctx) => {
      const bad = values.filter(value => !SRA_ACCESSION.test(value));
      if (bad.length) {
        ctx.addIssue({ code: "custom", message: `${bad.slice(0, 3).join(", ")} ${bad.length === 1 ? "is not" : "are not"} an SRA or GEO accession (SRR…, SRX…, SRS…, SRP…, PRJNA…, SAMN…, GSE… or GSM…).` });
        return z.NEVER;
      }
      return [...new Set(values)];
    }),
  maxRuns: z.coerce.number().int().min(1).max(HARD_MAX_RUNS).default(10),
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX_RUNS * 3)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

type NcbiSraRunsInput = z.infer<typeof ncbiSraRunsInputSchema>;

export interface SraRun {
  run: string;
  experiment: string;
  title?: string;
  study?: string;
  bioproject?: string;
  sample?: string;
  biosample?: string;
  organism?: string;
  strategy?: string;
  source?: string;
  layout?: string;
  instrument?: string;
  spots?: number;
  bases?: number;
  published?: string;
  isPublic: boolean;
  /** NCBI's normalized .sra file, with the MD5 and size NCBI records for it. */
  sra?: { md5: string; bytes: number };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);|&#(\d{1,6});/g, (_m, name: string | undefined, code: string | undefined) => name ? ENTITIES[name] : String.fromCodePoint(Number(code)));
const element = (xml: string, tag: string) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml); return m ? decode(m[1]).trim() || undefined : undefined; };
const openTag = (xml: string, tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).exec(xml)?.[0];
const attr = (tag: string | undefined, name: string) => { if (!tag) return undefined; const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]).trim() || undefined : undefined; };
const count = (value: string | undefined) => value && /^\d{1,18}$/.test(value) ? Number(value) : undefined;

/** The runs of an E-utilities SRA record set (efetch db=sra, XML), read as inert text; entities are never resolved. */
export function parseSraPackages(xml: string): SraRun[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("NCBI SRA returned a record SeqDesk does not read. Try again later.");
  if (!xml.includes("<EXPERIMENT_PACKAGE_SET")) throw new Error("NCBI SRA returned a record that could not be read. Try again later.");
  const runs: SraRun[] = [];
  for (const pack of xml.split("<EXPERIMENT_PACKAGE>").slice(1)) {
    const experiment = attr(openTag(pack, "EXPERIMENT"), "accession");
    if (!experiment) continue;
    const layoutBlock = /<LIBRARY_LAYOUT>\s*<(PAIRED|SINGLE)\b/.exec(pack)?.[1];
    const common = {
      experiment,
      title: element(pack, "TITLE"),
      study: attr(openTag(pack, "STUDY_REF"), "accession"),
      bioproject: /<EXTERNAL_ID namespace="BioProject"[^>]*>([^<]+)</.exec(pack)?.[1],
      sample: attr(openTag(pack, "SAMPLE_DESCRIPTOR"), "accession"),
      biosample: /<EXTERNAL_ID namespace="BioSample"[^>]*>([^<]+)</.exec(pack)?.[1],
      organism: element(pack, "SCIENTIFIC_NAME"),
      strategy: element(pack, "LIBRARY_STRATEGY"),
      source: element(pack, "LIBRARY_SOURCE"),
      layout: layoutBlock,
      instrument: element(pack, "INSTRUMENT_MODEL"),
    };
    for (const block of pack.split(/<RUN\s/).slice(1)) {
      const tag = `<RUN ${block.slice(0, block.indexOf(">") + 1)}`;
      const run = attr(tag, "accession");
      if (!run || !RUN.test(run)) continue;
      const body = block.slice(0, block.indexOf("</RUN>") >= 0 ? block.indexOf("</RUN>") : undefined);
      const normalized = [...body.matchAll(/<SRAFile\s[^>]*>/g)].map(m => m[0]).find(file => attr(file, "semantic_name") === "SRA Normalized" && attr(file, "cluster") === "public");
      const md5 = attr(normalized, "md5")?.toLowerCase();
      const bytes = count(attr(normalized, "size"));
      runs.push({
        run, ...common,
        spots: count(attr(tag, "total_spots")), bases: count(attr(tag, "total_bases")),
        published: attr(tag, "published")?.slice(0, 10),
        isPublic: attr(tag, "is_public") !== "false",
        ...(md5 && /^[0-9a-f]{32}$/.test(md5) && bytes !== undefined ? { sra: { md5, bytes } } : {}),
      });
    }
  }
  return runs;
}

function uidList(body: unknown): string[] {
  const ids = (body as { esearchresult?: { idlist?: unknown } } | null)?.esearchresult?.idlist;
  if (!Array.isArray(ids)) throw new Error("NCBI returned a search result that could not be read. Try again later.");
  return ids.filter((id): id is string => typeof id === "string" && /^\d{1,12}$/.test(id));
}

/** GEO series/sample → its SRA records, through the GEO DataSets link NCBI keeps (gds → sra). */
async function geoToSraUids(accession: string): Promise<string[]> {
  const kind = accession.startsWith("GSE") ? "gse" : "gsm";
  const search = new URL(`${EUTILS}/esearch.fcgi`);
  search.search = new URLSearchParams({ db: "gds", term: `${accession}[ACCN] AND ${kind}[ETYP]`, retmode: "json", retmax: "20" }).toString();
  const gds = uidList(await ncbiJson(search.toString(), { source: "NCBI GEO" }));
  if (!gds.length) throw new Error(`NCBI GEO has no public ${kind === "gse" ? "series" : "sample"} ${accession}.`);
  const link = new URL(`${EUTILS}/elink.fcgi`);
  const body = new URLSearchParams({ dbfrom: "gds", db: "sra", retmode: "json" });
  for (const id of gds) body.append("id", id);
  const linked = await ncbiJson(link.toString(), { source: "NCBI GEO", body }) as { linksets?: { linksetdbs?: { dbto?: string; links?: unknown[] }[] }[] } | null;
  const ids = (linked?.linksets ?? []).flatMap(set => set.linksetdbs ?? []).filter(db => db.dbto === "sra").flatMap(db => db.links ?? []);
  return ids.filter((id): id is string => typeof id === "string" && /^\d{1,12}$/.test(id));
}

async function sraUids(accession: string): Promise<string[]> {
  if (accession.startsWith("GS")) return geoToSraUids(accession);
  const url = new URL(`${EUTILS}/esearch.fcgi`);
  url.search = new URLSearchParams({ db: "sra", term: `${accession}[All Fields]`, retmode: "json", retmax: String(MAX_UIDS) }).toString();
  return uidList(await ncbiJson(url.toString(), { source: SOURCE }));
}

/** Which runs the accessions name: GEO links followed, experiments expanded, a run accession kept to itself. */
export async function resolveSraRuns(accessions: string[]): Promise<{ runs: SraRun[]; unresolved: string[]; geo: string[] }> {
  const byAccession = new Map<string, string[]>();
  for (const accession of accessions) byAccession.set(accession, await sraUids(accession));
  const uids = [...new Set([...byAccession.values()].flat())];
  if (uids.length > MAX_UIDS) throw new Error(`These accessions name more than ${MAX_UIDS} SRA experiments; choose a narrower one (a run or a sample).`);
  const unresolved = accessions.filter(accession => !byAccession.get(accession)?.length);
  if (!uids.length) return { runs: [], unresolved, geo: [] };
  const body = new URLSearchParams({ db: "sra", retmode: "xml" });
  body.set("id", uids.join(","));
  const all = parseSraPackages(await ncbiText(`${EUTILS}/efetch.fcgi`, { source: SOURCE, body, accept: "application/xml", timeoutMs: 90_000 }));
  // A run accession searches to its experiment, which may hold other runs: keep only the named run then.
  const named = new Set(accessions.filter(accession => RUN.test(accession)));
  const onlyNamed = accessions.every(accession => RUN.test(accession));
  const runs = [...new Map(all.filter(run => !onlyNamed || named.has(run.run)).map(run => [run.run, run])).values()].sort((a, b) => a.run.localeCompare(b.run, "en", { numeric: true }));
  const missingRuns = [...named].filter(run => !runs.some(entry => entry.run === run));
  return { runs, unresolved: [...unresolved, ...missingRuns.filter(run => !unresolved.includes(run))], geo: accessions.filter(accession => accession.startsWith("GS")) };
}

export function isEnaFastqUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "ftp.sra.ebi.ac.uk" && !parsed.port && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && /^\/vol1\/fastq\/[A-Za-z0-9/_.-]+\.fastq\.gz$/.test(parsed.pathname) && !parsed.pathname.includes("..");
  } catch {
    return false;
  }
}

export function isNcbiSraUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === ODP && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && /^\/sra\/([SED]RR\d{5,12})\/\1$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** ENA's FASTQ files for one run (the mirror), or null when ENA has none; ENA's own trouble also yields null. */
async function enaFastq(run: string): Promise<RecordAsset[] | null | "unreachable"> {
  const url = new URL(ENA_FILE_REPORT);
  url.search = new URLSearchParams({ accession: run, result: "read_run", fields: "run_accession,fastq_ftp,fastq_md5,fastq_bytes", format: "json" }).toString();
  let rows: unknown;
  try {
    rows = (await fetchSourceJson(url.toString(), { source: "ENA", attempts: 2, notFound: "none" }))?.body ?? [];
  } catch (error) {
    // Not found, or an accession ENA does not accept (HTTP 400): ENA does not mirror this run.
    if (error instanceof Error && (error.message === "none" || /\(HTTP 4\d\d\)/.test(error.message))) return null;
    return "unreachable";
  }
  const row = Array.isArray(rows) ? rows.find(entry => (entry as Record<string, unknown>)?.run_accession === run) as Record<string, string> | undefined : undefined;
  if (!row?.fastq_ftp) return null;
  const urls = row.fastq_ftp.split(";");
  const md5s = (row.fastq_md5 ?? "").split(";");
  const sizes = (row.fastq_bytes ?? "").split(";");
  const assets = urls.map((value, index) => {
    const href = `https://${value.replace(/^(?:ftp|https?):\/\//, "")}`;
    const md5 = md5s[index]?.toLowerCase();
    const bytes = Number(sizes[index]);
    return { url: href, filename: href.slice(href.lastIndexOf("/") + 1), bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0, etag: md5 && /^[0-9a-f]{32}$/.test(md5) ? `md5:${md5}` : "", role: "fastq" };
  });
  if (assets.some(asset => !isEnaFastqUrl(asset.url) || !asset.etag || !asset.filename.startsWith(run))) return null;
  return assets;
}

function runDetail(run: SraRun, via: string): string {
  return [run.experiment, run.biosample ?? run.sample, run.organism, run.strategy, run.layout?.toLowerCase(), run.instrument, run.spots !== undefined ? `${run.spots.toLocaleString("en-US")} spots` : undefined, via].filter(Boolean).join(" · ");
}

export function citationFor(runs: SraRun[], geo: string[]): string {
  const studies = [...new Set(runs.map(run => run.bioproject ?? run.study).filter(Boolean))];
  return `${runs.length === 1 ? `Run ${runs[0].run}` : `${runs.length} runs`}${studies.length ? ` of ${studies.join(", ")}` : ""}${geo.length ? ` (GEO ${geo.join(", ")})` : ""}, NCBI Sequence Read Archive, https://www.ncbi.nlm.nih.gov/sra`;
}

export async function mapSraPreview(input: NcbiSraRunsInput, resolved: { runs: SraRun[]; unresolved: string[]; geo: string[] }, lookup: (run: string) => ReturnType<typeof enaFastq> = enaFastq): Promise<WorkbenchImportPreview> {
  const publicRuns = resolved.runs.filter(run => run.isPublic);
  const chosen = publicRuns.slice(0, input.maxRuns);
  const mirrored = await mapWithLimit(chosen, 3, run => lookup(run.run));
  const all: RecordAsset[] = [];
  const records: NonNullable<WorkbenchImportPreview["records"]> = [];
  let enaDown = false;
  let noFiles = 0;
  chosen.forEach((run, index) => {
    const ena = mirrored[index];
    if (ena === "unreachable") enaDown = true;
    if (Array.isArray(ena) && ena.length) {
      all.push(...ena);
      records.push({ id: run.run, title: run.title ?? run.experiment, detail: runDetail(run, "FASTQ from the ENA mirror") });
    } else if (run.sra) {
      all.push({ url: `${ODP}/sra/${run.run}/${run.run}`, filename: `${run.run}.sra`, bytes: run.sra.bytes, etag: `md5:${run.sra.md5}`, role: "sra" });
      records.push({ id: run.run, title: run.title ?? run.experiment, detail: runDetail(run, ".sra from NCBI") });
    } else {
      noFiles += 1;
      records.push({ id: run.run, title: run.title ?? run.experiment, detail: runDetail(run, "no public file") });
    }
  });
  if (new Set(all.map(asset => asset.filename)).size !== all.length) throw new Error("Two of these runs share a file name; import them one at a time.");
  const label = input.accessions.join(", ");
  const pick = pickRecordFiles(all, { source: SOURCE, record: label, files: input.files, maxFiles: HARD_MAX_RUNS * 3, downloadable: true, preselect: () => true });
  const warnings: string[] = [];
  if (resolved.unresolved.length) warnings.push(`NCBI has no public SRA runs for ${resolved.unresolved.join(", ")}.`);
  if (resolved.geo.length && resolved.runs.length) warnings.push(`The GEO ${resolved.geo.length === 1 ? "record's" : "records'"} raw reads are these SRA runs; its processed files and sample table come with the GEO connector.`);
  if (resolved.runs.length > publicRuns.length) warnings.push(`${resolved.runs.length - publicRuns.length} run(s) are not public and are left out.`);
  if (publicRuns.length > chosen.length) warnings.push(`These accessions hold ${publicRuns.length} runs; the first ${chosen.length} are shown. Raise the run limit or name narrower accessions to include more.`);
  if (enaDown) warnings.push("ENA did not answer, so some runs come from NCBI as .sra files instead of FASTQ. Preview again later to get FASTQ from ENA.");
  if (all.some(asset => asset.role === "sra")) warnings.push(".sra files are NCBI's own read format; convert them with fasterq-dump (SRA Toolkit) before a step that needs FASTQ.");
  if (noFiles) warnings.push(`${noFiles} run(s) have no public file to download.`);
  if (!resolved.runs.length && !resolved.unresolved.length) warnings.push("These accessions have no runs in SRA.");
  warnings.push(...pick.warnings.filter(warning => !/not ticked \(large/.test(warning)), ...sizeWarnings(pick.selected, SOURCE));
  const bytes = pick.selected.reduce((sum, asset) => sum + asset.bytes, 0);
  return {
    providerId: "ncbi-sra-runs",
    processing,
    summary: { label: `NCBI SRA ${label}`, totalFound: publicRuns.length, selectedCount: pick.selected.length, capped: publicRuns.length > chosen.length, cap: input.maxRuns, hardMax: HARD_MAX_RUNS },
    genomes: [],
    assets: pick.selected,
    choices: pick.choices,
    records,
    sampleMetadata: {
      licence: NCBI_LICENCE, licenceUrl: NCBI_LICENCE_URL,
      citation: citationFor(chosen, resolved.geo),
      ...(resolved.geo.length ? { geo: resolved.geo.join(", ") } : {}),
      runs: chosen.map(run => run.run).join(", "),
      approximateBytes: formatBytes(bytes),
    },
    ...(warnings.length ? { warnings } : {}),
  };
}

const RUN_COLUMNS: [string, (run: SraRun, via: string) => string | number | undefined][] = [
  ["run", run => run.run], ["experiment", run => run.experiment], ["sample", run => run.sample], ["biosample", run => run.biosample],
  ["study", run => run.study], ["bioproject", run => run.bioproject], ["organism", run => run.organism], ["library_strategy", run => run.strategy],
  ["library_source", run => run.source], ["library_layout", run => run.layout], ["instrument_model", run => run.instrument],
  ["spots", run => run.spots], ["bases", run => run.bases], ["published", run => run.published], ["files_from", (_run, via) => via], ["title", run => run.title],
];

/** The runs table SeqDesk writes next to the reads (from NCBI's metadata; tabs and newlines flattened). */
export function sraRunsTsv(runs: SraRun[], via: (run: string) => string): string {
  const clean = (value: string | number | undefined) => value === undefined ? "" : String(value).replace(/[\t\r\n]+/g, " ");
  return [RUN_COLUMNS.map(([name]) => name).join("\t"), ...runs.map(run => RUN_COLUMNS.map(([, read]) => clean(read(run, via(run.run)))).join("\t"))].join("\n") + "\n";
}

export const ncbiSraRunsImporter: WorkbenchImporterProvider<NcbiSraRunsInput> = {
  id: "ncbi-sra-runs",
  label: "NCBI SRA runs",
  description: "Runs from NCBI's Sequence Read Archive by SRA, BioProject, BioSample or GEO accession: FASTQ from the ENA mirror where it has them, otherwise NCBI's .sra files, each checked against its published MD5.",
  category: "reads",
  inputSchema: ncbiSraRunsInputSchema,
  async preflight() {
    return { ok: true, message: "Uses NCBI's E-utilities to find runs, and ENA's mirror or NCBI's public bucket for the files." };
  },
  async preview(input) {
    return mapSraPreview(input, await resolveSraRuns(input.accessions));
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("ncbi-sra-runs", {
      accessions: input.accessions,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const assets = context.preview.assets ?? [];
    if (!assets.length) throw new Error("The NCBI SRA preview has no files to import. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets,
      allowUrl: url => isEnaFastqUrl(url) || isNcbiSraUrl(url),
      storedFilename: storedRecordFilename,
      md5: asset => /^md5:([0-9a-f]{32})$/.exec(asset.etag)?.[1],
      async check(asset, filePath) {
        const handle = await fs.open(filePath, "r");
        const head = Buffer.alloc(8);
        try { await handle.read(head, 0, 8, 0); } finally { await handle.close(); }
        if (asset.role === "fastq" && !(head[0] === 0x1f && head[1] === 0x8b)) throw new Error(`${asset.filename} is not a gzip-compressed FASTQ file.`);
        if (asset.role === "sra" && head.toString("latin1") !== "NCBI.sra") throw new Error(`${asset.filename} is not an .sra file.`);
      },
    });
    // The runs table: re-read from NCBI at import time so it describes exactly the downloaded runs.
    const runIds = new Set(result.files.map(file => /^([SED]RR\d{5,12})/.exec(file.filename)?.[1]).filter((run): run is string => Boolean(run)));
    const resolved = await resolveSraRuns(context.input.accessions).catch(() => null);
    const runs = resolved?.runs.filter(run => runIds.has(run.run)) ?? [];
    const via = (run: string) => result.files.some(file => file.filename.startsWith(run) && file.role === "fastq") ? "ENA FASTQ" : "NCBI .sra";
    const manifest = result.files.map(manifestEntry);
    if (runs.length) {
      const tsv = sraRunsTsv(runs, via);
      const storedFilename = "sra_runs.tsv";
      await fs.writeFile(path.join(result.directory, storedFilename), tsv, { mode: 0o600, flag: "wx" });
      const bytes = Buffer.byteLength(tsv);
      manifest.push({ role: "runs", filename: storedFilename, storedFilename: `files/${storedFilename}`, sourceUrl: `${EUTILS}/efetch.fcgi?db=sra`, sourceVersion: "derived:ncbi-sra-metadata", bytes, md5: crypto.createHash("md5").update(tsv).digest("hex"), sha256: crypto.createHash("sha256").update(tsv).digest("hex") });
    }
    const first = context.preview.records?.[0]?.id;
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) of ${runIds.size} SRA run(s), each checked against its published MD5.`,
      sourceType: "ncbi-sra-runs",
      sourceMetadata: {
        source: "NCBI SRA",
        record: context.input.accessions.join(", "),
        requested: context.input.accessions,
        ...(context.preview.sampleMetadata ?? {}),
        title: context.preview.records?.length === 1 ? context.preview.records[0].title : `${runIds.size} SRA runs`,
        detail: [...runIds].join(", "),
        sourcePage: first ? `https://www.ncbi.nlm.nih.gov/sra/?term=${encodeURIComponent(first)}` : "https://www.ncbi.nlm.nih.gov/sra",
        retrievedAt: new Date().toISOString(),
        checksums: "FASTQ checked against ENA's MD5; .sra files against the MD5 in NCBI's SRA record; SHA-256 recorded.",
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: manifest,
      },
      storagePath: result.directory,
      sizeBytes: result.sizeBytes,
      checksumSha256: result.checksumSha256,
    };
  },
};
