import crypto from "crypto";

export interface ExploreCacheTokenInput {
  versionHash: string | null;
  /** Latest updatedAt of any sample in scope, ISO string or null. */
  samplesUpdatedAt: string | null;
  /** Number of non-revoked edits and the latest edit timestamp. */
  editCount: number;
  editsUpdatedAt: string | null;
  /** Sum of curation list versions in scope. */
  curationVersion: number;
}

/**
 * Every Explore view is a pure function of (dataset version, sample metadata,
 * curation). The token changes whenever one of those changes, so clients and
 * server caches can key on it without knowing which part moved.
 */
export function computeCacheToken(input: ExploreCacheTokenInput): string {
  const digest = crypto.createHash("sha1");
  digest.update(input.versionHash ?? "-");
  digest.update("|");
  digest.update(input.samplesUpdatedAt ?? "-");
  digest.update("|");
  digest.update(String(input.editCount));
  digest.update("|");
  digest.update(input.editsUpdatedAt ?? "-");
  digest.update("|");
  digest.update(String(input.curationVersion));
  return digest.digest("hex").slice(0, 20);
}
