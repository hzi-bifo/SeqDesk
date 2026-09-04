import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { getEnvironmentsDir } from "./kits/loader";
import { resolveExploreStorage } from "./storage";

export interface ExploreEnvironmentSummary {
  name: string;
  specHash: string;
  status: "missing" | "building" | "ready" | "failed" | "stale";
  prefixPath: string | null;
  builtAt: string | null;
  lastError: string | null;
  spec: string;
}

function hashSpec(spec: string): string {
  return crypto.createHash("sha256").update(spec.replace(/\r\n/g, "\n").trim()).digest("hex").slice(0, 16);
}

/** Spec files shipped with the app: explore/environments/<name>.yml */
export async function readEnvironmentSpecs(): Promise<Map<string, string>> {
  const dir = getEnvironmentsDir();
  const specs = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return specs;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const name = entry.replace(/\.ya?ml$/, "");
    specs.set(name, await fs.readFile(path.join(dir, entry), "utf8"));
  }
  return specs;
}

/**
 * Make sure every shipped spec has a database record. A record whose hash no
 * longer matches the shipped spec is reported as stale so an admin can rebuild.
 */
export async function listEnvironments(): Promise<ExploreEnvironmentSummary[]> {
  const specs = await readEnvironmentSpecs();
  const records = await db.exploreEnvironment.findMany({ orderBy: { name: "asc" } });
  const byName = new Map(records.map((record) => [record.name, record] as const));
  const out: ExploreEnvironmentSummary[] = [];
  for (const [name, spec] of specs) {
    const specHash = hashSpec(spec);
    const record = byName.get(name);
    if (!record) {
      const created = await db.exploreEnvironment.create({ data: { name, spec, specHash, status: "missing" } });
      byName.set(name, created);
      out.push({ name, specHash, status: "missing", prefixPath: null, builtAt: null, lastError: null, spec });
      continue;
    }
    const stale = record.status === "ready" && record.specHash !== specHash;
    out.push({
      name,
      specHash,
      status: stale ? "stale" : (record.status as ExploreEnvironmentSummary["status"]),
      prefixPath: record.prefixPath,
      builtAt: record.builtAt ? record.builtAt.toISOString() : null,
      lastError: record.lastError,
      spec,
    });
    byName.delete(name);
  }
  for (const record of byName.values()) {
    out.push({
      name: record.name,
      specHash: record.specHash,
      status: record.status as ExploreEnvironmentSummary["status"],
      prefixPath: record.prefixPath,
      builtAt: record.builtAt ? record.builtAt.toISOString() : null,
      lastError: record.lastError,
      spec: record.spec,
    });
  }
  return out;
}

export async function resolveCondaExecutable(): Promise<string> {
  const settings = await getExecutionSettings();
  const base = settings.condaPath?.trim();
  if (base) {
    const candidate = path.join(base, "bin", "conda");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // fall through to PATH lookup
    }
  }
  return "conda";
}

async function environmentsRoot(): Promise<string> {
  const settings = await getExecutionSettings();
  const cache = settings.condaCacheDir?.trim();
  if (cache) return path.join(path.resolve(cache), "explore-environments");
  const storage = await resolveExploreStorage();
  return path.join(storage.baseDir, "environments");
}

/**
 * Build one environment with `conda env create -p <prefix> -f <spec>`. The
 * prefix embeds the spec hash, so a changed spec gets a fresh prefix and the
 * old one can be removed once no run references it. Runs in the background;
 * the record's status tracks progress.
 */
export async function buildEnvironment(name: string): Promise<{ started: boolean; message: string }> {
  const specs = await readEnvironmentSpecs();
  const spec = specs.get(name);
  if (!spec) return { started: false, message: `No specification file for environment ${name}` };
  const specHash = hashSpec(spec);
  const record = await db.exploreEnvironment.upsert({
    where: { name },
    update: { spec, specHash },
    create: { name, spec, specHash, status: "missing" },
  });
  if (record.status === "building") return { started: false, message: "A build is already in progress" };

  const root = await environmentsRoot();
  await fs.mkdir(root, { recursive: true });
  const prefix = path.join(root, `${name}-${specHash}`);
  const specPath = path.join(root, `${name}-${specHash}.yml`);
  await fs.writeFile(specPath, spec, "utf8");
  const logPath = path.join(root, `${name}-${specHash}.log`);
  const conda = await resolveCondaExecutable();

  await db.exploreEnvironment.update({
    where: { name },
    data: { status: "building", lastError: null, prefixPath: prefix },
  });

  const log = await fs.open(logPath, "w");
  const child = spawn(conda, ["env", "create", "--yes", "-p", prefix, "-f", specPath], {
    stdio: ["ignore", log.fd, log.fd],
    detached: true,
    env: { ...process.env, CONDA_ALWAYS_YES: "true" },
  });
  child.unref();
  child.on("error", async (error) => {
    await log.close().catch(() => {});
    await db.exploreEnvironment.update({
      where: { name },
      data: { status: "failed", lastError: `conda could not be started: ${error.message}` },
    });
  });
  child.on("close", async (code) => {
    await log.close().catch(() => {});
    if (code === 0) {
      await db.exploreEnvironment.update({
        where: { name },
        data: { status: "ready", builtAt: new Date(), lastError: null, prefixPath: prefix },
      });
    } else {
      const tail = await fs
        .readFile(logPath, "utf8")
        .then((text) => text.split("\n").slice(-30).join("\n"))
        .catch(() => "");
      await db.exploreEnvironment.update({
        where: { name },
        data: { status: "failed", lastError: `conda env create exited with ${code}\n${tail}`.slice(0, 4000) },
      });
    }
  });
  return { started: true, message: `Building ${name} in ${prefix}` };
}

/**
 * The prefix of a ready environment, or null. Used by the runner to decide
 * whether a run can be prepared.
 */
export async function resolveReadyEnvironment(name: string): Promise<{ prefixPath: string; specHash: string } | null> {
  const record = await db.exploreEnvironment.findUnique({ where: { name } });
  if (!record || record.status !== "ready" || !record.prefixPath) return null;
  return { prefixPath: record.prefixPath, specHash: record.specHash };
}

/**
 * Point a record at an environment that already exists (for example one built
 * by the installer or by hand). Verified by looking for bin/python or bin/R.
 */
export async function registerExistingEnvironment(name: string, prefixPath: string): Promise<void> {
  const resolved = path.resolve(prefixPath);
  const candidates = [path.join(resolved, "bin", "python"), path.join(resolved, "bin", "Rscript")];
  let found = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      found = true;
      break;
    } catch {
      // try next
    }
  }
  if (!found) throw new Error("No python or Rscript binary found in that prefix");
  const specs = await readEnvironmentSpecs();
  const spec = specs.get(name) ?? "";
  await db.exploreEnvironment.upsert({
    where: { name },
    update: { status: "ready", prefixPath: resolved, builtAt: new Date(), lastError: null, spec: spec || undefined, specHash: spec ? hashSpec(spec) : "manual" },
    create: { name, spec, specHash: spec ? hashSpec(spec) : "manual", status: "ready", prefixPath: resolved, builtAt: new Date() },
  });
}

export { hashSpec as hashEnvironmentSpec };
