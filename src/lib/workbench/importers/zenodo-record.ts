import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  fetchSourceJson,
  httpProblem,
  isRecord,
  LOOKUP_TIMEOUT_MS,
  SOURCE_USER_AGENT,
  manifestEntry,
  num,
  sizeWarnings,
  text,
  type RecordAsset,
} from "./public-record-download";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "Zenodo";
const API = "https://zenodo.org/api/records/";
const HARD_MAX = 100;
const RECORD_ID = /^\d{1,12}$/;
const RECORD_URL = /^(?:https?:\/\/)?(?:www\.)?zenodo\.org\/(?:api\/)?records?\/(\d{1,12})(?:[/?#].*)?$/i;
const RECORD_DOI = /^(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)?10\.5281\/zenodo\.(\d{1,12})$/i;
const MD5 = /^md5:([0-9a-f]{32})$/;

/** Numeric record id from an id, a zenodo.org record link, or a 10.5281/zenodo.N DOI; null otherwise. */
export function parseZenodoRecordRef(value: string): string | null {
  const trimmed = value.trim();
  const id = RECORD_ID.test(trimmed) ? trimmed : (RECORD_URL.exec(trimmed) ?? RECORD_DOI.exec(trimmed))?.[1];
  return id ? String(Number(id)) : null;
}

export const zenodoRecordInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  record: z.string().trim().max(500).transform((value, ctx) => {
    const id = parseZenodoRecordRef(value);
    if (id && id !== "0") return id;
    ctx.addIssue({ code: "custom", message: "Use a Zenodo record number, a zenodo.org/records/… link or a 10.5281/zenodo.… DOI." });
    return z.NEVER;
  }),
  maxFiles: z.coerce.number().int().min(1).max(HARD_MAX).default(20),
  /** File names to download (the ticked ones in the preview). Absent: the default selection, see defaultSelection. */
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

const DATA_TABLE = /\.(?:csv|tsv|txt|tab|xlsx?)(?:\.gz)?$/i;
/** Pre-ticked when nothing was chosen yet: obvious data tables up to 1 GiB, and other files only when small. */
const DEFAULT_TABLE_MAX = 1024 ** 3;
const DEFAULT_OTHER_MAX = 5 * 1024 ** 2;

export function isDataTableName(filename: string): boolean {
  return DATA_TABLE.test(filename);
}

function defaultCandidates(all: RecordAsset[]): RecordAsset[] {
  return all.filter(asset => isDataTableName(asset.filename) ? asset.bytes <= DEFAULT_TABLE_MAX : asset.bytes <= DEFAULT_OTHER_MAX);
}

type ZenodoRecordInput = z.infer<typeof zenodoRecordInputSchema>;

export function zenodoVersion(value: unknown): string | undefined {
  const version = text(value);
  if (!version) return undefined;
  if (/^v?\d[\w.+-]*$/i.test(version)) return version.toLowerCase().startsWith("v") ? version : `v${version}`;
  return version.length > 40 ? `${version.slice(0, 39)}…` : version;
}

function licenseOf(metadata: Record<string, unknown>): string | undefined {
  const license = metadata.license;
  return isRecord(license) ? text(license.id) : text(license);
}

export function zenodoDetail(record: Record<string, unknown>): string {
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return [text(record.doi) ?? text(metadata.doi), zenodoVersion(metadata.version), licenseOf(metadata), text(metadata.publication_date)?.slice(0, 4)]
    .filter(Boolean).join(" · ");
}

function isZenodoFileUrl(url: string, id: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "zenodo.org" && !parsed.port && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && parsed.pathname.startsWith(`/api/records/${id}/files/`) && parsed.pathname.endsWith("/content");
  } catch {
    return false;
  }
}

/** Map one Zenodo record (legacy JSON serialization of /api/records/{id}) to the preview shape. */
export function mapZenodoRecord(body: unknown, input: ZenodoRecordInput, requestedId: string): WorkbenchImportPreview {
  if (!isRecord(body)) throw new Error("Zenodo returned a record that could not be read. Try again later.");
  const id = String(num(body.id) ?? text(body.id) ?? "");
  if (!RECORD_ID.test(id)) throw new Error("Zenodo returned a record that could not be read. Try again later.");
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const title = text(metadata.title) ?? text(body.title) ?? `Record ${id}`;
  const access = text(metadata.access_right) ?? "open";
  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const all: RecordAsset[] = rawFiles.map((file) => {
    if (!isRecord(file)) throw new Error("Zenodo returned file details that could not be read. Try again later.");
    const filename = text(file.key);
    const bytes = num(file.size);
    const checksum = text(file.checksum);
    const url = isRecord(file.links) ? text(file.links.self) : undefined;
    if (!filename || bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0 || !url) {
      throw new Error("Zenodo returned file details that could not be read. Try again later.");
    }
    if (!isZenodoFileUrl(url, id)) throw new Error("Zenodo returned an unexpected download address.");
    return { url, filename, bytes, etag: checksum ?? "", role: "file" };
  }).sort((a, b) => a.filename.localeCompare(b.filename));
  if (new Set(all.map(asset => asset.url)).size !== all.length) throw new Error("Zenodo listed the same file twice. Try again later.");
  // Only open records have downloadable files; others are previewed but select nothing.
  if (input.files) {
    const unknown = input.files.filter(name => !all.some(asset => asset.filename === name));
    if (unknown.length) throw new Error(`Zenodo record ${id} has no file named ${unknown.slice(0, 3).join(", ")}. Preview it again.`);
  }
  const candidates = input.files ? all.filter(asset => input.files!.includes(asset.filename)) : defaultCandidates(all);
  const chosen = input.files ? candidates : candidates.slice(0, input.maxFiles);
  const capped = access === "open" && !input.files && candidates.length > chosen.length;
  const selected = access === "open" ? chosen : [];
  const skipped = input.files ? [] : all.filter(asset => !candidates.includes(asset));
  const warnings: string[] = [];
  if (id !== requestedId) warnings.push(`Zenodo record ${requestedId} stands for all versions; this imports the latest version, record ${id}.`);
  if (access === "embargoed") {
    const until = text(metadata.embargo_date);
    warnings.push(`This record is under embargo${until ? ` until ${until}` : ""}; its files cannot be downloaded yet.`);
  } else if (access === "restricted" || access === "closed") {
    warnings.push("This record is restricted; its files cannot be downloaded without access from its owners.");
  }
  if (all.length === 0 && access === "open") warnings.push("This record has no files to download.");
  if (capped) warnings.push(`This record has ${candidates.length} files; the first ${chosen.length} by name are ticked. Tick others or raise the file limit to include more.`);
  if (access === "open" && skipped.length) warnings.push(`${skipped.length} of ${all.length} files are not ticked (large or not a data table); tick them to include them.`);
  if (selected.some(asset => !MD5.test(asset.etag))) warnings.push("Zenodo did not publish an MD5 checksum for every file; those files are checked by size only.");
  warnings.push(...sizeWarnings(selected, SOURCE));
  return {
    providerId: "zenodo-record",
    summary: { label: `Zenodo ${id} · ${title}`, totalFound: all.length, selectedCount: selected.length, capped, cap: input.maxFiles, hardMax: HARD_MAX },
    genomes: [],
    assets: selected,
    choices: all.map(asset => ({ filename: asset.filename, bytes: asset.bytes, selected: selected.includes(asset), table: isDataTableName(asset.filename) })),
    records: [{ id, title, detail: zenodoDetail(body) }],
    ...(warnings.length ? { warnings } : {}),
  };
}

/** GET /api/records/{id}; a concept (all-versions) id redirects once to its latest version. */
export async function fetchZenodoRecord(id: string, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API}${id}`, { redirect: "manual", headers: { accept: "application/json", "user-agent": SOURCE_USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "Zenodo did not answer in time. Try again later." : "Zenodo could not be reached. Try again later.");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    const latest = /^(?:https:\/\/zenodo\.org)?\/api\/records\/(\d{1,12})$/.exec(response.headers.get("location") ?? "")?.[1];
    if (!latest) throw new Error("Zenodo redirected to an unexpected address.");
    return (await fetchSourceJson(`${API}${latest}`, { source: SOURCE, notFound: `Zenodo has no record ${id}.`, timeoutMs }))?.body;
  }
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Zenodo has no record ${id}.`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw httpProblem(SOURCE, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Zenodo returned a record that could not be read. Try again later.");
  }
}

export const zenodoRecordImporter: WorkbenchImporterProvider<ZenodoRecordInput> = {
  id: "zenodo-record",
  label: "Zenodo record",
  description: "Preview and download the open files of a Zenodo record, verified against Zenodo's MD5 checksums.",
  category: "dataset",
  inputSchema: zenodoRecordInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public Zenodo REST API and HTTPS downloads." };
  },
  async preview(input) {
    return mapZenodoRecord(await fetchZenodoRecord(input.record), input, input.record);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("zenodo-record", {
      record: preview.records?.[0]?.id ?? input.record,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const record = context.preview.records?.[0];
    const assets = context.preview.assets ?? [];
    if (!record || !RECORD_ID.test(record.id)) throw new Error("The Zenodo preview is incomplete. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets,
      allowUrl: url => isZenodoFileUrl(url, record.id),
      storedFilename: (asset, index) => `${String(index + 1).padStart(4, "0")}-${asset.filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(-160) || "file"}`,
      md5: asset => MD5.exec(asset.etag)?.[1],
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) downloaded from Zenodo record ${record.id}.`,
      sourceType: "zenodo-record",
      sourceMetadata: {
        source: "Zenodo",
        record: record.id,
        requested: context.input.record,
        ...(context.input.files ? { selectedFiles: context.input.files } : {}),
        title: record.title,
        detail: record.detail,
        sourcePage: `https://zenodo.org/records/${record.id}`,
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
