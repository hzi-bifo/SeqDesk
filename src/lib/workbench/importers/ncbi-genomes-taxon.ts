import path from "path";
import { z } from "zod";
import {
  buildStableRequestHash,
  getPathSizeBytes,
} from "@/lib/workbench/storage";
import { DATASETS_API, NCBI_LICENCE, NCBI_LICENCE_URL, ncbiApiKey, ncbiJson } from "./ncbi-client";
import { downloadGenomePackage, parseMd5List } from "./ncbi-datasets";
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

const LEVELS: Record<NcbiGenomesTaxonInput["assemblyLevels"][number], string> = { complete: "complete_genome", chromosome: "chromosome", scaffold: "scaffold", contig: "contig" };
const MAG: Record<NcbiGenomesTaxonInput["mag"], string> = { exclude: "METAGENOME_DERIVED_EXCLUDE", all: "METAGENOME_DERIVED_UNSET", only: "METAGENOME_DERIVED_ONLY" };

export { parseMd5List };

async function preflight(): Promise<WorkbenchImporterPreflight> {
  const key = await ncbiApiKey();
  return { ok: true, message: `Uses the public NCBI Datasets API${key.value ? " with this server's NCBI API key (10 requests a second)" : " (3 requests a second; an administrator can add an NCBI API key for 10)"}.` };
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
  const body = await ncbiJson(buildDatasetReportUrl(input, cap + 1), {
    source: "NCBI Datasets", timeoutMs: PREVIEW_TIMEOUT_MS,
    notFound: `NCBI does not know the taxon “${input.taxon}”. Use a scientific name or an NCBI taxon ID.`,
  }).catch((error: unknown) => {
    if (error instanceof Error && /returned an answer that could not be read/.test(error.message)) return null;
    throw error;
  }) as { reports?: unknown[]; total_count?: number } | null;
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
    sampleMetadata: { licence: NCBI_LICENCE, licenceUrl: NCBI_LICENCE_URL, approximateFastaBytes: String(Math.round(bytes * 1.02)) },
    warnings: warnings.length ? warnings : undefined,
  };
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

  const extractedPath = path.join(context.storage.cacheDir, "dataset");
  const pack = await downloadGenomePackage(context, { accessions, types: ["GENOME_FASTA"], destination: extractedPath, name: "ncbi_dataset" });
  const url = pack.url;
  const files = pack.files.filter((file) => file.kind === "genome");

  await context.update({ phase: "indexing", progress: 90 });
  const sizeBytes = await getPathSizeBytes(extractedPath);
  const checksumSha256 = pack.zipSha256;

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
