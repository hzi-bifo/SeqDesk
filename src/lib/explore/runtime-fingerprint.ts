import crypto from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * A fingerprint of the code that finalizes Explore runs. The explore monitor is
 * a long-lived process: it keeps whatever run-finalize.ts it loaded at start,
 * so an update on disk goes unnoticed until it is restarted. It records the
 * fingerprint of the files it loaded, compares it with the files on disk on
 * every tick and restarts itself when they differ; every finalized run records
 * the fingerprint it was finished with, so the web can tell older results apart.
 */

/** Exit code the monitor uses when it leaves because its code is stale (EX_TEMPFAIL: try again on the new code). */
export const STALE_RUNTIME_EXIT_CODE = 75;

/** Written at build time (optional): when present it stands in for hashing the sources. */
export const RUNTIME_VERSION_FILE = ".explore-runtime-version";

/** Files and folders whose contents make up the finalizer runtime, relative to the repo root. */
export const RUNTIME_SOURCES = [
  "scripts/explore-monitor.ts",
  "scripts/explore-monitor.js",
  "src/lib/explore",
  "src/lib/pipelines/run-completion.ts",
  "src/lib/pipelines/nextflow.ts",
  "src/lib/integration/events.ts",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);

function isRuntimeSource(file: string): boolean {
  if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
  if (/\.test\.[cm]?[jt]s$/.test(file) || file.includes(`${path.sep}__fixtures__${path.sep}`)) return false;
  return true;
}

/** Every runtime source file below `root`, sorted so the hash is stable. */
export function listRuntimeFiles(root: string, sources: string[] = RUNTIME_SOURCES): string[] {
  const files: string[] = [];
  const walk = (absolute: string) => {
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(path.join(absolute, entry));
      }
    } else if (stat.isFile() && isRuntimeSource(absolute)) {
      files.push(absolute);
    }
  };
  for (const source of sources) walk(path.join(root, source));
  return [...new Set(files)].sort();
}

/**
 * The runtime fingerprint (12 hex characters). A version file written at build
 * wins; otherwise the contents of the runtime sources are hashed.
 */
export function computeRuntimeFingerprint(root: string, sources: string[] = RUNTIME_SOURCES): string {
  const versionFile = path.join(root, RUNTIME_VERSION_FILE);
  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, "utf8").trim();
    if (version) return crypto.createHash("sha256").update(`version:${version}`).digest("hex").slice(0, 12);
  }
  const hash = crypto.createHash("sha256");
  for (const file of listRuntimeFiles(root, sources)) {
    hash.update(path.relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

let loadedFingerprint: string | null = null;

/** The fingerprint of the code this process loaded (computed once, at first use). */
export function loadedRuntimeFingerprint(root: string = process.cwd()): string {
  if (!loadedFingerprint) loadedFingerprint = computeRuntimeFingerprint(root);
  return loadedFingerprint;
}

/** Test hook. */
export function resetLoadedRuntimeFingerprint(value: string | null = null): void {
  loadedFingerprint = value;
}

/** True when the runtime on disk differs from the one this process loaded. */
export function runtimeIsStale(loaded: string, root: string = process.cwd()): boolean {
  try {
    return computeRuntimeFingerprint(root) !== loaded;
  } catch {
    return false;
  }
}

/** What a finalized run records about the code that produced and finished it. */
export interface RunRuntimeInfo {
  finalizer: string;
  helper: { language: string | null; version: string | null } | null;
}

export function runRuntimeInfo(finalizer: string, manifest: { helperVersion?: unknown; language?: unknown } | null): RunRuntimeInfo {
  const version = typeof manifest?.helperVersion === "string" ? manifest.helperVersion.slice(0, 40) : null;
  const language = typeof manifest?.language === "string" ? manifest.language.slice(0, 20) : null;
  return { finalizer, helper: version || language ? { language, version } : null };
}

let currentCache: { at: number; value: string } | null = null;

/** The fingerprint of the runtime on disk now (cached briefly: hashing reads every source). */
export function currentRuntimeFingerprint(root: string = process.cwd(), now: number = Date.now()): string | null {
  if (currentCache && now - currentCache.at < 15_000) return currentCache.value;
  try {
    currentCache = { at: now, value: computeRuntimeFingerprint(root) };
    return currentCache.value;
  } catch {
    return null;
  }
}

/** The runtime a finalized run recorded in its results, or null for runs finished before it was recorded. */
export function runtimeOfResults(results: string | null | undefined): RunRuntimeInfo | null {
  if (!results) return null;
  try {
    const runtime = (JSON.parse(results) as { runtime?: unknown }).runtime as Partial<RunRuntimeInfo> | undefined;
    if (!runtime || typeof runtime.finalizer !== "string") return null;
    const helper = runtime.helper && typeof runtime.helper === "object" ? runtime.helper : null;
    return { finalizer: runtime.finalizer, helper: helper ? { language: typeof helper.language === "string" ? helper.language : null, version: typeof helper.version === "string" ? helper.version : null } : null };
  } catch {
    return null;
  }
}
