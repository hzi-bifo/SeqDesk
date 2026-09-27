import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  fetchSourceJson,
  isRecord,
  LOOKUP_TIMEOUT_MS,
  manifestEntry,
  mapWithLimit,
  SOURCE_USER_AGENT,
  sizeWarnings,
  text,
  type RecordAsset,
} from "./public-record-download";
import { pickRecordFiles, storedRecordFilename } from "./record-selection";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "MGnify";
const API = "https://www.ebi.ac.uk/metagenomics/api/v1/";
const HARD_MAX = 100;
const MAX_PAGES = 5;
const ACCESSION = /^MGY([SA])\d{8}$/;
const TERMS_URL = "https://www.ebi.ac.uk/about/terms-of-use";
/** Pre-ticked: the abundance, diversity and OTU tables people analyse, up to 50 MiB each. */
const DEFAULT_TABLE_MAX = 50 * 1024 ** 2;

/** An MGnify study (MGYS…) or analysis (MGYA…) accession from the accession or an MGnify page link. */
export function parseMgnifyRef(value: string): string | null {
  const trimmed = value.trim();
  const match = /(?:^|\/)(MGY[SA]\d{8})(?:[/?#].*)?$/i.exec(trimmed);
  if (!match || (match.index > 0 && !/^(?:https?:\/\/)?(?:www\.)?ebi\.ac\.uk\/metagenomics\//i.test(trimmed))) return null;
  return match[1].toUpperCase();
}

export const mgnifyDownloadsInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  accession: z.string().trim().max(500).transform((value, ctx) => {
    const accession = parseMgnifyRef(value);
    if (accession) return accession;
    ctx.addIssue({ code: "custom", message: "Use an MGnify study (MGYS…) or analysis (MGYA…) accession." });
    return z.NEVER;
  }),
  maxFiles: z.coerce.number().int().min(1).max(HARD_MAX).default(20),
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

type MgnifyDownloadsInput = z.infer<typeof mgnifyDownloadsInputSchema>;

const kindOf = (accession: string) => ACCESSION.exec(accession)?.[1] === "S" ? "studies" : "analyses";

function isMgnifyFileUrl(url: string, accession: string): boolean {
  try {
    const parsed = new URL(url);
    const base = `/metagenomics/api/v1/${kindOf(accession)}/${accession}/`;
    return parsed.protocol === "https:" && parsed.hostname === "www.ebi.ac.uk" && !parsed.port && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && parsed.pathname.startsWith(base) && /^(?:pipelines\/[\d.]{1,8}\/)?file\/[^/]{1,300}$/.test(parsed.pathname.slice(base.length));
  } catch {
    return false;
  }
}

export type MgnifyFile = { url: string; filename: string; description?: string; pipeline?: string; checksum?: string };

/** One download entry of /{studies|analyses}/{accession}/downloads. */
export function mapMgnifyDownload(entry: unknown, accession: string): MgnifyFile {
  const unreadable = "MGnify returned a file list that could not be read. Try again later.";
  if (!isRecord(entry) || !isRecord(entry.attributes) || !isRecord(entry.links)) throw new Error(unreadable);
  const url = text(entry.links.self);
  const filename = text(entry.attributes.alias) ?? text(entry.id);
  if (!url || !filename) throw new Error(unreadable);
  if (!isMgnifyFileUrl(url, accession)) throw new Error("MGnify returned an unexpected download address.");
  const description = isRecord(entry.attributes.description) ? text(entry.attributes.description.label) : undefined;
  const pipelineData = isRecord(entry.relationships) && isRecord(entry.relationships.pipeline) && isRecord(entry.relationships.pipeline.data) ? text(entry.relationships.pipeline.data.id) : undefined;
  const pipeline = pipelineData ?? /\/pipelines\/([\d.]+)\/file\//.exec(url)?.[1];
  const sum = isRecord(entry.attributes["file-checksum"]) ? entry.attributes["file-checksum"] : {};
  const algorithm = text(sum["checksum-algorithm"])?.toLowerCase().replace("-", "");
  const value = text(sum.checksum)?.toLowerCase();
  const checksum = value && algorithm === "md5" && /^[0-9a-f]{32}$/.test(value) ? `md5:${value}` : value && algorithm === "sha256" && /^[0-9a-f]{64}$/.test(value) ? `sha256:${value}` : undefined;
  return { url, filename, description, pipeline, checksum };
}

const pipelineOrder = (value?: string) => (value ?? "0").split(".").map(Number).reduce((sum, part, index) => sum + part / 1000 ** index, 0);

/** Map the record, its downloads and their measured sizes to the preview shape. */
export function mapMgnifyRecord(record: unknown, downloads: MgnifyFile[], sizes: number[], input: MgnifyDownloadsInput): WorkbenchImportPreview {
  const accession = input.accession;
  const data = isRecord(record) && isRecord(record.data) ? record.data : null;
  const attributes = data && isRecord(data.attributes) ? data.attributes : null;
  if (!data || !attributes || text(data.id)?.toUpperCase() !== accession) throw new Error(`MGnify returned a different record for ${accession}. Try again later.`);
  const study = kindOf(accession) === "studies";
  const relationships = isRecord(data.relationships) ? data.relationships : {};
  const related = (name: string) => { const rel = relationships[name]; return isRecord(rel) && isRecord(rel.data) ? text(rel.data.id) : undefined; };
  const title = study
    ? text(attributes["study-name"])?.replace(/\s+/g, " ") ?? accession
    : `Analysis of ${related("run") ?? related("assembly") ?? accession}${text(attributes["experiment-type"]) ? ` (${text(attributes["experiment-type"])})` : ""}`;
  const detail = study
    ? [text(attributes["secondary-accession"]), text(attributes.bioproject), typeof attributes["samples-count"] === "number" ? `${attributes["samples-count"]} samples` : undefined, text(attributes["last-update"])?.slice(0, 4)]
    : [related("study"), related("sample"), text(attributes["pipeline-version"]) ? `pipeline ${text(attributes["pipeline-version"])}` : undefined, text(attributes["instrument-model"])];
  const latest = downloads.reduce((best, file) => Math.max(best, pipelineOrder(file.pipeline)), 0);
  const all: RecordAsset[] = downloads.map((file, index) => ({ url: file.url, filename: file.filename, bytes: sizes[index] ?? 0, etag: file.checksum ?? "", role: file.description ?? "file" }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  if (new Set(all.map(asset => asset.filename)).size !== all.length) throw new Error("MGnify listed two files with the same name; this record cannot be imported by file name.");
  const pipelineOf = new Map(downloads.map(file => [file.filename, file.pipeline]));
  const pick = pickRecordFiles(all, {
    source: SOURCE, record: accession, files: input.files, maxFiles: input.maxFiles, downloadable: attributes["is-private"] !== true,
    // Tables of the newest pipeline only; sequence files and BIOM stay unticked.
    preselect: asset => /\.tsv$/i.test(asset.filename) && asset.bytes > 0 && asset.bytes <= DEFAULT_TABLE_MAX && pipelineOrder(pipelineOf.get(asset.filename)) === latest,
  });
  const warnings: string[] = [];
  if (attributes["is-private"] === true) warnings.push("This MGnify record is private; its files cannot be downloaded.");
  const pipelines = [...new Set(downloads.map(file => file.pipeline).filter(Boolean))];
  if (study && pipelines.length > 1) warnings.push(`MGnify analysed this study with pipelines ${pipelines.join(", ")}; the tables of the newest are ticked.`);
  warnings.push(...pick.warnings);
  if (pick.selected.some(asset => !asset.etag)) warnings.push("MGnify does not publish checksums for these files; SeqDesk checks their size and records its own SHA-256.");
  warnings.push(...sizeWarnings(pick.selected, SOURCE));
  return {
    providerId: "mgnify-downloads",
    summary: { label: `MGnify ${accession} · ${title}`, totalFound: all.length, selectedCount: pick.selected.length, capped: pick.capped, cap: input.maxFiles, hardMax: HARD_MAX },
    genomes: [],
    assets: pick.selected,
    choices: pick.choices,
    records: [{ id: accession, title, detail: detail.filter(Boolean).join(" · ") }],
    sampleMetadata: { licence: "EMBL-EBI terms of use", licenceUrl: TERMS_URL, ...(study ? {} : { version: `pipeline ${text(attributes["pipeline-version"]) ?? "unknown"}` }) },
    ...(warnings.length ? { warnings } : {}),
  };
}

/** The size MGnify's file server states (HEAD Content-Length); 0 when it does not say. */
async function measure(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "error", headers: { "accept-encoding": "identity", "user-agent": SOURCE_USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    const length = Number(response.headers.get("content-length"));
    return response.ok && Number.isSafeInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

export async function fetchMgnifyRecord(accession: string): Promise<{ record: unknown; downloads: MgnifyFile[]; sizes: number[] }> {
  const kind = kindOf(accession);
  const record = (await fetchSourceJson(`${API}${kind}/${accession}`, { source: SOURCE, notFound: `MGnify has no public ${kind === "studies" ? "study" : "analysis"} ${accession}.` }))?.body;
  const downloads: MgnifyFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = (await fetchSourceJson(`${API}${kind}/${accession}/downloads?page=${page}&page_size=100`, { source: SOURCE }))?.body;
    if (!isRecord(body) || !Array.isArray(body.data)) throw new Error("MGnify returned a file list that could not be read. Try again later.");
    downloads.push(...body.data.map(entry => mapMgnifyDownload(entry, accession)));
    const next = isRecord(body.links) ? body.links.next : null;
    if (!next) break;
    if (page === MAX_PAGES) throw new Error(`This MGnify record lists more than ${MAX_PAGES * 100} files; import it in SeqDesk directly.`);
  }
  const sizes = await mapWithLimit(downloads, 8, file => measure(file.url));
  return { record, downloads, sizes };
}

export const mgnifyDownloadsImporter: WorkbenchImporterProvider<MgnifyDownloadsInput> = {
  id: "mgnify-downloads",
  label: "MGnify study or analysis",
  description: "Preview and download the result tables of an MGnify study or analysis (taxonomic and functional abundances), sizes checked and SHA-256 recorded.",
  category: "dataset",
  inputSchema: mgnifyDownloadsInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public MGnify API at EMBL-EBI and HTTPS downloads." };
  },
  async preview(input) {
    const { record, downloads, sizes } = await fetchMgnifyRecord(input.accession);
    return mapMgnifyRecord(record, downloads, sizes, input);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("mgnify-downloads", {
      record: input.accession,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const record = context.preview.records?.[0];
    if (!record || !ACCESSION.test(record.id)) throw new Error("The MGnify preview is incomplete. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets: context.preview.assets ?? [],
      allowUrl: url => isMgnifyFileUrl(url, record.id),
      storedFilename: storedRecordFilename,
      md5: asset => /^md5:([0-9a-f]{32})$/.exec(asset.etag)?.[1],
      sha256: asset => /^sha256:([0-9a-f]{64})$/.exec(asset.etag)?.[1],
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) downloaded from MGnify ${record.id}.`,
      sourceType: "mgnify-downloads",
      sourceMetadata: {
        source: "MGnify",
        record: record.id,
        requested: context.input.accession,
        ...(context.preview.sampleMetadata ?? {}),
        ...(context.input.files ? { selectedFiles: context.input.files } : {}),
        title: record.title,
        detail: record.detail,
        sourcePage: `https://www.ebi.ac.uk/metagenomics/${kindOf(record.id)}/${record.id}`,
        retrievedAt: new Date().toISOString(),
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: result.files.map(manifestEntry),
      },
      storagePath: result.directory,
      sizeBytes: result.sizeBytes,
      checksumSha256: result.checksumSha256,
    };
  },
};
