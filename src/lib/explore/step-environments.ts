/**
 * Step environments: a step runs in a shipped base environment
 * (explore/environments/<base>.yml) plus, optionally, extra conda packages it
 * declares (ExploreAnalysis.packages). The effective spec is the base spec with
 * the extras merged in (an extra replaces a base dependency of the same name),
 * normalised so the same set of packages always gives the same environment.
 *
 * Derived environments are ExploreEnvironment rows named `<base>+<key>` with
 * `baseName`, `baseSpecHash` and `packages` set. They are built by the same
 * detached `conda env create` as the bases (buildEnvironment) and reused by
 * every step and run with the same key. A changed base spec gives a new key,
 * so a derived environment never silently drifts from its base.
 *
 * Runs never install packages: a step whose environment is not ready waits
 * (flow runs) or is refused with the preparing state (single runs) while the
 * build runs in the background.
 *
 * Cleanup: pruneStepEnvironments() removes the prefix of every derived
 * environment not used for STEP_ENVIRONMENT_UNUSED_DAYS days, and of the least
 * recently used ones beyond STEP_ENVIRONMENT_CAP. The row (spec, lock digest)
 * stays so capsules and the run record still name what was used; the next use
 * rebuilds it. There is no cron: call it from an admin action or a script.
 */
import crypto from "crypto";
import fs from "fs/promises";
import { db } from "@/lib/db";
import { buildEnvironment, hashEnvironmentSpec, readBuildLogTail, readEnvironmentSpecs, reconcileEnvironmentRecord } from "./environments";

export const MAX_STEP_PACKAGES = 40;
export const MAX_PACKAGE_SPEC_LENGTH = 120;
export const STEP_ENVIRONMENT_UNUSED_DAYS = 30;
export const STEP_ENVIRONMENT_CAP = 20;

export interface StepPackages {
  packages: string[];
  channels: string[];
}

export class PackageSpecError extends Error {}

/*
 * A conda match spec, restricted to what a step needs: an optional channel
 * ("bioconda::"), a package name, and an optional version constraint made of
 * version characters and comparison operators ("=1.42", ">=1.40,<1.44",
 * "=1.42.*", "==2.0.1"). No whitespace, quotes, slashes, brackets, `$`, `;`,
 * `|`, `&` or backticks: nothing a shell or a YAML parser would read as more
 * than one package.
 */
const NAME = "[a-z0-9][a-z0-9_.-]*";
const VERSION = "[0-9a-z*][0-9a-z_.*+!]*";
const CONSTRAINT = `(?:==|>=|<=|!=|~=|=|<|>)${VERSION}`;
const PACKAGE_RE = new RegExp(`^(?:(${NAME})::)?(${NAME})((?:${CONSTRAINT})(?:,${CONSTRAINT})*)?$`);
const CHANNEL_RE = new RegExp(`^${NAME}$`);

/** "Bioconductor-DESeq2 = 1.42" -> "bioconductor-deseq2=1.42"; throws PackageSpecError for anything else. */
export function normalizePackageSpec(raw: unknown): string {
  if (typeof raw !== "string") throw new PackageSpecError("A package is a text like bioconductor-deseq2 or bioconductor-deseq2=1.42.");
  const trimmed = raw.trim();
  if (!trimmed) throw new PackageSpecError("A package name is empty.");
  if (trimmed.length > MAX_PACKAGE_SPEC_LENGTH) throw new PackageSpecError(`A package spec is longer than ${MAX_PACKAGE_SPEC_LENGTH} characters.`);
  // Spaces around operators are forgiven ("deseq2 >= 1.4"); spaces anywhere else are not.
  const compact = trimmed.toLowerCase().replace(/\s*(==|>=|<=|!=|~=|=|<|>|,)\s*/g, "$1");
  if (!PACKAGE_RE.test(compact)) throw new PackageSpecError(`"${trimmed.slice(0, 60)}" is not a conda package spec. Use a name with an optional version, like bioconductor-deseq2=1.42.`);
  return compact;
}

/** The package name of a normalised spec: "bioconda::bioconductor-deseq2=1.42" -> "bioconductor-deseq2". */
export function packageName(spec: string): string {
  const match = PACKAGE_RE.exec(spec);
  return match ? match[2] : spec;
}

/** Validate and normalise a step's packages: one spec per name (the last wins), sorted; channels deduped in order. */
export function normalizeStepPackages(input: unknown): StepPackages {
  if (input === null || input === undefined) return { packages: [], channels: [] };
  const record = Array.isArray(input) ? { packages: input } : typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!record) throw new PackageSpecError("Send packages as a list.");
  const rawPackages = record.packages ?? [];
  const rawChannels = record.channels ?? [];
  if (!Array.isArray(rawPackages) || !Array.isArray(rawChannels)) throw new PackageSpecError("Send packages and channels as lists.");
  if (rawPackages.length > MAX_STEP_PACKAGES) throw new PackageSpecError(`A step can add at most ${MAX_STEP_PACKAGES} packages.`);
  const byName = new Map<string, string>();
  for (const raw of rawPackages) {
    const spec = normalizePackageSpec(raw);
    byName.set(packageName(spec), spec);
  }
  const channels: string[] = [];
  for (const raw of rawChannels) {
    const channel = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!CHANNEL_RE.test(channel) || channel.length > 60) throw new PackageSpecError(`"${String(raw).slice(0, 60)}" is not a channel name. Use a name like bioconda or conda-forge.`);
    if (!channels.includes(channel)) channels.push(channel);
  }
  if (channels.length > 8) throw new PackageSpecError("A step can add at most 8 channels.");
  return { packages: [...byName.values()].sort(), channels };
}

/** The stored packages of a step, tolerant of rows written before this existed. */
export function stepPackagesOf(stored: unknown): StepPackages {
  try {
    return normalizeStepPackages(stored);
  } catch {
    return { packages: [], channels: [] };
  }
}

interface ParsedSpec {
  channels: string[];
  dependencies: string[];
}

/** The two lists a shipped spec is made of. The specs are flat YAML lists; comments and blank lines are dropped. */
export function parseBaseSpec(spec: string): ParsedSpec {
  const out: ParsedSpec = { channels: [], dependencies: [] };
  let section: keyof ParsedSpec | null = null;
  for (const raw of spec.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (!line.trim()) continue;
    const top = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (top) {
      section = top[1] === "channels" || top[1] === "dependencies" ? top[1] : null;
      const inline = /^\[(.*)\]$/.exec(top[2].trim());
      if (section && inline) out[section].push(...inline[1].split(",").map((item) => item.trim()).filter(Boolean));
      continue;
    }
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && section) out[section].push(item[1].trim());
  }
  return out;
}

/** Name of a base dependency line: "r-base=4.3.*" -> "r-base", "pandas>=2.1" -> "pandas". */
function dependencyName(dependency: string): string {
  return dependency.replace(/^[^:]+::/, "").split(/[=<>!~\s]/)[0].toLowerCase();
}

export interface DerivedEnvironment {
  name: string;
  baseName: string;
  baseSpecHash: string;
  key: string;
  spec: string;
  packages: StepPackages;
}

/**
 * The effective environment of a base plus packages. With no packages it is the
 * base itself (name === baseName). The key hashes the base spec hash and the
 * normalised packages, so reordering or repeating packages gives the same key.
 */
export function deriveEnvironment(baseName: string, baseSpec: string, input: StepPackages): DerivedEnvironment {
  const packages = normalizeStepPackages(input);
  const baseSpecHash = hashEnvironmentSpec(baseSpec);
  if (!packages.packages.length) return { name: baseName, baseName, baseSpecHash, key: baseSpecHash, spec: baseSpec, packages };
  const key = crypto.createHash("sha256").update(JSON.stringify({ base: baseName, baseSpecHash, packages: packages.packages, channels: packages.channels })).digest("hex").slice(0, 12);
  const name = `${baseName}+${key}`;
  const base = parseBaseSpec(baseSpec);
  const extraNames = new Set(packages.packages.map(packageName));
  // Extra channels go before the base's; nodefaults stays last.
  const channels = [...packages.channels, ...base.channels].filter((channel, index, all) => all.indexOf(channel) === index);
  const tail = channels.filter((channel) => channel === "nodefaults");
  const orderedChannels = [...channels.filter((channel) => channel !== "nodefaults"), ...tail];
  const dependencies = [...base.dependencies.filter((dependency) => !extraNames.has(dependencyName(dependency))), ...packages.packages];
  const spec = [
    `# Step environment: ${baseName} (spec ${baseSpecHash}) plus ${packages.packages.length} package${packages.packages.length === 1 ? "" : "s"}.`,
    "# Written by SeqDesk from the base spec and the step's packages; do not edit.",
    `name: ${name}`,
    "channels:",
    ...orderedChannels.map((channel) => `  - ${channel}`),
    "dependencies:",
    ...dependencies.map((dependency) => `  - ${dependency}`),
    "",
  ].join("\n");
  return { name, baseName, baseSpecHash, key, spec, packages };
}

export type StepEnvironmentStatus = "missing" | "building" | "ready" | "failed" | "stale";

export interface StepEnvironmentState {
  name: string;
  baseName: string;
  derived: boolean;
  status: StepEnvironmentStatus;
  specHash: string;
  packages: StepPackages;
  prefixPath: string | null;
  lockDigest: string | null;
  builtAt: string | null;
  /** The conda error or build log tail when the build failed; the progress tail while it builds. */
  log: string | null;
  error: string | null;
}

/** Base environments with their dependency lists, for the step's Environment block. */
export async function listBaseEnvironments() {
  const specs = await readEnvironmentSpecs();
  const records = new Map((await db.exploreEnvironment.findMany({ where: { name: { in: [...specs.keys()] } } })).map((record) => [record.name, record] as const));
  return [...specs.entries()].map(([name, spec]) => {
    const parsed = parseBaseSpec(spec);
    const record = records.get(name);
    const specHash = hashEnvironmentSpec(spec);
    const languageDep = parsed.dependencies.find((dependency) => /^(r-base|python)[=<>]/.test(dependency)) ?? null;
    return {
      name,
      language: name.endsWith("-r") || parsed.dependencies.some((dependency) => dependencyName(dependency) === "r-base") ? "r" : "python",
      languageVersion: record?.languageVersion ?? (languageDep ? languageDep.replace(/^[^=<>]+[=<>]+/, "").replace(/\.\*$/, "") : null),
      specHash,
      status: !record ? "missing" : record.status === "ready" && record.specHash !== specHash ? "stale" : record.status,
      lockDigest: record && record.lockSpecHash === record.specHash ? record.lockDigest : null,
      channels: parsed.channels,
      packages: parsed.dependencies,
    };
  });
}

type EnvironmentRow = NonNullable<Awaited<ReturnType<typeof db.exploreEnvironment.findUnique>>>;

async function stateOf(derived: DerivedEnvironment, row: EnvironmentRow | null): Promise<StepEnvironmentState> {
  const record = row ? await reconcileEnvironmentRecord(row) : null;
  const expectedHash = hashEnvironmentSpec(derived.spec);
  let status: StepEnvironmentStatus = (record?.status as StepEnvironmentStatus) ?? "missing";
  if (record && record.status === "ready" && record.specHash !== expectedHash) status = "stale";
  const log = record && (status === "building" || status === "failed") ? await readBuildLogTail(record.prefixPath, 30) : null;
  return {
    name: derived.name,
    baseName: derived.baseName,
    derived: derived.name !== derived.baseName,
    status,
    specHash: expectedHash,
    packages: derived.packages,
    prefixPath: record?.prefixPath ?? null,
    lockDigest: record && record.lockSpecHash === record.specHash ? record.lockDigest : null,
    builtAt: record?.builtAt ? record.builtAt.toISOString() : null,
    log: status === "failed" ? condaErrorExcerpt(record?.lastError ?? log ?? "") : log,
    error: status === "failed" ? record?.lastError ?? null : null,
  };
}

/** The lines of a failed conda build worth showing a person: the error and what it names, not the whole log. */
export function condaErrorExcerpt(text: string): string {
  const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const start = lines.findIndex((line) => /LibMambaUnsatisfiableError|PackagesNotFoundError|ResolvePackageNotFound|UnsatisfiableError|CondaError|CondaHTTPError|error:|Could not solve|nothing provides/i.test(line));
  const picked = start >= 0 ? lines.slice(start, start + 20) : lines.slice(-20);
  return picked.join("\n").slice(0, 2000);
}

/**
 * The effective environment of a step (analysis). A step without packages uses
 * its base as today. A step with packages gets its derived row (created as
 * "missing" on first sight) and touches lastUsedAt.
 */
export async function resolveStepEnvironment(analysis: { environmentName: string; packages?: unknown }): Promise<StepEnvironmentState> {
  const packages = stepPackagesOf(analysis.packages);
  const specs = await readEnvironmentSpecs();
  const baseSpec = specs.get(analysis.environmentName);
  // No shipped spec (an environment registered by hand): packages cannot be layered on it; use it as is.
  if (!baseSpec || !packages.packages.length) {
    const row = await db.exploreEnvironment.findUnique({ where: { name: analysis.environmentName } });
    const derived: DerivedEnvironment = { name: analysis.environmentName, baseName: analysis.environmentName, baseSpecHash: row?.specHash ?? "", key: "", spec: baseSpec ?? row?.spec ?? "", packages: { packages: [], channels: [] } };
    const state = await stateOf(derived, row);
    if (!baseSpec && row) state.specHash = row.specHash;
    return state;
  }
  const derived = deriveEnvironment(analysis.environmentName, baseSpec, packages);
  const specHash = hashEnvironmentSpec(derived.spec);
  const row = await db.exploreEnvironment.upsert({
    where: { name: derived.name },
    update: { lastUsedAt: new Date() },
    create: {
      name: derived.name, spec: derived.spec, specHash, status: "missing", baseName: derived.baseName, baseSpecHash: derived.baseSpecHash,
      packages: derived.packages as unknown as object, lastUsedAt: new Date(),
    },
  });
  return stateOf(derived, row);
}

/** Start the build of a step's environment unless it is ready or already building. */
export async function prepareStepEnvironment(analysis: { environmentName: string; packages?: unknown }, options: { retryFailed?: boolean } = {}): Promise<StepEnvironmentState> {
  const state = await resolveStepEnvironment(analysis);
  if (state.status === "ready" || state.status === "building") return state;
  if (state.status === "failed" && !options.retryFailed) return state;
  // Shipped bases stay an admin's decision (they are shared by everyone); a step only builds its own derived environment.
  if (!state.derived) return state;
  await buildEnvironment(state.name);
  return resolveStepEnvironment(analysis);
}

/** Words for a step waiting on its environment. */
export function preparingWords(state: Pick<StepEnvironmentState, "packages">): string {
  const count = state.packages.packages.length;
  return `Preparing environment · installing ${count} package${count === 1 ? "" : "s"}`;
}

/**
 * Remove the prefixes of derived environments nobody used for `unusedDays`
 * days, and of the least recently used ones beyond `cap`. Rows are kept
 * (status back to "missing") so capsules and run records keep their spec.
 */
export async function pruneStepEnvironments(options: { unusedDays?: number; cap?: number; now?: Date; dryRun?: boolean } = {}): Promise<{ pruned: string[] }> {
  const unusedDays = options.unusedDays ?? STEP_ENVIRONMENT_UNUSED_DAYS;
  const cap = options.cap ?? STEP_ENVIRONMENT_CAP;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - unusedDays * 24 * 60 * 60 * 1000);
  const rows = await db.exploreEnvironment.findMany({ where: { baseName: { not: null }, prefixPath: { not: null }, status: { in: ["ready", "failed"] } }, orderBy: { lastUsedAt: "desc" } });
  const pruned: string[] = [];
  rows.forEach((row, index) => {
    const lastUsed = row.lastUsedAt ?? row.updatedAt;
    if (lastUsed < cutoff || index >= cap) pruned.push(row.name);
  });
  if (options.dryRun) return { pruned };
  for (const name of pruned) {
    const row = rows.find((candidate) => candidate.name === name)!;
    if (row.prefixPath) await fs.rm(row.prefixPath, { recursive: true, force: true }).catch(() => undefined);
    await db.exploreEnvironment.update({ where: { name }, data: { status: "missing", prefixPath: null, builtAt: null } });
  }
  return { pruned };
}

/** The state of an environment by name (a base or a derived one), for a flow run that fixed it at start. */
export async function stepEnvironmentByName(name: string): Promise<StepEnvironmentState | null> {
  const row = await db.exploreEnvironment.findUnique({ where: { name } });
  if (!row) return null;
  const packages = stepPackagesOf(row.packages);
  const derived: DerivedEnvironment = { name, baseName: row.baseName ?? name, baseSpecHash: row.baseSpecHash ?? row.specHash, key: "", spec: row.spec, packages };
  return stateOf(derived, row);
}

/** Start the build of a derived environment by name when it is missing (or failed and asked to retry). */
export async function prepareEnvironmentByName(name: string, options: { retryFailed?: boolean } = {}): Promise<StepEnvironmentState | null> {
  const state = await stepEnvironmentByName(name);
  if (!state || !state.derived) return state;
  if (state.status === "missing" || state.status === "stale" || (state.status === "failed" && options.retryFailed)) {
    await buildEnvironment(name);
    return stepEnvironmentByName(name);
  }
  return state;
}
