/**
 * Shared plumbing for the small public-record connectors (Zenodo, PDB, AlphaFold, UniProt):
 * bounded JSON lookups with plain-sentence errors, and verified downloads into the job's cache
 * directory. These imports produce Workbench datasets only (no reads, no scientific records).
 */
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { assertPathInsideBase, stableStringify } from "@/lib/workbench/storage";
import type { WorkbenchImportPreview, WorkbenchImportStartContext } from "./types";

export type RecordAsset = NonNullable<WorkbenchImportPreview["assets"]>[number];

export interface DownloadedRecordAsset extends RecordAsset {
  storedFilename: string;
  sha256: string;
  md5: string;
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 ** 3;
export const LOOKUP_TIMEOUT_MS = 30_000;
/** Zenodo answers 403 to Node's default user agent; name ourselves on every request. */
export const SOURCE_USER_AGENT = "SeqDesk (+https://seqdesk.org)";
const DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_LOOKUP_BYTES = 16 * 1024 * 1024;

/** Server-wide cap for one public-record import, like SEQDESK_WORKBENCH_ENA_MAX_BYTES for reads. */
export function recordMaxDownloadBytes(): number {
  const value = Number(process.env.SEQDESK_WORKBENCH_RECORD_MAX_BYTES);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_DOWNLOAD_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

/** Deduplicate while keeping the caller's order. */
export function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/** Accept a list or one comma/space separated string; the contract is the array. */
export function splitIdList(value: unknown): unknown {
  return typeof value === "string" ? value.split(/[\s,;]+/).filter(Boolean) : value;
}

export async function mapWithLimit<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readLimited(response: Response, maxBytes: number, source: string): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`${source} sent more data than expected. Try a smaller selection.`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

function unreachable(source: string, error: unknown): Error {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new Error(`${source} did not answer in time. Try again later.`);
  }
  return new Error(`${source} could not be reached. Try again later.`);
}

export function httpProblem(source: string, status: number): Error {
  if (status === 429) return new Error(`${source} is limiting requests right now. Try again in a minute.`);
  return new Error(`${source} did not answer as expected (HTTP ${status}). Try again later.`);
}

/**
 * GET a JSON document. 404/410 become `notFound` (a plain sentence) when given; other failures
 * become plain sentences naming the source. Returns null for 204 (no content).
 */
export async function fetchSourceJson(url: string, options: {
  source: string;
  notFound?: string;
  init?: RequestInit;
  maxBytes?: number;
  timeoutMs?: number;
  /** Read the JSON body of a 3xx answer instead of following it (UniProt explains merged entries this way). */
  readRedirectBody?: boolean;
}): Promise<{ body: unknown; headers: Headers; status: number } | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: options.readRedirectBody ? "manual" : "error",
      ...options.init,
      headers: { accept: "application/json", "user-agent": SOURCE_USER_AGENT, ...(options.init?.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(options.timeoutMs ?? LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(options.source, error);
  }
  if ((response.status === 404 || response.status === 410) && options.notFound) {
    await response.body?.cancel().catch(() => {});
    throw new Error(options.notFound);
  }
  if (response.status === 204) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const redirected = options.readRedirectBody && response.status >= 300 && response.status < 400;
  if (!response.ok && !redirected) {
    await response.body?.cancel().catch(() => {});
    throw httpProblem(options.source, response.status);
  }
  let text: string;
  try {
    text = (await readLimited(response, options.maxBytes ?? MAX_LOOKUP_BYTES, options.source)).toString("utf8");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(options.source)) throw error;
    throw unreachable(options.source, error);
  }
  try {
    return { body: JSON.parse(text) as unknown, headers: response.headers, status: response.status };
  } catch {
    throw new Error(`${options.source} returned a response that could not be read. Try again later.`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Size warning shared by the previews (ENA pattern: warn in preview, refuse at start). */
export function sizeWarnings(assets: RecordAsset[], source: string): string[] {
  const warnings: string[] = [];
  const known = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (known > recordMaxDownloadBytes()) {
    warnings.push(`The selected ${source} files (${formatBytes(known)}) exceed this server's download limit of ${formatBytes(recordMaxDownloadBytes())}.`);
  }
  if (assets.some(asset => asset.bytes === 0)) {
    warnings.push(`${source} does not publish file sizes in advance; sizes are measured during the download.`);
  }
  return warnings;
}

/**
 * Download preview assets into `<cacheDir>/files`, verifying declared size and MD5 where the source
 * provides them, and enforcing the server-wide download limit for sizes that are only known on
 * arrival. `check` validates content (format sniffing, sequence digests) before the file is kept.
 */
export async function downloadRecordAssets<TInput>(context: WorkbenchImportStartContext<TInput>, options: {
  source: string;
  assets: RecordAsset[];
  allowUrl: (url: string) => boolean;
  storedFilename: (asset: RecordAsset, index: number) => string;
  md5?: (asset: RecordAsset) => string | undefined;
  check?: (asset: RecordAsset, filePath: string) => Promise<void>;
  /** Follow HTTPS redirects (mirrors) when the final address passes this check; otherwise redirects fail. */
  allowRedirectTo?: (url: string) => boolean;
}): Promise<{ directory: string; files: DownloadedRecordAsset[]; sizeBytes: number; checksumSha256: string }> {
  const { assets, source } = options;
  if (assets.length === 0) throw new Error(`The ${source} preview has no files to import. Preview it again.`);
  const limit = recordMaxDownloadBytes();
  const declared = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (declared > limit) throw new Error(`The selected ${source} files exceed this server's download limit of ${formatBytes(limit)}.`);
  const directory = path.join(context.storage.cacheDir, "files");
  assertPathInsideBase(directory, context.storage.cacheDir, `${source} download directory`);
  await fs.mkdir(directory, { recursive: true });
  const signal = AbortSignal.any([AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), ...(context.signal ? [context.signal] : [])]);
  const stored = new Set<string>();
  const files: DownloadedRecordAsset[] = [];
  let downloaded = 0;

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (!options.allowUrl(asset.url)) throw new Error(`${source} returned an unexpected download address. Preview it again.`);
    const storedFilename = options.storedFilename(asset, index);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(storedFilename) || stored.has(storedFilename)) {
      throw new Error(`${source} returned a file name that cannot be stored safely.`);
    }
    stored.add(storedFilename);
    const destination = path.join(directory, storedFilename);
    assertPathInsideBase(destination, directory, `${source} file`);
    const remaining = limit - downloaded;
    if (remaining <= 0 || asset.bytes > remaining) throw new Error(`The selected ${source} files exceed this server's download limit of ${formatBytes(limit)}.`);

    await context.log(`Downloading ${asset.filename} from ${source}.`);
    await context.update({
      status: "running",
      phase: `Downloading file ${index + 1} of ${assets.length}`,
      progress: declared ? Math.floor((downloaded / declared) * 90) : Math.floor((index / assets.length) * 90),
      targetPath: destination,
    });

    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(asset.url, { redirect: options.allowRedirectTo ? "follow" : "error", cache: "no-store", headers: { "accept-encoding": "identity", "user-agent": SOURCE_USER_AGENT }, signal });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      throw unreachable(source, error);
    }
    if (options.allowRedirectTo && response.url && response.url !== asset.url && !options.allowRedirectTo(response.url)) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${source} redirected ${asset.filename} to an unexpected address.`);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 || response.status === 410) throw new Error(`${source} no longer offers ${asset.filename}. Preview it again.`);
      throw httpProblem(source, response.status);
    }

    const temporary = `${destination}.part`;
    const md5 = crypto.createHash("md5");
    const sha256 = crypto.createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > remaining) return callback(new Error(`The ${source} download exceeds this server's download limit of ${formatBytes(limit)}.`));
        if (asset.bytes > 0 && bytes > asset.bytes) return callback(new Error(`${asset.filename} is larger than ${source} declared. Preview it again.`));
        md5.update(chunk);
        sha256.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal });
      if (asset.bytes > 0 && bytes !== asset.bytes) throw new Error(`${asset.filename} arrived incomplete from ${source}. Try the import again.`);
      const md5Hex = md5.digest("hex");
      const expectedMd5 = options.md5?.(asset);
      if (expectedMd5 && expectedMd5 !== md5Hex) throw new Error(`${asset.filename} did not match the checksum ${source} published. Try the import again.`);
      await options.check?.(asset, temporary);
      await fs.rename(temporary, destination);
      downloaded += bytes;
      files.push({ ...asset, bytes, storedFilename, md5: md5Hex, sha256: sha256.digest("hex") });
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  await context.update({ phase: "verifying", progress: 95 });
  await context.log(`Verified ${files.length} ${source} file(s), ${formatBytes(downloaded)}.`);
  const checksumSha256 = crypto.createHash("sha256")
    .update(stableStringify(files.map(file => ({ path: file.storedFilename, sha256: file.sha256 }))))
    .digest("hex");
  return { directory, files, sizeBytes: downloaded, checksumSha256 };
}

/** First bytes of a downloaded file, for cheap format checks. */
export async function readHead(filePath: string, bytes = 256): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function manifestEntry(file: DownloadedRecordAsset) {
  return { role: file.role, filename: file.filename, storedFilename: `files/${file.storedFilename}`, sourceUrl: file.url, sourceVersion: file.etag || undefined, bytes: file.bytes, md5: file.md5, sha256: file.sha256 };
}
