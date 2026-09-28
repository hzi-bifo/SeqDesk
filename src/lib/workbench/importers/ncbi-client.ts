/**
 * NCBI requests for the connectors (E-utilities and the Datasets API): one limiter for the whole server process,
 * an optional API key, a timeout and one retry, and plain-sentence errors.
 *
 * NCBI allows 3 requests a second per address without a key and 10 with one. The key is an administrator's setting
 * (stored encrypted in SeqDesk's settings like the ENA password, or NCBI_API_KEY in the environment). It is sent
 * to NCBI only, never logged, and never part of an error message: errors name the source, not the address.
 */
import { SOURCE_USER_AGENT } from "./public-record-download";

export const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
export const DATASETS_API = "https://api.ncbi.nlm.nih.gov/datasets/v2";
const KEY_PATTERN = /^[A-Za-z0-9]{20,64}$/;
const KEY_CACHE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

export function isValidNcbiApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

let cachedKey: { value: string | null; source: "settings" | "environment" | null; at: number } | null = null;

/** Forget the cached key (after an administrator changes it, and in tests). */
export function resetNcbiApiKeyCache(): void {
  cachedKey = null;
}

async function keyFromSettings(): Promise<string | null> {
  try {
    const [{ db }, { decryptSecret }] = await Promise.all([import("@/lib/db"), import("@/lib/security/secret-store")]);
    const settings = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
    const extra = settings?.extraSettings ? JSON.parse(settings.extraSettings) as Record<string, unknown> : {};
    const ncbi = extra.ncbi && typeof extra.ncbi === "object" ? extra.ncbi as Record<string, unknown> : {};
    const stored = typeof ncbi.apiKey === "string" ? decryptSecret(ncbi.apiKey) : null;
    return stored && isValidNcbiApiKey(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The key SeqDesk uses for NCBI and where it came from; the settings win over the environment. */
export async function ncbiApiKey(): Promise<{ value: string | null; source: "settings" | "environment" | null }> {
  if (cachedKey && Date.now() - cachedKey.at < KEY_CACHE_MS) return cachedKey;
  const stored = await keyFromSettings();
  const env = process.env.NCBI_API_KEY?.trim();
  cachedKey = stored ? { value: stored, source: "settings", at: Date.now() }
    : env && isValidNcbiApiKey(env) ? { value: env, source: "environment", at: Date.now() }
    : { value: null, source: null, at: Date.now() };
  return cachedKey;
}

/** Requests a second NCBI allows this server (3 without a key, 10 with one). */
export const ncbiRequestsPerSecond = (hasKey: boolean) => (hasKey ? 10 : 3);

let nextSlot = 0;
/** Wait for this process's next NCBI request slot; slots are spaced evenly, so bursts never exceed the limit. */
export async function ncbiSlot(hasKey: boolean, now: () => number = Date.now): Promise<void> {
  const spacing = Math.ceil(1000 / ncbiRequestsPerSecond(hasKey));
  const at = Math.max(now(), nextSlot);
  nextSlot = at + spacing;
  const wait = at - now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

/** Tests: start the limiter afresh. */
export function resetNcbiLimiter(): void {
  nextSlot = 0;
}

class NcbiStatusError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function plainStatus(source: string, status: number): string {
  if (status === 429) return `${source} is limiting requests right now. Try again in a minute.`;
  return `${source} did not answer as expected (HTTP ${status}). Try again later.`;
}

function retryable(error: unknown): boolean {
  if (error instanceof NcbiStatusError) return error.status === 429 || error.status >= 500;
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || error instanceof TypeError;
}

/**
 * One NCBI request with the limiter, the key (E-utilities: `api_key` parameter; Datasets: `api-key` header),
 * a timeout and one retry. `notFound` turns 400/404 into that sentence.
 */
export async function ncbiRequest(url: string, options: {
  source: string;
  accept?: string;
  body?: URLSearchParams;
  timeoutMs?: number;
  signal?: AbortSignal;
  notFound?: string;
  attempts?: number;
}): Promise<Response> {
  const key = (await ncbiApiKey()).value;
  const target = new URL(url);
  const eutils = target.origin + target.pathname.replace(/\/[^/]*$/, "") === EUTILS;
  const body = options.body ? new URLSearchParams(options.body) : undefined;
  if (eutils) {
    const params = body ?? target.searchParams;
    params.set("tool", "seqdesk");
    if (key) params.set("api_key", key);
  }
  const headers: Record<string, string> = { accept: options.accept ?? "application/json", "user-agent": SOURCE_USER_AGENT, ...(!eutils && key ? { "api-key": key } : {}) };
  const attempts = Math.max(1, options.attempts ?? 2);
  for (let attempt = 1; ; attempt += 1) {
    await ncbiSlot(Boolean(key));
    try {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const response = await fetch(target, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: body ? { ...headers, "content-type": "application/x-www-form-urlencoded" } : headers,
        ...(body ? { body } : {}),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if ((response.status === 404 || response.status === 400) && options.notFound) {
        await response.body?.cancel().catch(() => {});
        throw new Error(options.notFound);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new NcbiStatusError(response.status, plainStatus(options.source, response.status));
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt < attempts && retryable(error)) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      if (error instanceof NcbiStatusError) throw new Error(error.message);
      const name = (error as { name?: string } | null)?.name;
      if (name === "TimeoutError") throw new Error(`${options.source} did not answer in time. Try again later.`);
      if (error instanceof TypeError) throw new Error(`${options.source} could not be reached. Try again later.`);
      throw error;
    }
  }
}

/** An NCBI answer as text, bounded in size. */
export async function ncbiText(url: string, options: Parameters<typeof ncbiRequest>[1] & { maxBytes?: number }): Promise<string> {
  const response = await ncbiRequest(url, options);
  const limit = options.maxBytes ?? MAX_TEXT_BYTES;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(`${options.source} sent more than expected. Try fewer accessions.`);
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(options.source)) throw error;
    throw new Error(`${options.source} stopped answering midway. Try again later.`);
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function ncbiJson(url: string, options: Parameters<typeof ncbiText>[1]): Promise<unknown> {
  const text = await ncbiText(url, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${options.source} returned an answer that could not be read. Try again later.`);
  }
}

export const NCBI_LICENCE = "NCBI: public domain in the US; submitters may claim rights — see NCBI's policies";
export const NCBI_LICENCE_URL = "https://www.ncbi.nlm.nih.gov/home/about/policies/";
