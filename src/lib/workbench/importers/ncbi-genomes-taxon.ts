import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { z } from "zod";
import {
  buildStableRequestHash,
  computeFileSha256,
  getPathSizeBytes,
} from "@/lib/workbench/storage";
import { recordMaxDownloadBytes, SOURCE_USER_AGENT } from "./public-record-download";
import { extractWorkbenchZip } from "@/lib/workbench/safe-zip";
import {
  WORKBENCH_REQUIRED_TEST_LAYERS,
  type WorkbenchIntegrationTestSpec,
} from "@/lib/workbench/testing";
import type {
  WorkbenchGenomePreviewItem,
  WorkbenchImporterProvider,
  WorkbenchImporterPreflight,
  WorkbenchImportPreview,
  WorkbenchImportResult,
  WorkbenchImportStartContext,
} from "./types";

const DEFAULT_CAP = 100;
const HARD_MAX = 500;
const PREVIEW_TIMEOUT_MS = 90_000;

const inputSchema = z.object({
  taxon: z.string().trim().min(2, "Taxon is required").max(180),
  cap: z.coerce.number().int().min(1).max(HARD_MAX).default(DEFAULT_CAP),
  assemblySource: z.enum(["all", "refseq", "genbank"]).default("refseq"),
  mag: z.enum(["exclude", "all", "only"]).default("exclude"),
  excludeAtypical: z.boolean().default(true),
  referenceOnly: z.boolean().default(false),
  assemblyLevels: z
    .array(z.enum(["complete", "chromosome", "scaffold", "contig"]))
    .default(["complete", "chromosome"]),
});

type NcbiGenomesTaxonInput = z.infer<typeof inputSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  // The Datasets REST API sends large counts (sequence length) as strings.
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function normalizeSourceDatabase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes("REFSEQ")) return "RefSeq";
  if (value.includes("GENBANK")) return "GenBank";
  return value;
}

export function parseNcbiGenomeSummaryLines(output: string, cap = DEFAULT_CAP): WorkbenchGenomePreviewItem[] {
  const genomes: WorkbenchGenomePreviewItem[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("NCBI returned malformed genome metadata");
    }
    const root = isRecord(parsed) && isRecord(parsed.report) ? parsed.report : parsed;
    if (!isRecord(root)) throw new Error("NCBI returned invalid genome metadata");
    const organism = nestedRecord(root, "organism");
    const assemblyInfo = nestedRecord(root, "assembly_info");
    const assemblyStats = nestedRecord(root, "assembly_stats");
    const accession =
      optionalString(root.accession) ||
      optionalString(root.assembly_accession) ||
      optionalString(root.current_accession);
    if (!accession || !/^GC[AF]_\d+\.\d+$/.test(accession)) throw new Error("NCBI returned an unversioned or invalid assembly accession");
    genomes.push({
      accession,
      organismName:
        optionalString(organism.organism_name) ||
        optionalString(organism.name) ||
        optionalString(root.organism_name),
      taxId: optionalNumber(organism.tax_id) || optionalNumber(root.tax_id),
      assemblyName:
        optionalString(assemblyInfo.assembly_name) || optionalString(root.assembly_name),
      assemblyLevel:
        optionalString(assemblyInfo.assembly_level) || optionalString(root.assembly_level),
      sourceDatabase: normalizeSourceDatabase(
        optionalString(root.source_database) || optionalString(root.sourceDatabase)
      ),
      representativeCategory:
        optionalString(assemblyInfo.refseq_category) ||
        optionalString(root.refseq_category) ||
        optionalString(root.representative_category),
      totalSequenceLength:
        optionalNumber(assemblyStats.total_sequence_length) ||
        optionalNumber(assemblyStats.totalSequenceLength) ||
        optionalNumber(root.total_sequence_length),
    });
    if (genomes.length > cap) break;
  }
  return genomes;
}

const DATASETS_API = "https://api.ncbi.nlm.nih.gov/datasets/v2";
const LEVELS: Record<NcbiGenomesTaxonInput["assemblyLevels"][number], string> = { complete: "complete_genome", chromosome: "chromosome", scaffold: "scaffold", contig: "contig" };
const MAG: Record<NcbiGenomesTaxonInput["mag"], string> = { exclude: "METAGENOME_DERIVED_EXCLUDE", all: "METAGENOME_DERIVED_UNSET", only: "METAGENOME_DERIVED_ONLY" };

/** NCBI's optional per-lab API key raises the rate limit (3 → 10 requests a second); it is sent as a header only. */
function ncbiHeaders(accept: string): Record<string, string> {
  const key = process.env.NCBI_API_KEY?.trim();
  return { accept, "user-agent": SOURCE_USER_AGENT, ...(key && /^[A-Za-z0-9]{20,64}$/.test(key) ? { "api-key": key } : {}) };
}

async function preflight(): Promise<WorkbenchImporterPreflight> {
  return { ok: true, message: "Uses the public NCBI Datasets API; no command-line tool is needed." };
}

/** The dataset_report query the old `datasets summary genome taxon` call made, as REST parameters. */
export function buildDatasetReportUrl(input: NcbiGenomesTaxonInput, limit: number): string {
  const url = new URL(`${DATASETS_API}/genome/taxon/${encodeURIComponent(input.taxon)}/dataset_report`);
  url.searchParams.set("page_size", String(limit));
  url.searchParams.set("filters.assembly_version", "current");
  url.searchParams.set("filters.is_metagenome_derived", MAG[input.mag]);
  if (input.assemblySource !== "all") url.searchParams.set("filters.assembly_source", input.assemblySource);
  if (input.excludeAtypical) url.searchParams.set("filters.exclude_atypical", "true");
  if (input.referenceOnly) url.searchParams.set("filters.reference_only", "true");
  for (const level of input.assemblyLevels) url.searchParams.append("filters.assembly_level", LEVELS[level]);
  return url.toString();
}

async function preview(input: NcbiGenomesTaxonInput): Promise<WorkbenchImportPreview> {
  const cap = Math.min(input.cap, HARD_MAX);
  let response: Response;
  try {
    response = await fetch(buildDatasetReportUrl(input, cap + 1), { redirect: "error", headers: ncbiHeaders("application/json"), signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS) });
  } catch {
    throw new Error("NCBI Datasets could not be reached. Try again later.");
  }
  if (response.status === 404 || response.status === 400) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`NCBI does not know the taxon “${input.taxon}”. Use a scientific name or an NCBI taxon ID.`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.status === 429 ? "NCBI is limiting requests right now. Try again in a minute." : `NCBI Datasets did not answer as expected (HTTP ${response.status}).`);
  }
  const body = await response.json().catch(() => null) as { reports?: unknown[]; total_count?: number } | null;
  if (!body || (body.reports !== undefined && !Array.isArray(body.reports))) throw new Error("NCBI returned invalid genome metadata");
  const genomes = parseNcbiGenomeSummaryLines((body.reports ?? []).map((report) => JSON.stringify(report)).join("\n"), cap + 1);
  const total = typeof body.total_count === "number" ? body.total_count : genomes.length;
  const capped = genomes.length > cap;
  const selected = genomes.slice(0, cap);
  const bytes = selected.reduce((sum, genome) => sum + (genome.totalSequenceLength ?? 0), 0);
  const warnings: string[] = [];
  if (capped) warnings.push(`Preview is capped at ${cap} of ${total} genomes. Narrow filters or reduce the cap before importing larger taxonomic groups.`);
  if (!selected.length) warnings.push("No genome matches this taxon and these filters.");
  return {
    providerId: ncbiGenomesTaxonImporter.id,
    summary: {
      label: `NCBI genomes for ${input.taxon}`,
      requestedTaxon: input.taxon,
      totalFound: total,
      selectedCount: selected.length,
      capped,
      cap,
      hardMax: HARD_MAX,
    },
    genomes: selected,
    sampleMetadata: { licence: "NCBI: public domain in the US; submitters may claim rights — see NCBI's policies", licenceUrl: "https://www.ncbi.nlm.nih.gov/home/about/policies/", approximateFastaBytes: String(Math.round(bytes * 1.02)) },
    warnings: warnings.length ? warnings : undefined,
  };
}

/** md5sum.txt of an NCBI Datasets package: "<md5>  <path>" per file. */
export function parseMd5List(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{32})\s+\*?(.+)$/.exec(line.trim());
    if (match) out.set(match[2].trim(), match[1]);
  }
  return out;
}

async function md5File(filePath: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function getCacheKey(input: NcbiGenomesTaxonInput, previewResult: WorkbenchImportPreview): string {
  return buildStableRequestHash(ncbiGenomesTaxonImporter.id, {
    ...input,
    accessions: previewResult.genomes.map((genome) => genome.accession),
    include: "genome",
  });
}

async function start(
  context: WorkbenchImportStartContext<NcbiGenomesTaxonInput>
): Promise<WorkbenchImportResult> {
  const accessions = context.preview.genomes.map((genome) => genome.accession);
  if (accessions.length === 0) {
    throw new Error("NCBI preview did not return any genome accessions to import.");
  }
  if (accessions.some((accession) => !/^GC[AF]_\d+\.\d+$/.test(accession)) || new Set(accessions).size !== accessions.length) {
    throw new Error("Import requires distinct, explicitly versioned assembly accessions");
  }

  const zipPath = path.join(context.storage.jobDir, "ncbi_dataset.zip");
  const limit = recordMaxDownloadBytes();
  const url = `${DATASETS_API}/genome/accession/${accessions.map(encodeURIComponent).join(",")}/download?include_annotation_type=GENOME_FASTA&hydrated=FULLY_HYDRATED`;

  await context.update({ status: "running", phase: "downloading", progress: 10, targetPath: zipPath });
  await context.log(`Downloading ${accessions.length} genome package(s) from the NCBI Datasets API.`);
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", headers: ncbiHeaders("application/zip"), signal: AbortSignal.any([AbortSignal.timeout(6 * 60 * 60 * 1000), ...(context.signal ? [context.signal] : [])]) });
  } catch (error) {
    if (context.signal?.aborted) throw error;
    throw new Error("NCBI Datasets could not be reached. Try again later.");
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.status === 429 ? "NCBI is limiting requests right now. Try again in a minute." : `NCBI Datasets did not answer as expected (HTTP ${response.status}).`);
  }
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) return callback(new Error("The NCBI genome package exceeds this server's download limit."));
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(zipPath, { mode: 0o600 }), ...(context.signal ? [{ signal: context.signal }] : []));
  await context.log(`Downloaded ${bytes} bytes.`);

  await context.update({ phase: "extracting", progress: 70, targetPath: context.storage.cacheDir });
  const extractedPath = path.join(context.storage.cacheDir, "dataset");
  await extractWorkbenchZip(zipPath, extractedPath);
  for (const accession of accessions) {
    const directory = path.join(extractedPath, "ncbi_dataset", "data", accession);
    const entries = await fs.readdir(directory);
    if (!entries.some((name) => name.endsWith(".fna"))) throw new Error(`Missing genome FASTA for ${accession}`);
  }
  // NCBI lists an MD5 for every file of the package; each extracted file is checked against it.
  const md5s = parseMd5List(await fs.readFile(path.join(extractedPath, "md5sum.txt"), "utf8").catch(() => ""));
  if (!md5s.size) throw new Error("The NCBI package has no checksum list (md5sum.txt); import it again.");
  const files: { accession: string; filename: string; path: string; bytes: number; md5: string; sha256: string }[] = [];
  for (const [relative, expected] of md5s) {
    const absolute = path.resolve(extractedPath, relative);
    if (!absolute.startsWith(`${extractedPath}${path.sep}`)) throw new Error("The NCBI checksum list names a file outside the package.");
    const actual = await md5File(absolute);
    if (actual !== expected) throw new Error(`${relative} did not match the MD5 NCBI published. Import it again.`);
    const accession = /data\/(GC[AF]_\d+\.\d+)\//.exec(relative)?.[1];
    if (accession && relative.endsWith(".fna")) {
      files.push({ accession, filename: path.basename(relative), path: relative, bytes: (await fs.stat(absolute)).size, md5: actual, sha256: await computeFileSha256(absolute) });
    }
  }
  if (accessions.some((accession) => !files.some((file) => file.accession === accession))) throw new Error("NCBI's checksum list does not cover every genome FASTA; import it again.");
  await context.log(`Verified ${md5s.size} file(s) against NCBI's md5sum.txt.`);

  await context.update({ phase: "indexing", progress: 90 });
  const [sizeBytes, checksumSha256] = await Promise.all([
    getPathSizeBytes(extractedPath),
    computeFileSha256(zipPath),
  ]);

  const taxon = context.input.taxon.trim();
  return {
    cacheKey: context.cacheKey,
    name: `NCBI genomes: ${taxon}`,
    description: `${accessions.length} genome FASTA package(s) imported from the NCBI Datasets API, verified against NCBI's MD5 list.`,
    sourceType: "ncbi-genomes-taxon",
    sourceMetadata: {
      taxon,
      request: context.input,
      accessions,
      previewSummary: context.preview.summary,
      source: "NCBI Datasets",
      record: accessions.join(", "),
      sourcePage: `https://www.ncbi.nlm.nih.gov/datasets/genome/?taxon=${encodeURIComponent(taxon)}`,
      retrievedAt: new Date().toISOString(),
      downloadUrl: url,
      ...(context.preview.sampleMetadata ?? {}),
      checksums: "Each file checked against the MD5 in NCBI's md5sum.txt; SHA-256 recorded.",
      checksumRepresentation: "sha256-of-downloaded-zip",
      files: files.map((file) => ({ role: "genome", filename: file.filename, storedFilename: file.path, sourceUrl: url, sourceVersion: `md5:${file.md5}`, bytes: file.bytes, md5: file.md5, sha256: file.sha256 })),
    },
    storagePath: extractedPath,
    sizeBytes,
    checksumSha256,
    genomeCount: accessions.length,
  };
}

export const ncbiGenomesTaxonImporter: WorkbenchImporterProvider<NcbiGenomesTaxonInput> = {
  id: "ncbi-genomes-taxon",
  label: "NCBI genomes by taxon",
  description: "Preview and import capped NCBI genome FASTA packages for a taxon through the NCBI Datasets API, verified against NCBI's MD5 list.",
  category: "Reference genomes",
  inputSchema,
  preflight,
  preview,
  getCacheKey,
  start,
};

export const ncbiGenomesTaxonIntegrationTestSpec: WorkbenchIntegrationTestSpec = {
  id: ncbiGenomesTaxonImporter.id,
  kind: "importer",
  fixtureMode: "fixture-and-live",
  requiredLayers: [...WORKBENCH_REQUIRED_TEST_LAYERS],
  expectedOutputs: ["NCBI Datasets genome FASTA package", "selected accession list"],
  allowedWriteRoots: [
    "workbench/cache/ncbi-genomes-taxon/<stable-request-hash>",
    "workbench/jobs/<jobId>",
  ],
  maxRuntimeMs: 120_000,
  maxDownloadBytes: 200 * 1024 * 1024,
  liveSmoke: {
    command: "npm run test:workbench:live -- src/lib/workbench/importers/ncbi-genomes-taxon.live.test.ts",
    input: {
      taxon: "Escherichia coli",
      cap: 1,
      assemblySource: "refseq",
      mag: "exclude",
      excludeAtypical: true,
      referenceOnly: true,
      assemblyLevels: ["complete"],
    },
    maxRuntimeMs: 120_000,
    maxDownloadBytes: 200 * 1024 * 1024,
  },
};
