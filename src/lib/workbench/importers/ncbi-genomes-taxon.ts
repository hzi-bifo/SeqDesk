import fs from "fs/promises";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import {
  buildStableRequestHash,
  computeFileSha256,
  getPathSizeBytes,
} from "@/lib/workbench/storage";
import { resolveWorkbenchStoreCommand } from "@/lib/workbench/store";
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

const execFileAsync = promisify(execFile);
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
      continue;
    }
    const root = isRecord(parsed) && isRecord(parsed.report) ? parsed.report : parsed;
    if (!isRecord(root)) continue;
    const organism = nestedRecord(root, "organism");
    const assemblyInfo = nestedRecord(root, "assembly_info");
    const assemblyStats = nestedRecord(root, "assembly_stats");
    const accession =
      optionalString(root.accession) ||
      optionalString(root.assembly_accession) ||
      optionalString(root.current_accession);
    if (!accession) continue;
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

async function resolveNcbiCommand(command: "datasets" | "unzip"): Promise<string> {
  return resolveWorkbenchStoreCommand(command, "ncbi-datasets-cli");
}

async function commandAvailable(command: "datasets" | "unzip"): Promise<boolean> {
  try {
    const resolvedCommand = await resolveNcbiCommand(command);
    await execFileAsync(resolvedCommand, command === "unzip" ? ["-v"] : ["--version"], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function preflight(): Promise<WorkbenchImporterPreflight> {
  const [datasets, unzip] = await Promise.all([
    commandAvailable("datasets"),
    commandAvailable("unzip"),
  ]);
  if (!datasets) {
    return {
      ok: false,
      message: "NCBI Datasets CLI is not installed",
      details:
        "Open Workbench Store and install Reference genomes, or install the `datasets` command on the SeqDesk server PATH.",
    };
  }
  if (!unzip) {
    return {
      ok: false,
      message: "`unzip` is not available",
      details:
        "Open Workbench Store and install Reference genomes, or install `unzip` on the SeqDesk server PATH.",
    };
  }
  return { ok: true };
}

function buildSummaryArgs(input: NcbiGenomesTaxonInput, limit: number): string[] {
  const args = [
    "summary",
    "genome",
    "taxon",
    input.taxon,
    "--as-json-lines",
    "--limit",
    String(limit),
    "--mag",
    input.mag,
    "--assembly-version",
    "latest",
  ];
  if (input.assemblySource !== "all") {
    args.push("--assembly-source", input.assemblySource === "refseq" ? "RefSeq" : "GenBank");
  }
  if (input.excludeAtypical) args.push("--exclude-atypical");
  if (input.referenceOnly) args.push("--reference");
  if (input.assemblyLevels.length > 0) {
    args.push("--assembly-level", input.assemblyLevels.join(","));
  }
  return args;
}

async function preview(input: NcbiGenomesTaxonInput): Promise<WorkbenchImportPreview> {
  const cap = Math.min(input.cap, HARD_MAX);
  const args = buildSummaryArgs(input, cap + 1);
  const datasetsCommand = await resolveNcbiCommand("datasets");
  const { stdout } = await execFileAsync(datasetsCommand, args, {
    timeout: PREVIEW_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  const genomes = parseNcbiGenomeSummaryLines(stdout, cap + 1);
  const capped = genomes.length > cap;
  const selected = genomes.slice(0, cap);
  return {
    providerId: ncbiGenomesTaxonImporter.id,
    summary: {
      label: `NCBI genomes for ${input.taxon}`,
      requestedTaxon: input.taxon,
      totalFound: genomes.length,
      selectedCount: selected.length,
      capped,
      cap,
      hardMax: HARD_MAX,
    },
    genomes: selected,
    warnings: capped
      ? [`Preview is capped at ${cap} genomes. Narrow filters or reduce the cap before importing larger taxonomic groups.`]
      : undefined,
  };
}

function getCacheKey(input: NcbiGenomesTaxonInput, previewResult: WorkbenchImportPreview): string {
  return buildStableRequestHash(ncbiGenomesTaxonImporter.id, {
    ...input,
    accessions: previewResult.genomes.map((genome) => genome.accession),
    include: "genome",
  });
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await fs.appendFile(filePath, `${line}\n`);
}

async function runLoggedCommand(
  command: string,
  args: string[],
  logPath: string
): Promise<void> {
  await appendLine(logPath, `[${new Date().toISOString()}] ${command} ${args.join(" ")}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => {
      void fs.appendFile(logPath, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      void fs.appendFile(logPath, chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function start(
  context: WorkbenchImportStartContext<NcbiGenomesTaxonInput>
): Promise<WorkbenchImportResult> {
  const accessions = context.preview.genomes.map((genome) => genome.accession);
  if (accessions.length === 0) {
    throw new Error("NCBI preview did not return any genome accessions to import.");
  }

  const accessionsPath = path.join(context.storage.jobDir, "accessions.txt");
  const zipPath = path.join(context.storage.jobDir, "ncbi_dataset.zip");
  await fs.writeFile(accessionsPath, `${accessions.join("\n")}\n`);
  const [datasetsCommand, unzipCommand] = await Promise.all([
    resolveNcbiCommand("datasets"),
    resolveNcbiCommand("unzip"),
  ]);

  await context.update({ status: "running", phase: "downloading", progress: 10, targetPath: zipPath });
  await context.log(`Writing ${accessions.length} selected genome accession(s) to ${accessionsPath}`);
  await runLoggedCommand(
    datasetsCommand,
    [
      "download",
      "genome",
      "accession",
      "--inputfile",
      accessionsPath,
      "--include",
      "genome",
      "--filename",
      zipPath,
      "--no-progressbar",
    ],
    context.storage.logPath
  );

  await context.update({ phase: "extracting", progress: 70, targetPath: context.storage.cacheDir });
  await fs.rm(context.storage.cacheDir, { recursive: true, force: true });
  await fs.mkdir(context.storage.cacheDir, { recursive: true });
  await runLoggedCommand(
    unzipCommand,
    ["-q", zipPath, "-d", context.storage.cacheDir],
    context.storage.logPath
  );

  await context.update({ phase: "indexing", progress: 90 });
  const [sizeBytes, checksumSha256] = await Promise.all([
    getPathSizeBytes(context.storage.cacheDir),
    computeFileSha256(zipPath),
  ]);

  const taxon = context.input.taxon.trim();
  return {
    cacheKey: context.cacheKey,
    name: `NCBI genomes: ${taxon}`,
    description: `${accessions.length} genome FASTA package(s) imported from NCBI Datasets.`,
    sourceType: "ncbi-genomes-taxon",
    sourceMetadata: {
      taxon,
      request: context.input,
      accessions,
      previewSummary: context.preview.summary,
    },
    storagePath: context.storage.cacheDir,
    sizeBytes,
    checksumSha256,
    genomeCount: accessions.length,
  };
}

export const ncbiGenomesTaxonImporter: WorkbenchImporterProvider<NcbiGenomesTaxonInput> = {
  id: "ncbi-genomes-taxon",
  label: "NCBI Genomes by Taxon",
  description: "Preview and import capped NCBI genome FASTA packages for a taxon.",
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
