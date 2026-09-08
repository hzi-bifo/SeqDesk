import { createHash } from "node:crypto";

/** Preserve submitter metadata as bounded inert XML; never resolve entities. */
export async function loadEnaMetadata(accessions: string[], signal?: AbortSignal) {
  const records: Record<string, { url: string; xml: string; sha256: string; retrievedAt: string }> = {};
  let total = 0;
  for (const accession of [...new Set(accessions)]) {
    if (!/^(?:[EDS]R[PSRX]\d+|PRJ(?:EB|DB|NA)\d+|SAM[END][A-Z]?\d+)$/.test(accession)) throw new Error("Invalid archive metadata accession");
    const url = `https://www.ebi.ac.uk/ena/browser/api/xml/${accession}`;
    const response = await fetch(url, { redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error(`Metadata unavailable for ${accession}`);
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; total += value.length;
        if (size > 2 * 1024 ** 2 || total > 16 * 1024 ** 2) throw new Error("Archive metadata size limit exceeded");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks); const xml = bytes.toString("utf8");
    if (!xml.includes("accession=") || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported archive metadata response");
    records[accession] = { url, xml, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: new Date().toISOString() };
  }
  return records;
}
