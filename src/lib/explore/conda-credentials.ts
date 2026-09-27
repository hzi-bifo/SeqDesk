/**
 * Channel URLs can carry credentials: an anaconda.org token (`/t/<token>/`),
 * user:password@ or a token query parameter, added by a user's .condarc or
 * a mamba login. conda and micromamba copy them into every package record
 * of a prefix (conda-meta/*.json) and into the build log. They never belong
 * in a lock, a capsule, a log or a place a sandboxed analysis can read (the
 * prefix is bound into every run), so they are stripped.
 */
import fs from "fs/promises";
import path from "path";

/** Pure. */
export function stripChannelCredentials(text: string): string {
  return text
    .replace(/\/t\/[^/\s#"]+\//g, "/")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@#"]+@/gi, "$1")
    .replace(/([?&](?:token|access_token|auth)=)[^&#\s"]+/gi, "$1REDACTED");
}

async function scrubFile(file: string): Promise<boolean> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return false;
  const clean = stripChannelCredentials(text);
  if (clean === text) return false;
  const temp = `${file}.scrub-${process.pid}`;
  await fs.writeFile(temp, clean, "utf8");
  await fs.rename(temp, file);
  return true;
}

/**
 * Remove channel credentials from a built prefix's package records and its
 * build log, in place. Returns how many files changed. Never throws.
 */
export async function scrubPrefixCredentials(prefix: string, logPath?: string | null): Promise<number> {
  let changed = 0;
  try {
    const metaDir = path.join(prefix, "conda-meta");
    const entries = await fs.readdir(metaDir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (entry.endsWith(".json") || entry === "history") {
        if (await scrubFile(path.join(metaDir, entry)).catch(() => false)) changed += 1;
      }
    }
    if (logPath && (await scrubFile(logPath).catch(() => false))) changed += 1;
  } catch {
    // best effort
  }
  return changed;
}
