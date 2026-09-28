import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  fetchSourceJson,
  isRecord,
  LOOKUP_TIMEOUT_MS,
  manifestEntry,
  num,
  SOURCE_USER_AGENT,
  sizeWarnings,
  text,
  type RecordAsset,
} from "./public-record-download";
import { pickRecordFiles, storedRecordFilename } from "./record-selection";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "Dryad";
const ORIGIN = "https://datadryad.org";
const HARD_MAX = 100;
const MAX_PAGES = 10;
const DRYAD_DOI = /^(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)?(10\.5061\/dryad\.[a-z0-9]{4,20})$/i;
const DRYAD_URL = /^(?:https?:\/\/)?(?:www\.)?datadryad\.org\/(?:stash\/)?dataset\/(?:doi:|https?:\/\/doi\.org\/)?(10\.5061\/dryad\.[a-z0-9]{4,20})\/?(?:[?#].*)?$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MD5 = /^[0-9a-f]{32}$/;

/** The dataset DOI (10.5061/dryad.…) from a DOI, a doi.org link or a datadryad.org dataset page. */
export function parseDryadRef(value: string): string | null {
  const trimmed = value.trim();
  const doi = (DRYAD_DOI.exec(trimmed) ?? DRYAD_URL.exec(trimmed))?.[1];
  return doi ? doi.toLowerCase() : null;
}

export const dryadDatasetInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  dataset: z.string().trim().max(500).transform((value, ctx) => {
    const doi = parseDryadRef(value);
    if (doi) return doi;
    ctx.addIssue({ code: "custom", message: "Use a Dryad DOI (10.5061/dryad.…) or a datadryad.org dataset link." });
    return z.NEVER;
  }),
  maxFiles: z.coerce.number().int().min(1).max(HARD_MAX).default(20),
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

type DryadDatasetInput = z.infer<typeof dryadDatasetInputSchema>;

const apiDataset = (doi: string) => `${ORIGIN}/api/v2/datasets/${encodeURIComponent(`doi:${doi}`)}`;

function isDryadDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === ORIGIN && !parsed.username && !parsed.password && /^\/api\/v2\/files\/\d{1,14}\/download$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

/** Dryad hands the bytes over from its S3 storage after a redirect. */
function isDryadStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.origin === ORIGIN || /^(?:[a-z0-9-]+\.)?s3[.-](?:[a-z0-9-]+\.)?amazonaws\.com$/.test(parsed.hostname));
  } catch {
    return false;
  }
}

function licenceName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/CC0/i.test(url)) return "CC0 1.0";
  const cc = /licenses\/(by(?:-[a-z-]+)?)\/(\d\.\d)/i.exec(url);
  return cc ? `CC ${cc[1].toUpperCase()} ${cc[2]}` : url;
}

export function dryadDetail(dataset: Record<string, unknown>): string {
  const version = num(dataset.versionNumber);
  return [text(dataset.identifier)?.replace(/^doi:/, ""), version !== undefined ? `v${version}` : undefined, licenceName(text(dataset.license)), text(dataset.publicationDate)?.slice(0, 4)]
    .filter(Boolean).join(" · ");
}

/** Dryad's recommended form: "Authors (year). Title [Dataset]. Dryad. https://doi.org/…" (names only, never e-mails). */
export function dryadCitation(dataset: Record<string, unknown>, doi: string): string {
  const authors = (Array.isArray(dataset.authors) ? dataset.authors : []).flatMap((author) => {
    if (!isRecord(author)) return [];
    const last = text(author.lastName);
    const initials = (text(author.firstName) ?? "").split(/[\s-]+/).filter(Boolean).map(part => `${part[0]}.`).join(" ");
    return last ? [initials ? `${last}, ${initials}` : last] : [];
  });
  const names = authors.length > 20 ? [...authors.slice(0, 19), "…", authors[authors.length - 1]] : authors;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}` : names[0];
  const year = text(dataset.publicationDate)?.slice(0, 4);
  const title = text(dataset.title)?.replace(/\s+/g, " ").replace(/\.$/, "") ?? doi;
  return [list, year ? `(${year}).` : undefined, `${title} [Dataset].`, "Dryad.", `https://doi.org/${doi}`].filter(Boolean).join(" ");
}

function link(body: Record<string, unknown>, rel: string): string | undefined {
  const links = isRecord(body._links) ? body._links : {};
  const entry = links[rel];
  return isRecord(entry) ? text(entry.href) : undefined;
}

/** Map a dataset and its latest version's file list to the preview shape. */
export function mapDryadDataset(dataset: unknown, files: unknown[], input: DryadDatasetInput,
  hasAccount = Boolean(process.env.SEQDESK_DRYAD_CLIENT_ID?.trim() && process.env.SEQDESK_DRYAD_CLIENT_SECRET?.trim())): WorkbenchImportPreview {
  const unreadable = "Dryad returned a dataset that could not be read. Try again later.";
  if (!isRecord(dataset)) throw new Error(unreadable);
  const doi = text(dataset.identifier)?.replace(/^doi:/i, "").toLowerCase();
  if (!doi || doi !== input.dataset) throw new Error(`Dryad returned a different dataset for ${input.dataset}. Try again later.`);
  const title = text(dataset.title)?.replace(/\s+/g, " ") ?? doi;
  const version = num(dataset.versionNumber);
  const all: RecordAsset[] = files.map((file) => {
    if (!isRecord(file)) throw new Error(unreadable);
    const filename = text(file.path);
    const bytes = num(file.size);
    const href = link(file, "stash:download");
    if (!filename || bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0 || !href) throw new Error(unreadable);
    const url = new URL(href, ORIGIN).toString();
    if (!isDryadDownloadUrl(url)) throw new Error("Dryad returned an unexpected download address.");
    const digest = text(file.digest)?.toLowerCase();
    const type = text(file.digestType)?.toLowerCase().replace("-", "");
    const etag = digest && type === "sha256" && SHA256.test(digest) ? `sha256:${digest}` : digest && type === "md5" && MD5.test(digest) ? `md5:${digest}` : "";
    return { url, filename, bytes, etag, role: "file" };
  }).sort((a, b) => a.filename.localeCompare(b.filename));
  if (new Set(all.map(asset => asset.filename)).size !== all.length) throw new Error("Dryad listed two files with the same name; this dataset cannot be imported by file name.");
  const publicDataset = (text(dataset.visibility) ?? "public") === "public";
  const pick = pickRecordFiles(all, { source: SOURCE, record: doi, files: input.files, maxFiles: input.maxFiles, downloadable: publicDataset });
  const warnings: string[] = [];
  if (version !== undefined) warnings.push(`This is version ${version} of the dataset, the latest today; the import records it.`);
  if (!publicDataset) warnings.push("This dataset is not public yet; its files cannot be downloaded.");
  warnings.push(...pick.warnings);
  if (pick.selected.some(asset => !asset.etag)) warnings.push("Dryad did not publish a checksum for every file; those files are checked by size only.");
  if (!hasAccount) warnings.push("Dryad only hands out files to registered API accounts; an administrator adds the account to SeqDesk before these files can be downloaded.");
  warnings.push(...sizeWarnings(pick.selected, SOURCE));
  const licence = text(dataset.license);
  return {
    providerId: "dryad-dataset",
    summary: { label: `Dryad ${doi}${version !== undefined ? ` v${version}` : ""} · ${title}`, totalFound: all.length, selectedCount: pick.selected.length, capped: pick.capped, cap: input.maxFiles, hardMax: HARD_MAX },
    genomes: [],
    assets: pick.selected,
    choices: pick.choices,
    records: [{ id: doi, title, detail: dryadDetail(dataset) }],
    sampleMetadata: Object.fromEntries(Object.entries({ licence: licenceName(licence), licenceUrl: licence, version: version !== undefined ? `v${version}` : undefined, doi, citation: dryadCitation(dataset, doi) })
      .filter((entry): entry is [string, string] => Boolean(entry[1]))),
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function fetchDryadDataset(doi: string): Promise<{ dataset: unknown; files: unknown[] }> {
  const dataset = (await fetchSourceJson(apiDataset(doi), { source: SOURCE, attempts: 2, notFound: `Dryad has no public dataset ${doi}.` }))?.body;
  if (!isRecord(dataset)) throw new Error("Dryad returned a dataset that could not be read. Try again later.");
  const version = link(dataset, "stash:version");
  if (!version || !/^\/api\/v2\/versions\/\d{1,12}$/.test(version)) throw new Error("Dryad returned a dataset without a readable version. Try again later.");
  const files: unknown[] = [];
  let next: string | undefined = `${version}/files`;
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    if (!/^\/api\/v2\/versions\/\d{1,12}\/files(?:\?page=\d{1,4})?$/.test(next)) throw new Error("Dryad returned an unexpected file list address.");
    const body: unknown = (await fetchSourceJson(`${ORIGIN}${next}`, { source: SOURCE, attempts: 2 }))?.body;
    const embedded = isRecord(body) && isRecord(body._embedded) ? body._embedded["stash:files"] : undefined;
    if (!Array.isArray(embedded)) throw new Error("Dryad returned a file list that could not be read. Try again later.");
    files.push(...embedded);
    next = isRecord(body) ? link(body, "next") : undefined;
  }
  if (next) throw new Error(`This Dryad dataset lists more than ${MAX_PAGES * 20} files; import it in SeqDesk directly.`);
  return { dataset, files };
}

/** The API account an admin saved in Settings › Data sources (encrypted), else SEQDESK_DRYAD_CLIENT_ID/SECRET. */
async function dryadCredentials(): Promise<{ id: string; secret: string } | null> {
  const { dryadAccount } = await import("../data-sources");
  return (await dryadAccount()).value;
}

/** An access token for the registered API account (client credentials); never logged or stored. */
async function dryadToken(): Promise<string> {
  const credentials = await dryadCredentials();
  if (!credentials) throw new Error("Dryad only hands out files to registered API accounts, and none is set up in SeqDesk. Ask an administrator to add one.");
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}/oauth/token`, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": SOURCE_USER_AGENT },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.id, client_secret: credentials.secret }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Dryad could not be reached. Try again later.");
  }
  const body = await response.json().catch(() => null) as unknown;
  const token = isRecord(body) ? text(body.access_token) : undefined;
  if (!response.ok || !token) throw new Error("Dryad did not accept SeqDesk's API account. Ask an administrator to check it.");
  return token;
}

export const dryadDatasetImporter: WorkbenchImporterProvider<DryadDatasetInput> = {
  id: "dryad-dataset",
  label: "Dryad dataset",
  description: "Preview a Dryad dataset by DOI and download its files, verified against Dryad's SHA-256 checksums.",
  category: "dataset",
  inputSchema: dryadDatasetInputSchema,
  async preflight() {
    return (await dryadCredentials())
      ? { ok: true, message: "Uses the Dryad API with this server's registered API account." }
      : { ok: false, previewOnly: true, message: "Previews work; downloads need a Dryad API account.", details: "An admin adds a Dryad API account (from datadryad.org) in Settings › Data sources, or sets SEQDESK_DRYAD_CLIENT_ID and SEQDESK_DRYAD_CLIENT_SECRET on the SeqDesk server." };
  },
  async preview(input) {
    const { dataset, files } = await fetchDryadDataset(input.dataset);
    return mapDryadDataset(dataset, files, input, Boolean(await dryadCredentials()));
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("dryad-dataset", {
      record: preview.records?.[0]?.id ?? input.dataset,
      version: preview.sampleMetadata?.version,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const record = context.preview.records?.[0];
    if (!record || !parseDryadRef(record.id)) throw new Error("The Dryad preview is incomplete. Preview it again.");
    const token = await dryadToken();
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets: context.preview.assets ?? [],
      allowUrl: isDryadDownloadUrl,
      allowRedirectTo: isDryadStorageUrl,
      headers: async () => ({ authorization: `Bearer ${token}` }),
      storedFilename: storedRecordFilename,
      md5: asset => /^md5:([0-9a-f]{32})$/.exec(asset.etag)?.[1],
      sha256: asset => /^sha256:([0-9a-f]{64})$/.exec(asset.etag)?.[1],
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) downloaded from Dryad dataset ${record.id}.`,
      sourceType: "dryad-dataset",
      sourceMetadata: {
        source: "Dryad",
        record: record.id,
        requested: context.input.dataset,
        ...(context.preview.sampleMetadata ?? {}),
        ...(context.input.files ? { selectedFiles: context.input.files } : {}),
        title: record.title,
        detail: record.detail,
        sourcePage: `${ORIGIN}/dataset/doi:${record.id}`,
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
