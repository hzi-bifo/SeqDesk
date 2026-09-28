/**
 * Data sources (web sheet S-124): one admin setting per public archive the importers reach, kept in the site
 * settings next to the NCBI key.
 *
 *   - a download limit per import and an "ask above" size, for the workspace and per source;
 *   - per source: on or off, and who may import (members or admins only);
 *   - the Dryad API account (client id and secret), write-only and encrypted like the NCBI key;
 *   - the last test of each source, and an audit line for every change and every test.
 *
 * The limits used to be environment variables (SEQDESK_WORKBENCH_ENA_MAX_BYTES for reads,
 * SEQDESK_WORKBENCH_RECORD_MAX_BYTES for records); they stay the fallback for a source nobody has set.
 * Nothing here is ever a secret in the clear: secrets are answered as "set, by whom, when, from where".
 */
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security/secret-store";
import { EUTILS, isValidNcbiApiKey, ncbiApiKey, ncbiRequestsPerSecond, resetNcbiApiKeyCache } from "./importers/ncbi-client";
import { SOURCE_USER_AGENT } from "./importers/public-record-download";
import type { WorkbenchImportPreview } from "./importers/types";

export const GiB = 1024 ** 3;
export const DEFAULT_MAX_BYTES = 250 * GiB;
export const DEFAULT_ASK_ABOVE_BYTES = 20 * GiB;
const MAX_SETTABLE_BYTES = 100 * 1024 * GiB;
const HISTORY_LIMIT = 500;
export const TEST_TIMEOUT_MS = 20_000;

export type Who = "members" | "admins";
export type StatusWord = "ready" | "slower" | "needs-key" | "needs-account" | "unreachable" | "off";
export type TestResult = "passed" | "half" | "unreachable" | "refused";

export interface DataSourceDefinition {
  id: string;
  name: string;
  description: string;
  providers: string[];
  /** The environment variable that capped this source before the setting existed. */
  envCap: "SEQDESK_WORKBENCH_ENA_MAX_BYTES" | "SEQDESK_WORKBENCH_RECORD_MAX_BYTES";
}

export const DATA_SOURCES: DataSourceDefinition[] = [
  { id: "ena", name: "ENA", description: "Reads by run, sample or study accession", providers: ["ena-fastq-accession"], envCap: "SEQDESK_WORKBENCH_ENA_MAX_BYTES" },
  { id: "ncbi", name: "NCBI", description: "SRA runs, assemblies, genomes by taxon", providers: ["ncbi-sra-runs", "ncbi-assembly", "ncbi-genomes-taxon"], envCap: "SEQDESK_WORKBENCH_ENA_MAX_BYTES" },
  { id: "geo", name: "GEO", description: "Series matrix and processed files", providers: ["geo-series"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "records", name: "Zenodo and figshare", description: "Record files by DOI, checksum-verified", providers: ["zenodo-record", "figshare-article", "link-download"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "dryad", name: "Dryad", description: "Dataset files by DOI", providers: ["dryad-dataset"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "mgnify", name: "MGnify", description: "Analysis results of metagenome studies", providers: ["mgnify-downloads"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "reference", name: "Bioconductor and MSigDB", description: "Annotation packages and gene sets, installed lab-wide", providers: ["reference-resource"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "structures", name: "PDB, AlphaFold, UniProt", description: "Structures and proteins by id", providers: ["pdb-entry", "alphafold-model", "uniprot-entry"], envCap: "SEQDESK_WORKBENCH_RECORD_MAX_BYTES" },
  { id: "cami", name: "CAMI benchmarks", description: "Simulated benchmark reads and their gold standards", providers: ["cami-benchmark"], envCap: "SEQDESK_WORKBENCH_ENA_MAX_BYTES" },
];

export const sourceById = (id: string) => DATA_SOURCES.find((s) => s.id === id) ?? null;
export const sourceForProvider = (providerId: string) => DATA_SOURCES.find((s) => s.providers.includes(providerId)) ?? null;

export interface SourceSetting { enabled?: boolean; who?: Who; maxBytes?: number | null; askAboveBytes?: number | null }
export interface SecretMark { by: string; at: string }
export interface LastTest { result: TestResult; sentence: string; ms: number; at: string; by: string; lastOkAt?: string }
export interface HistoryEntry { at: string; by: string; what: string; kind: "setting" | "secret" | "test" }
export interface DataSourcesSettings {
  maxBytes?: number;
  askAboveBytes?: number;
  sources?: Record<string, SourceSetting>;
  secrets?: Record<string, SecretMark>;
  tests?: Record<string, LastTest>;
  history?: HistoryEntry[];
}

// ---------- storage ----------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function readExtra(): Promise<Record<string, unknown>> {
  const row = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
  if (!row?.extraSettings) return {};
  try { const parsed = JSON.parse(row.extraSettings); return isRecord(parsed) ? parsed : {}; } catch { return {}; }
}

async function writeExtra(extra: Record<string, unknown>) {
  const extraSettings = JSON.stringify(extra);
  await db.siteSettings.upsert({ where: { id: "singleton" }, update: { extraSettings }, create: { id: "singleton", extraSettings } });
}

export async function readDataSourcesSettings(): Promise<DataSourcesSettings> {
  try {
    const extra = await readExtra();
    return isRecord(extra.dataSources) ? extra.dataSources as DataSourcesSettings : {};
  } catch {
    return {};
  }
}

/** Read, change and write the data-source settings (and, when needed, the rest of the extra settings) in one step. */
async function change(mutate: (settings: DataSourcesSettings, extra: Record<string, unknown>) => void) {
  const extra = await readExtra();
  const settings: DataSourcesSettings = isRecord(extra.dataSources) ? { ...(extra.dataSources as DataSourcesSettings) } : {};
  mutate(settings, extra);
  if (settings.history && settings.history.length > HISTORY_LIMIT) settings.history = settings.history.slice(-HISTORY_LIMIT);
  await writeExtra({ ...extra, dataSources: settings });
  return settings;
}

const audit = (settings: DataSourcesSettings, entry: HistoryEntry) => { settings.history = [...(settings.history ?? []), entry]; };

// ---------- effective values ----------

function envBytes(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface EffectiveSource {
  source: DataSourceDefinition;
  enabled: boolean;
  who: Who;
  maxBytes: number;
  /** Where the limit comes from: this source's setting, the environment variable, or the workspace default. */
  maxFrom: "source" | "environment" | "workspace";
  askAboveBytes: number;
  askFrom: "source" | "workspace";
}

export function workspaceDefaults(settings: DataSourcesSettings) {
  return {
    maxBytes: settings.maxBytes ?? DEFAULT_MAX_BYTES,
    maxFrom: settings.maxBytes ? "settings" as const : "default" as const,
    askAboveBytes: settings.askAboveBytes ?? DEFAULT_ASK_ABOVE_BYTES,
    askFrom: settings.askAboveBytes ? "settings" as const : "default" as const,
  };
}

export function effectiveSource(settings: DataSourcesSettings, source: DataSourceDefinition): EffectiveSource {
  const own = settings.sources?.[source.id] ?? {};
  const defaults = workspaceDefaults(settings);
  const env = envBytes(source.envCap);
  // A source's own limit never exceeds the workspace's; the old environment cap applies until an admin sets one.
  const maxBytes = own.maxBytes ? Math.min(own.maxBytes, defaults.maxBytes) : env !== null && !settings.maxBytes ? env : defaults.maxBytes;
  return {
    source,
    enabled: own.enabled !== false,
    who: own.who === "admins" ? "admins" : "members",
    maxBytes,
    maxFrom: own.maxBytes ? "source" : env !== null && !settings.maxBytes ? "environment" : "workspace",
    askAboveBytes: own.askAboveBytes ?? defaults.askAboveBytes,
    askFrom: own.askAboveBytes ? "source" : "workspace",
  };
}

// ---------- secrets ----------

async function storedDryad(): Promise<{ id: string; secret: string } | null> {
  try {
    const extra = await readExtra();
    const dryad = isRecord(extra.dryad) ? extra.dryad : {};
    const id = typeof dryad.clientId === "string" ? decryptSecret(dryad.clientId) : null;
    const secret = typeof dryad.clientSecret === "string" ? decryptSecret(dryad.clientSecret) : null;
    return id && secret ? { id, secret } : null;
  } catch {
    return null;
  }
}

/** The Dryad API account the importer uses, and where it came from; the settings win over the environment. */
export async function dryadAccount(): Promise<{ value: { id: string; secret: string } | null; source: "settings" | "environment" | null }> {
  const stored = await storedDryad();
  if (stored) return { value: stored, source: "settings" };
  const id = process.env.SEQDESK_DRYAD_CLIENT_ID?.trim();
  const secret = process.env.SEQDESK_DRYAD_CLIENT_SECRET?.trim();
  return id && secret ? { value: { id, secret }, source: "environment" } : { value: null, source: null };
}

const DRYAD_PART = /^[\x21-\x7e]{8,200}$/;

export class DataSourcesError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Set or remove a secret. Values are never returned or logged; the audit says only what happened. */
export async function setSecret(secret: "ncbi-key" | "dryad-account", value: { apiKey?: string; clientId?: string; clientSecret?: string }, by: string) {
  const at = new Date().toISOString();
  if (secret === "ncbi-key") {
    const apiKey = (value.apiKey ?? "").trim();
    if (apiKey && !isValidNcbiApiKey(apiKey)) throw new DataSourcesError(400, "That does not look like an NCBI API key (20 to 64 letters and digits, from your NCBI account settings).");
    await change((settings, extra) => {
      const ncbi = isRecord(extra.ncbi) ? { ...extra.ncbi } : {};
      if (apiKey) ncbi.apiKey = encryptSecret(apiKey); else delete ncbi.apiKey;
      extra.ncbi = ncbi;
      settings.secrets = { ...(settings.secrets ?? {}), [secret]: { by, at } };
      audit(settings, { at, by, kind: "secret", what: apiKey ? "NCBI API key set" : "NCBI API key removed" });
    });
    resetNcbiApiKeyCache();
    return;
  }
  const clientId = (value.clientId ?? "").trim();
  const clientSecret = (value.clientSecret ?? "").trim();
  const removing = !clientId && !clientSecret;
  if (!removing && (!DRYAD_PART.test(clientId) || !DRYAD_PART.test(clientSecret))) {
    throw new DataSourcesError(400, "Give both the Dryad client id and the client secret, as datadryad.org shows them for your API account.");
  }
  await change((settings, extra) => {
    const dryad = isRecord(extra.dryad) ? { ...extra.dryad } : {};
    if (removing) { delete dryad.clientId; delete dryad.clientSecret; }
    else { dryad.clientId = encryptSecret(clientId); dryad.clientSecret = encryptSecret(clientSecret); }
    extra.dryad = dryad;
    settings.secrets = { ...(settings.secrets ?? {}), [secret]: { by, at } };
    audit(settings, { at, by, kind: "secret", what: removing ? "Dryad API account removed" : "Dryad API account set" });
  });
}

// ---------- changing settings ----------

export interface SettingsChange {
  maxBytes?: number | null;
  askAboveBytes?: number | null;
  sources?: Record<string, { enabled?: boolean; who?: Who; maxBytes?: number | null; askAboveBytes?: number | null }>;
}

const size = (bytes: number) => bytes >= GiB ? `${+(bytes / GiB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
const bytesOrNull = (value: unknown, what: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_SETTABLE_BYTES) {
    throw new DataSourcesError(400, `${what} must be a size between 1 byte and 100 TB.`);
  }
  return value;
};

export function parseSettingsChange(body: unknown): SettingsChange {
  if (!isRecord(body)) throw new DataSourcesError(400, "Send the settings to change.");
  const out: SettingsChange = {};
  if ("maxBytes" in body) out.maxBytes = bytesOrNull(body.maxBytes, "The download limit");
  if ("askAboveBytes" in body) out.askAboveBytes = bytesOrNull(body.askAboveBytes, "The ask-above size");
  if ("sources" in body) {
    if (!isRecord(body.sources)) throw new DataSourcesError(400, "sources must name each source by its id.");
    out.sources = {};
    for (const [id, raw] of Object.entries(body.sources)) {
      if (!sourceById(id)) throw new DataSourcesError(400, `There is no data source called ${id}.`);
      if (!isRecord(raw)) throw new DataSourcesError(400, `Say what changes for ${id}.`);
      const next: NonNullable<SettingsChange["sources"]>[string] = {};
      if ("enabled" in raw) { if (typeof raw.enabled !== "boolean") throw new DataSourcesError(400, "On or off is true or false."); next.enabled = raw.enabled; }
      if ("who" in raw) { if (raw.who !== "members" && raw.who !== "admins") throw new DataSourcesError(400, "Who can import is members or admins."); next.who = raw.who; }
      if ("maxBytes" in raw) next.maxBytes = bytesOrNull(raw.maxBytes, "The download limit");
      if ("askAboveBytes" in raw) next.askAboveBytes = bytesOrNull(raw.askAboveBytes, "The ask-above size");
      out.sources[id] = next;
    }
  }
  return out;
}

export async function applySettingsChange(input: SettingsChange, by: string) {
  const at = new Date().toISOString();
  return change((settings) => {
    const defaults = workspaceDefaults(settings);
    if (input.maxBytes !== undefined && (input.maxBytes ?? DEFAULT_MAX_BYTES) !== defaults.maxBytes) {
      audit(settings, { at, by, kind: "setting", what: `Download limit per import ${size(input.maxBytes ?? DEFAULT_MAX_BYTES)} (was ${size(defaults.maxBytes)})` });
      settings.maxBytes = input.maxBytes ?? undefined;
    }
    if (input.askAboveBytes !== undefined && (input.askAboveBytes ?? DEFAULT_ASK_ABOVE_BYTES) !== defaults.askAboveBytes) {
      audit(settings, { at, by, kind: "setting", what: `Asks before downloads above ${size(input.askAboveBytes ?? DEFAULT_ASK_ABOVE_BYTES)} (was ${size(defaults.askAboveBytes)})` });
      settings.askAboveBytes = input.askAboveBytes ?? undefined;
    }
    for (const [id, next] of Object.entries(input.sources ?? {})) {
      const source = sourceById(id)!;
      const before = effectiveSource(settings, source);
      const own = { ...(settings.sources?.[id] ?? {}) };
      if (next.enabled !== undefined && next.enabled !== before.enabled) {
        own.enabled = next.enabled;
        audit(settings, { at, by, kind: "setting", what: `${source.name} turned ${next.enabled ? "on" : "off"}` });
      }
      if (next.who !== undefined && next.who !== before.who) {
        own.who = next.who;
        audit(settings, { at, by, kind: "setting", what: `${source.name}: ${next.who === "admins" ? "admins only" : "members"} can import` });
      }
      if (next.maxBytes !== undefined && next.maxBytes !== (own.maxBytes ?? null)) {
        own.maxBytes = next.maxBytes;
        settings.sources = { ...(settings.sources ?? {}), [id]: own };
        audit(settings, { at, by, kind: "setting", what: `${source.name} download limit ${next.maxBytes ? size(next.maxBytes) : "the workspace default"} (was ${size(before.maxBytes)})` });
      }
      if (next.askAboveBytes !== undefined && next.askAboveBytes !== (own.askAboveBytes ?? null)) {
        own.askAboveBytes = next.askAboveBytes;
        audit(settings, { at, by, kind: "setting", what: `${source.name} asks above ${next.askAboveBytes ? size(next.askAboveBytes) : "the workspace default"} (was ${size(before.askAboveBytes)})` });
      }
      settings.sources = { ...(settings.sources ?? {}), [id]: own };
    }
  });
}

// ---------- status ----------

export interface PreflightLike { ok: boolean; previewOnly?: boolean; message?: string }
export interface StatusDeps {
  /** Whether the provider's input module is on (SeqDesk's module settings). */
  moduleEnabled(providerId: string): Promise<boolean>;
  preflight(providerId: string): Promise<PreflightLike | null>;
}

export interface SecretState { id: "ncbi-key" | "dryad-account"; label: string; set: boolean; source: "settings" | "environment" | null; changedBy?: string; changedAt?: string }

export async function secretStates(settings: DataSourcesSettings): Promise<Record<string, SecretState>> {
  resetNcbiApiKeyCache();
  const [ncbi, dryad] = await Promise.all([ncbiApiKey(), dryadAccount()]);
  const mark = (id: string) => settings.secrets?.[id];
  return {
    "ncbi-key": { id: "ncbi-key", label: "API key", set: Boolean(ncbi.value), source: ncbi.source, changedBy: mark("ncbi-key")?.by, changedAt: mark("ncbi-key")?.at },
    "dryad-account": { id: "dryad-account", label: "Account", set: Boolean(dryad.value), source: dryad.source, changedBy: mark("dryad-account")?.by, changedAt: mark("dryad-account")?.at },
  };
}

export async function dataSourcesStatus(deps: StatusDeps, canManage: boolean) {
  const settings = await readDataSourcesSettings();
  const secrets = await secretStates(settings);
  const defaults = workspaceDefaults(settings);
  const sources = await Promise.all(DATA_SOURCES.map(async (source) => {
    const effective = effectiveSource(settings, source);
    const modules = await Promise.all(source.providers.map((p) => deps.moduleEnabled(p)));
    const available = source.providers.filter((_, i) => modules[i]);
    const preflights = (await Promise.all(available.map((p) => deps.preflight(p).catch(() => null)))).filter(Boolean) as PreflightLike[];
    const test = settings.tests?.[source.id];
    const offEntry = [...(settings.history ?? [])].reverse().find((h) => h.what === `${source.name} turned off`);
    let word: StatusWord = "ready";
    let needs = "Nothing";
    if (source.id === "ena") needs = "Nothing to import. Webin only for submitting";
    if (source.id === "ncbi") needs = `${ncbiRequestsPerSecond(false)} requests a second without a key, ${ncbiRequestsPerSecond(true)} with`;
    if (source.id === "dryad") needs = secrets["dryad-account"].set ? "A Dryad API account" : "Previews work. Downloads need a Dryad API account";
    if (!effective.enabled || !available.length) word = "off";
    else if (test && (test.result === "unreachable" || test.result === "refused")) word = "unreachable";
    else if (source.id === "dryad" && !secrets["dryad-account"].set) word = "needs-account";
    else if (preflights.some((p) => !p.ok && !p.previewOnly)) { word = "needs-key"; needs = preflights.find((p) => !p.ok)?.message ?? needs; }
    else if (source.id === "ncbi" && !secrets["ncbi-key"].set) word = "slower";
    return {
      id: source.id, name: source.name, description: source.description, providers: source.providers,
      status: word, needs,
      offBy: word === "off" ? (!available.length ? { by: "SeqDesk's module settings", at: null } : offEntry ? { by: offEntry.by, at: offEntry.at } : null) : null,
      secrets: source.id === "ncbi" ? [secrets["ncbi-key"]] : source.id === "dryad" ? [secrets["dryad-account"]] : [],
      enabled: effective.enabled, who: effective.who,
      maxBytes: effective.maxBytes, maxFrom: effective.maxFrom,
      askAboveBytes: effective.askAboveBytes, askFrom: effective.askFrom,
      lastTest: test ?? null,
    };
  }));
  const last = settings.history?.[settings.history.length - 1] ?? null;
  return { canManage, defaults, sources, lastChange: last, checkedAt: new Date().toISOString() };
}

// ---------- enforcement ----------

/** What a selection downloads, as far as the preview knows (files and assets; genomes by their length). */
export function previewBytes(preview: Partial<Pick<WorkbenchImportPreview, "files" | "assets" | "genomes">>): number {
  const files = (preview.files ?? []).reduce((n, f) => n + (f.bytes ?? 0), 0);
  const assets = (preview.assets ?? []).reduce((n, a) => n + (a.bytes ?? 0), 0);
  const genomes = (preview.genomes ?? []).reduce((n, g) => n + (g.totalSequenceLength ?? 0), 0);
  return files + assets + (files + assets ? 0 : genomes);
}

export interface ImportLimits { source: string | null; maxBytes: number; askAboveBytes: number; totalBytes: number; needsConfirmation: boolean }

/** Which providers this person may see in Find data: a source that is off, or admins-only for a member, is hidden. */
export async function importAllowedFilter(isAdmin: boolean): Promise<(providerId: string) => boolean> {
  const settings = await readDataSourcesSettings();
  return (providerId) => {
    const source = sourceForProvider(providerId);
    if (!source) return true;
    const effective = effectiveSource(settings, source);
    return effective.enabled && (effective.who === "members" || isAdmin);
  };
}

/** Who may import from a source, before anything is fetched. */
export async function assertMayImport(providerId: string, isAdmin: boolean): Promise<void> {
  const source = sourceForProvider(providerId);
  if (!source) return;
  const effective = effectiveSource(await readDataSourcesSettings(), source);
  if (!effective.enabled) throw new DataSourcesError(403, `An admin turned ${source.name} off for imports.`);
  if (effective.who === "admins" && !isAdmin) throw new DataSourcesError(403, `Only admins can import from ${source.name} here. Ask an admin.`);
}

/**
 * The limits for a previewed selection. Over the limit is refused; above the ask size an import starts only when
 * the person confirmed at least that many bytes (the web app's tick-to-confirm step), when `requireConfirmation`.
 */
export async function importLimits(providerId: string, preview: Partial<Pick<WorkbenchImportPreview, "files" | "assets" | "genomes">>,
  options: { phase: "preview" | "start"; confirmedBytes?: number; requireConfirmation?: boolean }): Promise<ImportLimits> {
  const settings = await readDataSourcesSettings();
  const source = sourceForProvider(providerId);
  const defaults = workspaceDefaults(settings);
  const effective = source ? effectiveSource(settings, source) : null;
  const maxBytes = effective?.maxBytes ?? defaults.maxBytes;
  const askAboveBytes = effective?.askAboveBytes ?? defaults.askAboveBytes;
  const totalBytes = previewBytes(preview);
  const name = source?.name ?? "this source";
  if (totalBytes > maxBytes) {
    throw new DataSourcesError(413, `This selection is ${size(totalBytes)}; imports from ${name} are limited to ${size(maxBytes)}. Pick fewer files or ask an admin to raise the limit.`);
  }
  const needsConfirmation = totalBytes > askAboveBytes;
  if (options.phase === "start" && needsConfirmation && options.requireConfirmation && !((options.confirmedBytes ?? 0) >= totalBytes)) {
    throw new DataSourcesError(409, `This selection is ${size(totalBytes)}, above the ${size(askAboveBytes)} that needs a confirmation. Tick the files to go ahead.`);
  }
  return { source: source?.id ?? null, maxBytes, askAboveBytes, totalBytes, needsConfirmation };
}

/** Find data's hint: how long an NCBI preview's lookups take at today's rate, and with a key. Only when it saves > 30 s. */
export async function previewHint(providerId: string, preview: Partial<Pick<WorkbenchImportPreview, "files" | "genomes">> & Pick<WorkbenchImportPreview, "summary">, previewOnly = false) {
  if (previewOnly) return { kind: "dryad-preview-only" as const, sentence: "Dryad: preview only. Downloads need a Dryad account an admin adds." };
  if (sourceForProvider(providerId)?.id !== "ncbi") return null;
  const key = await ncbiApiKey();
  if (key.value) return null;
  // What the search reads is everything it found (a BioProject's runs), not the few this preview selects.
  const runs = new Set((preview.files ?? []).map((f) => f.runAccession)).size;
  const count = Math.max(preview.summary.totalFound || 0, runs, preview.genomes?.length ?? 0);
  const seconds = Math.ceil(count / ncbiRequestsPerSecond(false));
  const withKey = Math.ceil(count / ncbiRequestsPerSecond(true));
  if (seconds - withKey <= 30) return null;
  return { kind: "ncbi-key" as const, count, seconds, secondsWithKey: withKey,
    sentence: `This search reads ${count} runs and will take about ${seconds} s. With an NCBI key it takes about ${withKey} s.` };
}

// ---------- tests ----------

type Fetch = typeof fetch;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} at ${d.toISOString().slice(11, 16)}`;
};

class Unreachable extends Error {}

async function get(fetcher: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetcher(url, { redirect: "follow", ...init, headers: { "user-agent": SOURCE_USER_AGENT, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  } catch {
    throw new Unreachable();
  }
}

async function okOrThrow(response: Response, name: string) {
  if (!response.ok) throw new Error(`${name} answered HTTP ${response.status}.`);
  return response;
}

/** One small real query per source; answers one sentence and never changes a setting. */
export async function runSourceTest(sourceId: string, fetcher: Fetch = fetch): Promise<{ result: TestResult; sentence: string; ms: number }> {
  const source = sourceById(sourceId);
  if (!source) throw new DataSourcesError(404, `There is no data source called ${sourceId}.`);
  const started = Date.now();
  const took = () => Date.now() - started;
  try {
    switch (source.id) {
      case "ena": {
        const url = `https://www.ebi.ac.uk/ena/portal/api/filereport?${new URLSearchParams({ accession: "SRR390728", result: "read_run", fields: "run_accession,fastq_ftp", format: "json" })}`;
        const rows = await (await okOrThrow(await get(fetcher, url), "ENA")).json() as Array<{ fastq_ftp?: string }>;
        const files = String(rows?.[0]?.fastq_ftp ?? "").split(";").filter(Boolean).length;
        return { result: "passed", ms: took(), sentence: `ENA answered in ${seconds(took())} and found run SRR390728 with ${files} FASTQ ${files === 1 ? "file" : "files"}.` };
      }
      case "ncbi": {
        resetNcbiApiKeyCache();
        const key = (await ncbiApiKey()).value;
        const params = new URLSearchParams({ db: "sra", retmode: "json", tool: "seqdesk", ...(key ? { api_key: key } : {}) });
        const response = await get(fetcher, `${EUTILS}/einfo.fcgi?${params}`);
        if (response.status === 400 && key) {
          const text = (await response.text().catch(() => "")).slice(0, 200);
          return { result: "refused", ms: took(), sentence: `NCBI refused the key (HTTP 400${/api_key/i.test(text) ? ": invalid api_key" : ""}). Nothing was changed.` };
        }
        await okOrThrow(response, "NCBI");
        return { result: "passed", ms: took(), sentence: key
          ? `NCBI answered in ${seconds(took())}. With the key SeqDesk sends ${ncbiRequestsPerSecond(true)} requests a second.`
          : `NCBI answered in ${seconds(took())}. Without a key SeqDesk sends ${ncbiRequestsPerSecond(false)} requests a second.` };
      }
      case "geo": {
        const response = await okOrThrow(await get(fetcher, "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE52778&targ=self&form=text&view=brief", { headers: { accept: "text/plain" } }), "GEO");
        const found = /GSE52778/.test(await response.text());
        return { result: "passed", ms: took(), sentence: `GEO answered in ${seconds(took())}${found ? " and found series GSE52778" : ""}.` };
      }
      case "records": {
        await okOrThrow(await get(fetcher, "https://zenodo.org/api/records?size=1"), "Zenodo");
        await okOrThrow(await get(fetcher, "https://api.figshare.com/v2/articles?page_size=1"), "figshare");
        return { result: "passed", ms: took(), sentence: `Zenodo and figshare answered in ${seconds(took())}.` };
      }
      case "dryad": {
        await okOrThrow(await get(fetcher, "https://datadryad.org/api/v2/datasets?per_page=1"), "Dryad");
        const account = (await dryadAccount()).value;
        if (!account) return { result: "half", ms: took(), sentence: "Dryad previews work. Downloads were refused: no Dryad API account is set." };
        const token = await get(fetcher, "https://datadryad.org/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: account.id, client_secret: account.secret }) });
        if (!token.ok) return { result: "refused", ms: took(), sentence: `Dryad refused the API account (HTTP ${token.status}). Nothing was changed.` };
        return { result: "passed", ms: took(), sentence: `Dryad answered in ${seconds(took())} and accepted the API account.` };
      }
      case "mgnify": {
        await okOrThrow(await get(fetcher, "https://www.ebi.ac.uk/metagenomics/api/v1/studies?page_size=1"), "MGnify");
        return { result: "passed", ms: took(), sentence: `MGnify answered in ${seconds(took())}.` };
      }
      case "reference": {
        await okOrThrow(await get(fetcher, "https://bioconductor.org/config.yaml", { headers: { accept: "text/plain" } }), "Bioconductor");
        return { result: "passed", ms: took(), sentence: `Bioconductor answered in ${seconds(took())}.` };
      }
      case "structures": {
        await okOrThrow(await get(fetcher, "https://data.rcsb.org/rest/v1/core/entry/1LM8"), "PDB");
        await okOrThrow(await get(fetcher, "https://rest.uniprot.org/uniprotkb/P69905?fields=accession&format=json"), "UniProt");
        return { result: "passed", ms: took(), sentence: `PDB and UniProt answered in ${seconds(took())} and found entry 1LM8 and protein P69905.` };
      }
      case "cami": {
        await okOrThrow(await get(fetcher, "https://cami-challenge.org/", { headers: { accept: "text/html" } }), "CAMI");
        return { result: "passed", ms: took(), sentence: `The CAMI site answered in ${seconds(took())}. The catalogue ships with SeqDesk.` };
      }
    }
  } catch (error) {
    if (error instanceof Unreachable) return { result: "unreachable", ms: took(), sentence: `${source.name} did not answer in ${TEST_TIMEOUT_MS / 1000} s.` };
    return { result: "unreachable", ms: took(), sentence: error instanceof Error ? error.message : `${source.name} could not be reached.` };
  }
  return { result: "unreachable", ms: took(), sentence: `${source.name} has no test.` };
}

/** Test one source or all of them, keep each result and add one audit line. */
export async function testSources(ids: string[], by: string, fetcher: Fetch = fetch) {
  const results = await Promise.all(ids.map(async (id) => ({ id, ...(await runSourceTest(id, fetcher)) })));
  const at = new Date().toISOString();
  await change((settings) => {
    const tests = { ...(settings.tests ?? {}) };
    for (const r of results) {
      const before = tests[r.id];
      const ok = r.result === "passed" || r.result === "half";
      const lastOkAt = ok ? at : before?.lastOkAt;
      const sentence = !ok && lastOkAt && r.result === "unreachable" ? `${r.sentence} It last worked on ${when(lastOkAt)}.` : r.sentence;
      r.sentence = sentence;
      tests[r.id] = { result: r.result, sentence, ms: r.ms, at, by, ...(lastOkAt ? { lastOkAt } : {}) };
    }
    settings.tests = tests;
    const name = (id: string) => sourceById(id)?.name ?? id;
    const passed = results.filter((r) => r.result === "passed").length;
    const other = results.filter((r) => r.result !== "passed").map((r) => `${name(r.id)} ${r.result === "half" ? "half" : r.result === "refused" ? "refused" : "not reachable"}`);
    audit(settings, { at, by, kind: "test", what: results.length === 1
      ? `Tested ${name(results[0].id)} · ${results[0].result === "passed" ? "passed" : other[0]}`
      : `Tested all sources · ${passed} passed${other.length ? `, ${other.join(", ")}` : ""}` });
  });
  return results.map((r) => ({ ...r, at }));
}

export async function dataSourcesHistory(limit = 200) {
  const settings = await readDataSourcesSettings();
  return [...(settings.history ?? [])].reverse().slice(0, limit);
}
