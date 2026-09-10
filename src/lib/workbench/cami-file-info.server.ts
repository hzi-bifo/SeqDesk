import { camiCatalog } from "./importers/cami-catalog";
import { camiAsset, camiObjectHeaders } from "./importers/cami-benchmark";
import { camiFilesQuerySchema, type CamiFilesQuery, type CamiSampleFileInfo } from "./cami-sample-types";

const CACHE_TTL_MS = 15 * 60 * 1000;
// At most 60 curated archives; share both results and in-flight header checks.
const sizes = new Map<string, { expiresAt: number; result: Promise<number | null> }>();

async function archiveSize(query: CamiFilesQuery, sample: number): Promise<number | null> {
  const { url } = camiAsset({ ...query, sample, role: "reads", processingDeclaration: undefined });
  const cached = sizes.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const entry = { expiresAt: Infinity, result: Promise.resolve<number | null>(null) };
  entry.result = (async () => {
    try {
      // Never download an archive just to populate the sample cards.
      const response = await fetch(url, {
        method: "HEAD", redirect: "error", cache: "no-store",
        headers: { "accept-encoding": "identity" }, signal: AbortSignal.timeout(8000),
      });
      if (response.status !== 200) throw new Error("Archive headers unavailable");
      const { bytes } = camiObjectHeaders(response.headers);
      entry.expiresAt = Date.now() + CACHE_TTL_MS;
      return bytes;
    } catch {
      // A metadata outage must not block sample selection; retries check only
      // failed entries. The normal import preview still revalidates all assets.
      sizes.delete(url);
      return null;
    }
  })();
  sizes.set(url, entry);
  return entry.result;
}

export async function getCamiSampleFileInfo(input: CamiFilesQuery): Promise<CamiSampleFileInfo[]> {
  const query = camiFilesQuerySchema.parse(input);
  const count = camiCatalog[query.dataset].samples;
  const files = new Array<CamiSampleFileInfo>(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, count) }, async () => {
    while (next < count) {
      const sample = next++;
      files[sample] = { sample, downloadBytes: await archiveSize(query, sample) };
    }
  }));
  return files;
}
