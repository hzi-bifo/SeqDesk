import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  fetchSourceJson,
  isRecord,
  manifestEntry,
  num,
  sizeWarnings,
  text,
  type RecordAsset,
} from "./public-record-download";
import { pickRecordFiles, storedRecordFilename } from "./record-selection";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "figshare";
const API = "https://api.figshare.com/v2/articles/";
const HARD_MAX = 100;
const ID = /^\d{1,12}$/;
const MD5 = /^[0-9a-f]{32}$/;
// figshare.com/articles/<type>/<slug>/<id>[/<version>] and the institutional portals (<name>.figshare.com).
const ARTICLE_URL = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?figshare\.com\/articles\/(?:[^/?#]+\/){0,2}(\d{1,12})(?:\/(\d{1,4}))?\/?(?:[?#].*)?$/i;
const ARTICLE_DOI = /^(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)?10\.6084\/m9\.figshare\.(\d{1,12})(?:\.v(\d{1,4}))?$/i;

/** Article id (and version, when the reference names one) from an id, a figshare link or a 10.6084/m9.figshare DOI. */
export function parseFigshareRef(value: string): { id: string; version?: number } | null {
  const trimmed = value.trim();
  if (ID.test(trimmed)) return Number(trimmed) > 0 ? { id: String(Number(trimmed)) } : null;
  const match = ARTICLE_URL.exec(trimmed) ?? ARTICLE_DOI.exec(trimmed);
  if (!match || Number(match[1]) <= 0) return null;
  return { id: String(Number(match[1])), ...(match[2] && Number(match[2]) > 0 ? { version: Number(match[2]) } : {}) };
}

export const figshareArticleInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  article: z.string().trim().max(500).transform((value, ctx) => {
    // Normalised to "id" or "id.vN" (a string, so a stored job input parses again to the same value).
    const ref = parseFigshareRef(value) ?? (/^(\d{1,12})\.v(\d{1,4})$/.exec(value) ? { id: value.split(".v")[0], version: Number(value.split(".v")[1]) } : null);
    if (ref) return ref.version ? `${ref.id}.v${ref.version}` : ref.id;
    ctx.addIssue({ code: "custom", message: "Use a figshare article number, a figshare.com/articles/… link or a 10.6084/m9.figshare.… DOI." });
    return z.NEVER;
  }),
  /** Pin a version; absent, the article's version of today is recorded. A version in the DOI or link wins. */
  version: z.coerce.number().int().min(1).max(9999).optional(),
  maxFiles: z.coerce.number().int().min(1).max(HARD_MAX).default(20),
  files: z.array(z.string().trim().min(1).max(300)).min(1).max(HARD_MAX)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

type FigshareArticleInput = z.infer<typeof figshareArticleInputSchema>;

/** The article id and pinned version of a normalised `article` input. */
export function articleRef(input: Pick<FigshareArticleInput, "article" | "version">): { id: string; version?: number } {
  const [id, version] = input.article.split(".v");
  const pinned = version ? Number(version) : input.version;
  return pinned ? { id, version: pinned } : { id };
}

function isFigshareFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "ndownloader.figshare.com" && !parsed.port && !parsed.username && !parsed.password &&
      /^\/files\/\d{1,14}$/.test(parsed.pathname) && !parsed.hash;
  } catch {
    return false;
  }
}

/** figshare serves files from its S3 buckets after a redirect (its own, or an institution's pstorage-… bucket). */
function isFigshareStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /^s3[.-](?:[a-z0-9-]+\.)?amazonaws\.com$/.test(parsed.hostname) && /^\/(?:pfigshare-u-files|pstorage-[a-z0-9-]{1,80})\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function figshareDetail(body: Record<string, unknown>): string {
  const license = isRecord(body.license) ? text(body.license.name) : undefined;
  const version = num(body.version);
  return [text(body.doi), version !== undefined ? `v${version}` : undefined, license, text(body.published_date)?.slice(0, 4)].filter(Boolean).join(" · ");
}

/** Licence, version and DOI, carried from the preview into the provenance record. */
function recordTerms(body: Record<string, unknown>): Record<string, string> {
  const license = isRecord(body.license) ? body.license : {};
  const version = num(body.version);
  const terms: Record<string, string | undefined> = { licence: text(license.name), licenceUrl: text(license.url), version: version !== undefined ? `v${version}` : undefined, doi: text(body.doi) };
  return Object.fromEntries(Object.entries(terms).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export function mapFigshareArticle(body: unknown, input: FigshareArticleInput): WorkbenchImportPreview {
  const unreadable = "figshare returned an article that could not be read. Try again later.";
  if (!isRecord(body)) throw new Error(unreadable);
  const id = String(num(body.id) ?? "");
  if (!ID.test(id)) throw new Error(unreadable);
  if (id !== articleRef(input).id) throw new Error(`figshare returned a different article for ${articleRef(input).id}. Try again later.`);
  const version = num(body.version);
  const title = text(body.title)?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || `Article ${id}`;
  const embargoed = body.is_embargoed === true;
  const confidential = body.is_confidential === true;
  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const links: string[] = [];
  const all: RecordAsset[] = [];
  for (const file of rawFiles) {
    if (!isRecord(file)) throw new Error(unreadable);
    const filename = text(file.name);
    const bytes = num(file.size);
    const url = text(file.download_url);
    if (!filename || bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error(unreadable);
    if (file.is_link_only === true) { links.push(filename); continue; }
    if (!url || !isFigshareFileUrl(url)) throw new Error("figshare returned an unexpected download address.");
    const md5 = text(file.computed_md5) ?? text(file.supplied_md5);
    all.push({ url, filename, bytes, etag: md5 && MD5.test(md5) ? `md5:${md5}` : "", role: "file" });
  }
  all.sort((a, b) => a.filename.localeCompare(b.filename));
  if (new Set(all.map(asset => asset.filename)).size !== all.length) throw new Error("figshare listed two files with the same name; this article cannot be imported by file name.");
  const downloadable = !embargoed && !confidential;
  const pick = pickRecordFiles(all, { source: SOURCE, record: `article ${id}`, files: input.files, maxFiles: input.maxFiles, downloadable });
  const warnings: string[] = [];
  const pinned = articleRef(input).version;
  if (!pinned && version !== undefined) warnings.push(`No version was named; this is version ${version}, the latest today, and the import records it.`);
  if (embargoed) warnings.push(`This article is under embargo${text(body.embargo_date) ? ` until ${text(body.embargo_date)}` : ""}; its files cannot be downloaded yet.`);
  if (confidential) warnings.push("This article's files are confidential; they cannot be downloaded without access from its owners.");
  if (links.length) warnings.push(`${links.length} file${links.length === 1 ? " is a link" : "s are links"} to another site and ${links.length === 1 ? "is" : "are"} not downloaded: ${links.slice(0, 3).join(", ")}.`);
  warnings.push(...pick.warnings);
  if (pick.selected.some(asset => !asset.etag)) warnings.push("figshare did not publish an MD5 checksum for every file; those files are checked by size only.");
  warnings.push(...sizeWarnings(pick.selected, SOURCE));
  const versionWord = version !== undefined ? ` v${version}` : "";
  return {
    providerId: "figshare-article",
    summary: { label: `figshare ${id}${versionWord} · ${title}`, totalFound: all.length, selectedCount: pick.selected.length, capped: pick.capped, cap: input.maxFiles, hardMax: HARD_MAX },
    genomes: [],
    assets: pick.selected,
    choices: pick.choices,
    records: [{ id: version !== undefined ? `${id}.v${version}` : id, title, detail: figshareDetail(body) }],
    sampleMetadata: recordTerms(body),
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function fetchFigshareArticle(id: string, version?: number): Promise<unknown> {
  const url = version ? `${API}${id}/versions/${version}` : `${API}${id}`;
  return (await fetchSourceJson(url, { source: SOURCE, notFound: version ? `figshare has no version ${version} of article ${id}.` : `figshare has no public article ${id}.` }))?.body;
}

export const figshareArticleImporter: WorkbenchImporterProvider<FigshareArticleInput> = {
  id: "figshare-article",
  label: "figshare article",
  description: "Preview and download the files of a public figshare article, pinned to a version and verified against figshare's MD5 checksums.",
  category: "dataset",
  inputSchema: figshareArticleInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public figshare API and HTTPS downloads." };
  },
  async preview(input) {
    const ref = articleRef(input);
    return mapFigshareArticle(await fetchFigshareArticle(ref.id, ref.version), input);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("figshare-article", {
      record: preview.records?.[0]?.id ?? input.article,
      assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, checksum: asset.etag })),
      ...(input.files ? { files: input.files } : {}),
    });
  },
  async start(context) {
    const record = context.preview.records?.[0];
    const match = record ? /^(\d{1,12})(?:\.v(\d{1,4}))?$/.exec(record.id) : null;
    if (!record || !match) throw new Error("The figshare preview is incomplete. Preview it again.");
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets: context.preview.assets ?? [],
      allowUrl: isFigshareFileUrl,
      allowRedirectTo: url => isFigshareFileUrl(url) || isFigshareStorageUrl(url),
      storedFilename: storedRecordFilename,
      md5: asset => /^md5:([0-9a-f]{32})$/.exec(asset.etag)?.[1],
    });
    const terms = context.preview.sampleMetadata ?? {};
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} file(s) downloaded from figshare article ${match[1]}${match[2] ? ` version ${match[2]}` : ""}.`,
      sourceType: "figshare-article",
      sourceMetadata: {
        source: "figshare",
        record: record.id,
        requested: context.input.article,
        ...terms,
        ...(context.input.files ? { selectedFiles: context.input.files } : {}),
        title: record.title,
        detail: record.detail,
        sourcePage: `https://figshare.com/articles/dataset/_/${match[1]}${match[2] ? `/${match[2]}` : ""}`,
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
