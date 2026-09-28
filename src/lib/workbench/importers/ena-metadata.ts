import { createHash } from "node:crypto";

/**
 * The ENA browser XML API often takes 15-30 s (sometimes longer) to answer a record that is not in its cache, although the
 * filereport answers at once. Each record gets a generous timeout and one retry, and the records load in parallel.
 */
export const ENA_METADATA_TIMEOUT_MS = 90_000;
const ENA_METADATA_ATTEMPTS = 2;

function retryable(error: unknown) {
  if (error instanceof ResponseStatusError) return error.status >= 500 || error.status === 429;
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || error instanceof TypeError; // fetch failed: reset, DNS, TLS
}

class ResponseStatusError extends Error {
  constructor(readonly status: number, accession: string) { super(`Metadata unavailable for ${accession}`); }
}

/** Preserve submitter metadata as bounded inert XML; never resolve entities. */
export async function loadEnaMetadata(accessions: string[], signal?: AbortSignal, timeoutMs = ENA_METADATA_TIMEOUT_MS) {
  const records: Record<string, { url: string; xml: string; sha256: string; retrievedAt: string }> = {};
  let total = 0;
  const unique = [...new Set(accessions)];
  for (const accession of unique) {
    if (!/^(?:[EDS]R[PSRX]\d+|PRJ(?:EB|DB|NA)\d+|SAM[END][A-Z]?\d+)$/.test(accession)) throw new Error("Invalid archive metadata accession");
  }
  const loadOnce = async (accession: string, url: string) => {
    const response = await fetch(url, { redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) throw new ResponseStatusError(response.status, accession);
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; total += value.length;
        if (size > 2 * 1024 ** 2 || total > 16 * 1024 ** 2) throw new Error("Archive metadata size limit exceeded");
        chunks.push(value);
      }
    } catch (error) { total -= size; throw error; } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  };
  const load = async (accession: string) => {
    const url = `https://www.ebi.ac.uk/ena/browser/api/xml/${accession}`;
    let bytes: Buffer | undefined;
    for (let attempt = 1; !bytes; attempt += 1) {
      try { bytes = await loadOnce(accession, url); }
      catch (error) { if (signal?.aborted || attempt >= ENA_METADATA_ATTEMPTS || !retryable(error)) throw error; }
    }
    const xml = bytes.toString("utf8");
    if (!xml.includes("accession=") || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported archive metadata response");
    return [accession, { url, xml, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: new Date().toISOString() }] as const;
  };
  for (const [accession, record] of await Promise.all(unique.map(load))) records[accession] = record;
  return records;
}
