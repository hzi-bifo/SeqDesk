/**
 * "Any DOI or link": a DOI is resolved through doi.org content negotiation and handed to the Zenodo, figshare,
 * Dryad or GEO connector when it belongs to one of them; any other https link to a file is downloaded as it is,
 * after a size and content-type preview, through SSRF-safe requests (safe-url.ts). Such sites publish no checksum
 * SeqDesk can check against, so the SHA-256 and MD5 are recorded as the file's fingerprint, and the licence is
 * recorded as unknown unless the DOI metadata names one.
 */
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { assertPathInsideBase, buildStableRequestHash, stableStringify } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import { parseDryadRef } from "./dryad-dataset";
import { parseFigshareRef } from "./figshare-article";
import { parseGeoSeriesRef } from "./geo-series";
import { formatBytes, isRecord, recordMaxDownloadBytes, text } from "./public-record-download";
import { checkUrlShape, hostListsFromEnv, safeFetch, UnsafeUrlError, type HostLists, type SafeResponse } from "./safe-url";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";
import { parseZenodoRecordRef } from "./zenodo-record";

const DOI = /^(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S{1,300})$/i;
export const UNKNOWN_LICENCE = "unknown — check the source";
const DEFAULT_MAX_BYTES = 1024 ** 3;
const MAX_CSL_BYTES = 1024 * 1024;
/** What a download may be; web pages (text/html) are landing pages, not data. */
const REFUSED_TYPES = /^(?:text\/html|application\/xhtml\+xml)\b/i;

export const linkDownloadInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  link: z.string().trim().min(4).max(2000),
  /** A person's own ceiling for this download, in bytes; the server's limit still applies. */
  maxBytes: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});
type LinkDownloadInput = z.infer<typeof linkDownloadInputSchema>;

export type Handoff = NonNullable<WorkbenchImportPreview["handoff"]>;

/** A DOI or link that belongs to a dedicated connector (checksums, versions, licences) goes there instead. */
export function recognise(value: string): Handoff | null {
  const trimmed = value.trim();
  // A bare number could be a Zenodo record or a figshare article: only links and DOIs are recognised.
  if (/^\d+$/.test(trimmed)) return null;
  const zenodo = parseZenodoRecordRef(trimmed);
  if (zenodo) return { providerId: "zenodo-record", value: zenodo, what: "a Zenodo record" };
  const figshare = parseFigshareRef(trimmed);
  if (figshare) return { providerId: "figshare-article", value: figshare.version ? `${figshare.id}.v${figshare.version}` : figshare.id, what: "a figshare article" };
  const dryad = parseDryadRef(trimmed);
  if (dryad) return { providerId: "dryad-dataset", value: dryad, what: "a Dryad dataset" };
  const geo = parseGeoSeriesRef(trimmed);
  if (geo && !/^GSE/i.test(trimmed)) return { providerId: "geo-series", value: geo, what: "a GEO series" };
  return null;
}

export function parseDoi(value: string): string | null {
  const match = DOI.exec(value.trim());
  return match ? match[1].replace(/[.,;]+$/, "") : null;
}

/** Title, landing page, publisher and licence from CSL JSON (doi.org content negotiation). */
export function mapCsl(body: unknown): { title?: string; url?: string; publisher?: string; licence?: string; licenceUrl?: string; year?: string; type?: string } {
  if (!isRecord(body)) return {};
  const title = Array.isArray(body.title) ? text(body.title[0]) : text(body.title);
  const licence = Array.isArray(body.license) ? body.license.find(isRecord) : undefined;
  const licenceUrl = licence ? text(licence.URL) ?? text(licence.url) : text(body.license);
  const issued = isRecord(body.issued) && Array.isArray(body.issued["date-parts"]) && Array.isArray(body.issued["date-parts"][0]) ? String(body.issued["date-parts"][0][0] ?? "") : undefined;
  return { title, url: text(body.URL), publisher: text(body.publisher), licence: licenceUrl ? licenceUrl.replace(/^https?:\/\/(?:www\.)?/, "") : undefined, licenceUrl, year: issued || undefined, type: text(body.type) };
}

async function readCapped(response: SafeResponse, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += (chunk as Buffer).length;
    if (size > max) { response.body.destroy(); throw new Error("The DOI service sent more data than expected."); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function resolveDoi(doi: string) {
  let response: SafeResponse;
  try {
    response = await safeFetch(`https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { accept: "application/vnd.citationstyles.csl+json" }, lists: {}, signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new Error("doi.org could not be reached. Try again later.");
  }
  if (response.status === 404) { response.body.resume(); throw new Error(`doi.org does not know the DOI ${doi}.`); }
  if (response.status < 200 || response.status >= 300) { response.body.resume(); throw new Error(`doi.org did not answer as expected (HTTP ${response.status}). Try again later.`); }
  let body: unknown;
  try { body = JSON.parse((await readCapped(response, MAX_CSL_BYTES)).toString("utf8")); } catch { throw new Error(`doi.org returned metadata for ${doi} that could not be read.`); }
  return mapCsl(body);
}

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The file name from Content-Disposition, else the last path segment, made safe. */
export function fileNameFor(url: string, disposition?: string): string {
  const fromHeader = disposition ? (/filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1]) : undefined;
  let name = "";
  try { name = decodeURIComponent((fromHeader ?? new URL(url).pathname.split("/").pop() ?? "").trim()); } catch { name = fromHeader ?? ""; }
  name = path.posix.basename(name.replace(/\\/g, "/")).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(-160);
  return name || "download";
}

/** Size, type and name of a link without downloading it: HEAD, or a one-byte ranged GET when HEAD is refused. */
async function inspect(url: string, lists: HostLists) {
  let response = await safeFetch(url, { method: "HEAD", lists, signal: AbortSignal.timeout(30_000) });
  response.body.resume();
  if (response.status === 405 || response.status === 403 || response.status === 501) {
    response = await safeFetch(url, { method: "GET", headers: { range: "bytes=0-0" }, lists, signal: AbortSignal.timeout(30_000) });
    response.body.destroy();
  }
  if (response.status === 404 || response.status === 410) throw new Error("That link does not lead to a file (the site answers “not found”).");
  if (response.status === 401 || response.status === 403) throw new Error("That site wants a login for this file; only public links can be fetched.");
  if (response.status >= 400) throw new Error(`That site did not answer as expected (HTTP ${response.status}).`);
  const range = /\/(\d+)$/.exec(headerText(response.headers["content-range"]) ?? "")?.[1];
  const length = response.status === 206 ? Number(range) : Number(headerText(response.headers["content-length"]));
  return {
    finalUrl: response.url,
    bytes: Number.isSafeInteger(length) && length >= 0 ? length : 0,
    type: headerText(response.headers["content-type"])?.split(";")[0].trim().toLowerCase() || "",
    filename: fileNameFor(response.url, headerText(response.headers["content-disposition"])),
    modified: headerText(response.headers["last-modified"]),
    etag: headerText(response.headers.etag),
  };
}

function effectiveLimit(input: Pick<LinkDownloadInput, "maxBytes">): number {
  const server = Number(process.env.SEQDESK_URL_IMPORT_MAX_BYTES);
  const serverLimit = Math.min(Number.isSafeInteger(server) && server > 0 ? server : DEFAULT_MAX_BYTES, recordMaxDownloadBytes());
  return input.maxBytes ? Math.min(input.maxBytes, serverLimit) : serverLimit;
}

export async function previewLink(input: LinkDownloadInput, lists: HostLists = hostListsFromEnv()): Promise<WorkbenchImportPreview> {
  const handoff = recognise(input.link);
  const base = { providerId: "link-download", genomes: [] as never[] };
  const summary = (label: string, selected: number) => ({ label, totalFound: selected, selectedCount: selected, capped: false, cap: 1, hardMax: 1 });
  if (handoff) {
    return { ...base, summary: summary(`${handoff.what}: ${handoff.value}`, 0), handoff, records: [{ id: handoff.value, title: `This is ${handoff.what}`, detail: "Its own connector checks versions, licence and checksums." }],
      warnings: [`This is ${handoff.what}; open it with its own connector, which checks the source's checksums.`] };
  }
  const doi = parseDoi(input.link);
  if (doi) {
    const csl = await resolveDoi(doi);
    const landing = csl.url ? recognise(csl.url) : null;
    const record = { id: doi, title: csl.title ?? doi, detail: [csl.publisher, csl.type, csl.year, csl.licence ? `licence ${csl.licence}` : `licence ${UNKNOWN_LICENCE}`].filter(Boolean).join(" · ") };
    if (landing) {
      return { ...base, summary: summary(`DOI ${doi} · ${record.title}`, 0), handoff: landing, records: [record],
        warnings: [`This DOI leads to ${landing.what}; open it with its own connector, which checks the source's checksums.`] };
    }
    return { ...base, summary: summary(`DOI ${doi} · ${record.title}`, 0), records: [record],
      sampleMetadata: { doi, landingPage: csl.url ?? "", licence: csl.licence ?? UNKNOWN_LICENCE, ...(csl.licenceUrl ? { licenceUrl: csl.licenceUrl } : {}) },
      warnings: [`A DOI names a landing page${csl.url ? ` (${csl.url})` : ""}, not a file, and ${csl.publisher ?? "this publisher"} is not a source SeqDesk knows. Open the page, copy the link of the file you need and paste that link here.`] };
  }
  const shape = checkUrlShape(input.link, lists);
  const info = await inspect(shape.toString(), lists);
  const limit = effectiveLimit(input);
  const warnings: string[] = [];
  if (REFUSED_TYPES.test(info.type)) {
    const landing = recognise(info.finalUrl);
    if (landing) return { ...base, summary: summary(`${landing.what}: ${landing.value}`, 0), handoff: landing, records: [{ id: landing.value, title: `This is ${landing.what}`, detail: info.finalUrl }], warnings: [`This link leads to ${landing.what}; open it with its own connector.`] };
    throw new Error("That link opens a web page, not a file. Open it, copy the link of the file itself and paste that.");
  }
  if (!info.bytes) warnings.push("The site does not say how large the file is; the download stops at the size limit.");
  if (info.bytes > limit) warnings.push(`This file (${formatBytes(info.bytes)}) is larger than the limit of ${formatBytes(limit)}; raise the limit or ask an administrator.`);
  if (info.finalUrl !== shape.toString()) warnings.push(`The link redirects to ${new URL(info.finalUrl).hostname}; each step was checked.`);
  warnings.push("The site publishes no checksum SeqDesk can check against: the file's SHA-256 and MD5 are recorded as its fingerprint.");
  warnings.push(`Licence ${UNKNOWN_LICENCE} before you reuse or share this file.`);
  const host = new URL(info.finalUrl).hostname;
  return {
    ...base,
    summary: summary(`${info.filename} from ${host}`, 1),
    assets: [{ url: shape.toString(), filename: info.filename, bytes: info.bytes, etag: info.etag ? `etag:${info.etag}` : info.modified ? `modified:${info.modified}` : "", role: "file" }],
    records: [{ id: shape.toString(), title: info.filename, detail: [host, info.type || "type not stated", info.bytes ? formatBytes(info.bytes) : "size unknown", info.modified].filter(Boolean).join(" · ") }],
    sampleMetadata: { site: host, contentType: info.type, licence: UNKNOWN_LICENCE, finalUrl: info.finalUrl, limitBytes: String(limit) },
    warnings,
  };
}

export const linkDownloadImporter: WorkbenchImporterProvider<LinkDownloadInput> = {
  id: "link-download",
  label: "Any DOI or link",
  description: "Resolve a DOI and hand it to the matching connector, or download a public https file with a size and type preview, checked for safe addresses.",
  category: "dataset",
  inputSchema: linkDownloadInputSchema,
  async preflight() {
    const lists = hostListsFromEnv();
    return { ok: true, message: `Downloads public https files up to ${formatBytes(effectiveLimit({}))}${lists.allow?.length ? `, from ${lists.allow.join(", ")} only` : ""}; private and local addresses are refused.` };
  },
  preview: input => previewLink(input),
  getCacheKey(input, preview) {
    return buildStableRequestHash("link-download", { assets: preview.assets?.map(asset => ({ url: asset.url, bytes: asset.bytes, version: asset.etag })), limit: effectiveLimit(input) });
  },
  async start(context) {
    const asset = context.preview.assets?.[0];
    if (!asset || context.preview.handoff) throw new Error("This preview has no file to download. Preview the link again.");
    const lists = hostListsFromEnv();
    const limit = effectiveLimit(context.input);
    if (asset.bytes > limit) throw new Error(`The file is larger than the limit of ${formatBytes(limit)}.`);
    const directory = path.join(context.storage.cacheDir, "files");
    assertPathInsideBase(directory, context.storage.cacheDir, "link download directory");
    await fs.mkdir(directory, { recursive: true });
    const storedFilename = `0001-${asset.filename}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(storedFilename)) throw new Error("The file name cannot be stored safely.");
    const destination = path.join(directory, storedFilename);
    assertPathInsideBase(destination, directory, "link download");
    await context.update({ status: "running", phase: "Downloading 1 file", progress: 5, targetPath: destination });
    await context.log(`Downloading ${asset.filename} from ${new URL(asset.url).hostname}.`);
    const signal = AbortSignal.any([AbortSignal.timeout(6 * 60 * 60 * 1000), ...(context.signal ? [context.signal] : [])]);
    const response = await safeFetch(asset.url, { lists, signal });
    if (response.status < 200 || response.status >= 300) { response.body.resume(); throw new Error(`The site did not answer as expected (HTTP ${response.status}). Preview the link again.`); }
    const type = headerText(response.headers["content-type"])?.split(";")[0].trim().toLowerCase() ?? "";
    if (REFUSED_TYPES.test(type)) { response.body.destroy(); throw new Error("The link now opens a web page instead of a file. Preview it again."); }
    const md5 = crypto.createHash("md5");
    const sha256 = crypto.createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > limit) return callback(new Error(`The download exceeds the limit of ${formatBytes(limit)}.`));
        if (asset.bytes > 0 && bytes > asset.bytes) return callback(new Error(`${asset.filename} is larger than the site declared. Preview it again.`));
        md5.update(chunk); sha256.update(chunk);
        callback(null, chunk);
      },
    });
    const temporary = `${destination}.part`;
    try {
      await pipeline(response.body, meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal });
      if (asset.bytes > 0 && bytes !== asset.bytes) throw new Error(`${asset.filename} arrived incomplete. Try the import again.`);
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    const sha = sha256.digest("hex");
    const file = { role: "file", filename: asset.filename, storedFilename: `files/${storedFilename}`, sourceUrl: asset.url, finalUrl: response.url, sourceVersion: asset.etag || undefined, contentType: type, bytes, md5: md5.digest("hex"), sha256: sha };
    await context.update({ phase: "verifying", progress: 95 });
    await context.log(`Recorded ${asset.filename}, ${formatBytes(bytes)}, sha256 ${sha.slice(0, 12)}… (the site publishes no checksum).`);
    const meta = context.preview.sampleMetadata ?? {};
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${asset.filename} downloaded from ${new URL(response.url).hostname}.`,
      sourceType: "link-download",
      sourceMetadata: {
        source: new URL(response.url).hostname,
        record: asset.url,
        title: asset.filename,
        detail: context.preview.records?.[0]?.detail,
        sourcePage: asset.url,
        licence: typeof meta.licence === "string" ? meta.licence : UNKNOWN_LICENCE,
        retrievedAt: new Date().toISOString(),
        checksums: "The site publishes no checksum: SHA-256 and MD5 recorded by SeqDesk as the fingerprint.",
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: [file],
      },
      storagePath: directory,
      sizeBytes: bytes,
      checksumSha256: crypto.createHash("sha256").update(stableStringify([{ path: storedFilename, sha256: sha }])).digest("hex"),
    };
  },
};
