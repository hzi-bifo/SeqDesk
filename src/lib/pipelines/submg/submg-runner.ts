import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import type { ExecutionSettings } from "@/lib/pipelines/generic-executor";
import { resolveAssemblySelection } from "@/lib/pipelines/assembly-selection";
import { resolveOrderPlatform } from "@/lib/pipelines/order-platform";

interface PrepareSubmgRunOptions {
  runId: string;
  studyId: string;
  sampleIds?: string[];
  config: Record<string, unknown>;
  executionSettings: ExecutionSettings;
  dataBasePath: string;
}

export interface PrepareSubmgRunResult {
  success: boolean;
  runNumber?: string;
  runFolder?: string;
  scriptPath?: string;
  errors: string[];
  warnings: string[];
}

interface SubmgReadMetadata {
  id: string;
  checksum1: string | null;
  checksum2: string | null;
}

interface SubmgBinMetadata {
  id: string;
  name: string;
  path: string;
}

interface SubmgEntryMetadata {
  index: number;
  sampleId: string;
  sampleCode: string;
  sampleTitle: string;
  yamlPath: string;
  readIds: string[];
  reads: SubmgReadMetadata[];
  assemblyId: string | null;
  assemblyFile: string | null;
  bins: SubmgBinMetadata[];
}

interface SubmgRunMetadata {
  runId: string;
  studyId: string;
  generatedAt: string;
  entries: SubmgEntryMetadata[];
}

export interface SubmgProcessingResult {
  samplesUpdated: number;
  readsUpdated: number;
  assembliesUpdated: number;
  binsUpdated: number;
  artifactsCreated: number;
  errors: string[];
  warnings: string[];
}

const DEFAULT_LIBRARY_SOURCE = "METAGENOMIC";
const DEFAULT_LIBRARY_SELECTION = "RANDOM";
const DEFAULT_LIBRARY_STRATEGY = "WGS";
const DEFAULT_INSTRUMENT = "Illumina NovaSeq 6000";
const DEFAULT_INSERT_SIZE = 300;
const TEST_STUDY_ACCESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
interface RequiredChecklistField {
  label: string;
  aliases: string[];
}

const REQUIRED_COLLECTION_DATE_FIELD: RequiredChecklistField = {
  label: "collection date",
  aliases: ["collection date", "collection_date"],
};

const REQUIRED_GEO_LOCATION_FIELD: RequiredChecklistField = {
  label: "geographic location (country and/or sea)",
  aliases: [
    "geographic location (country and/or sea)",
    "geographic_location",
    "geographic location",
  ],
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function toString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\"').replace(/\n/g, " ");
}

function sanitizeSampleCode(sampleId: string): string {
  const cleaned = sampleId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "sample";
}

function normalizeFileStem(filePath: string): string {
  const fileName = path.basename(filePath);
  return fileName.replace(/\.(fa|fasta|fna|fa\.gz|fasta\.gz|fna\.gz)$/i, "");
}

function toAbsoluteDataPath(dataBasePath: string, maybeRelative: string): string {
  if (path.isAbsolute(maybeRelative)) {
    return maybeRelative;
  }
  return path.join(dataBasePath, maybeRelative);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatSampleIssue(sampleId: string, detail: string): string {
  return `Sample ${sampleId}: ${detail}`;
}

function mapSubmissionPlatform(platform: string | null | undefined): string {
  if (!platform) return "ILLUMINA";
  const normalized = platform.toLowerCase().replace(/[_\s-]+/g, "");

  if (["illumina", "hiseq", "miseq", "novaseq", "nextseq", "bgiseq", "dnbseq"].some((token) => normalized.includes(token))) {
    return "ILLUMINA";
  }
  if (["nanopore", "ont", "oxford"].some((token) => normalized.includes(token))) {
    return "OXFORD_NANOPORE";
  }
  if (["pacbio", "smrt", "sequel", "revio"].some((token) => normalized.includes(token))) {
    return "PACBIO_SMRT";
  }

  return platform.toUpperCase().replace(/\s+/g, "_");
}

function extractChecklistScalarValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractChecklistScalarValue(entry);
      if (extracted) return extracted;
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["value", "label", "name", "text"];
    for (const key of preferredKeys) {
      const extracted = extractChecklistScalarValue(record[key]);
      if (extracted) return extracted;
    }
    for (const entry of Object.values(record)) {
      const extracted = extractChecklistScalarValue(entry);
      if (extracted) return extracted;
    }
  }

  return null;
}

function extractScalarChecklistFields(rawChecklistData: string | null): Array<{ key: string; value: string }> {
  if (!rawChecklistData) return [];

  try {
    const parsed = JSON.parse(rawChecklistData) as Record<string, unknown>;
    const output: Array<{ key: string; value: string }> = [];

    for (const [key, value] of Object.entries(parsed)) {
      const extracted = extractChecklistScalarValue(value);
      if (extracted) {
        output.push({ key, value: extracted });
      }
    }

    return output;
  } catch {
    return [];
  }
}

function normalizeChecklistFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^mixs\s+/, "");
}

function findChecklistFieldValue(
  fields: Array<{ key: string; value: string }>,
  wantedKey: string
): string | null {
  const normalizedWanted = normalizeChecklistFieldKey(wantedKey);
  for (const field of fields) {
    if (normalizeChecklistFieldKey(field.key) !== normalizedWanted) continue;
    const trimmed = field.value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function findChecklistFieldValueByAliases(
  fields: Array<{ key: string; value: string }>,
  aliases: string[]
): string | null {
  for (const alias of aliases) {
    const value = findChecklistFieldValue(fields, alias);
    if (value) return value;
  }
  return null;
}

function filterChecklistFields(
  fields: Array<{ key: string; value: string }>,
  excludedKeys: string[]
): Array<{ key: string; value: string }> {
  const excluded = new Set(excludedKeys.map((key) => normalizeChecklistFieldKey(key)));
  return fields.filter((field) => !excluded.has(normalizeChecklistFieldKey(field.key)));
}

function parseSampleSelection(inputSampleIds: string | null, fallback: string[] | undefined): string[] | null {
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }

  if (!inputSampleIds) return null;

  try {
    const parsed = JSON.parse(inputSampleIds) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allStrings = parsed.every((item) => typeof item === "string");
    if (!allStrings) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

function buildQualityFileContent(bins: Array<{ name: string; completeness: number | null; contamination: number | null }>): string {
  const lines = ["Bin Id\tCompleteness\tContamination"];
  for (const bin of bins) {
    const completeness = bin.completeness ?? 0;
    const contamination = bin.contamination ?? 0;
    lines.push(`${bin.name}\t${completeness}\t${contamination}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildTaxonomyFileContent(
  bins: Array<{ name: string }>,
  scientificName: string,
  taxId: string
): string {
  const lines = ["Bin_id\tScientific_name\tTax_id"];
  for (const bin of bins) {
    lines.push(`${bin.name}\t${scientificName}\t${taxId}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildSubmgYaml(params: {
  studyAccession: string;
  studyTitle: string;
  platform: string;
  sampleCode: string;
  sampleTitle: string;
  taxId: string;
  scientificName: string;
  collectionDate: string;
  geographicLocation: string;
  checklistFields: Array<{ key: string; value: string }>;
  reads: Array<{
    file1: string;
    file2: string;
    librarySource: string;
    librarySelection: string;
    libraryStrategy: string;
    instrumentModel: string;
    insertSize: number;
  }>;
  assembly: {
    name: string;
    software: string;
    file: string;
  };
  bins?: {
    directory: string;
    completenessSoftware: string;
    binningSoftware: string;
    qualityFile: string;
    taxonomyFile: string;
  };
}): string {
  const lines: string[] = [];

  lines.push(`STUDY: "${escapeYaml(params.studyAccession)}"`);
  lines.push(`PROJECT_NAME: "${escapeYaml(params.studyTitle)}"`);
  lines.push(`SEQUENCING_PLATFORMS: ["${escapeYaml(params.platform)}"]`);
  lines.push(`METAGENOME_TAXID: "${escapeYaml(params.taxId)}"`);
  lines.push(`METAGENOME_SCIENTIFIC_NAME: "${escapeYaml(params.scientificName)}"`);

  lines.push("NEW_SAMPLES:");
  lines.push(`- TITLE: "${escapeYaml(params.sampleTitle)}"`);
  lines.push(`  collection date: "${escapeYaml(params.collectionDate)}"`);
  lines.push(
    `  geographic location (country and/or sea): "${escapeYaml(params.geographicLocation)}"`
  );
  lines.push("  ADDITIONAL_SAMPLESHEET_FIELDS:");
  for (const field of params.checklistFields) {
    lines.push(`    "${escapeYaml(field.key)}": "${escapeYaml(field.value)}"`);
  }

  lines.push("PAIRED_END_READS:");
  for (const read of params.reads) {
    lines.push(`- NAME: "${escapeYaml(params.sampleCode)}"`);
    lines.push(`  PLATFORM: "${escapeYaml(params.platform)}"`);
    lines.push(`  LIBRARY_NAME: "${escapeYaml(`${params.sampleCode}_library`)}"`);
    lines.push(`  SEQUENCING_INSTRUMENT: "${escapeYaml(read.instrumentModel)}"`);
    lines.push(`  LIBRARY_SOURCE: "${escapeYaml(read.librarySource)}"`);
    lines.push(`  LIBRARY_SELECTION: "${escapeYaml(read.librarySelection)}"`);
    lines.push(`  LIBRARY_STRATEGY: "${escapeYaml(read.libraryStrategy)}"`);
    lines.push(`  INSERT_SIZE: "${read.insertSize}"`);
    lines.push(`  FASTQ1_FILE: "${escapeYaml(read.file1)}"`);
    lines.push(`  FASTQ2_FILE: "${escapeYaml(read.file2)}"`);
    lines.push(`  RELATED_SAMPLE_TITLE: "${escapeYaml(params.sampleTitle)}"`);
    lines.push("  ADDITIONAL_MANIFEST_FIELDS:");
  }

  lines.push("ASSEMBLY:");
  lines.push(`  ASSEMBLY_NAME: "${escapeYaml(params.assembly.name)}"`);
  lines.push(`  ASSEMBLY_SOFTWARE: "${escapeYaml(params.assembly.software)}"`);
  lines.push("  ISOLATION_SOURCE: \"UNKNOWN\"");
  lines.push(`  FASTA_FILE: "${escapeYaml(params.assembly.file)}"`);
  lines.push(`  collection date: "${escapeYaml(params.collectionDate)}"`);
  lines.push(
    `  geographic location (country and/or sea): "${escapeYaml(params.geographicLocation)}"`
  );
  lines.push("  ADDITIONAL_MANIFEST_FIELDS:");

  if (params.bins) {
    lines.push("BINS:");
    lines.push(`  BINS_DIRECTORY: "${escapeYaml(params.bins.directory)}"`);
    lines.push(`  COMPLETENESS_SOFTWARE: "${escapeYaml(params.bins.completenessSoftware)}"`);
    lines.push(`  QUALITY_FILE: "${escapeYaml(params.bins.qualityFile)}"`);
    lines.push(`  BINNING_SOFTWARE: "${escapeYaml(params.bins.binningSoftware)}"`);
    lines.push("  ISOLATION_SOURCE: \"UNKNOWN\"");
    lines.push(`  MANUAL_TAXONOMY_FILE: "${escapeYaml(params.bins.taxonomyFile)}"`);
    lines.push("  ADDITIONAL_MANIFEST_FIELDS:");
  }

  return `${lines.join("\n")}\n`;
}

async function generateRunNumber(pipelineId: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${pipelineId.toUpperCase()}-${dateStr}-`;

  const existingRuns = await db.pipelineRun.findMany({
    where: {
      runNumber: { startsWith: prefix },
    },
    select: { runNumber: true },
    orderBy: { runNumber: "desc" },
    take: 1,
  });

  let nextNum = 1;
  if (existingRuns.length > 0) {
    const lastNum = Number.parseInt(existingRuns[0].runNumber.slice(-3), 10);
    if (!Number.isNaN(lastNum)) {
      nextNum = lastNum + 1;
    }
  }

  return `${prefix}${nextNum.toString().padStart(3, "0")}`;
}

async function prepareRunDirectory(runNumber: string, pipelineRunDir: string): Promise<string> {
  const runFolder = path.join(pipelineRunDir, runNumber);
  await fs.mkdir(runFolder, { recursive: true });
  await fs.mkdir(path.join(runFolder, "logs"), { recursive: true });
  return runFolder;
}

function buildSubmgScript(params: {
  runFolder: string;
  entries: Array<{ index: number; yamlPath: string; hasBins: boolean; sampleCode: string }>;
  executionSettings: ExecutionSettings;
  config: {
    skipChecks: boolean;
    submitBins: boolean;
    condaEnv: string;
  };
  credentials: {
    username: string;
    password: string;
    testMode: boolean;
  };
}): string {
  const { runFolder, entries, executionSettings, config, credentials } = params;
  const lines: string[] = [];

  lines.push("#!/bin/bash");
  lines.push(`#SBATCH -p ${executionSettings.slurmQueue || "cpu"}`);
  lines.push(`#SBATCH -c ${executionSettings.slurmCores || 4}`);
  lines.push(`#SBATCH --mem='${executionSettings.slurmMemory || "32GB"}'`);
  lines.push(`#SBATCH -t ${executionSettings.slurmTimeLimit || 6}:0:0`);
  lines.push(`#SBATCH -D ${runFolder}`);
  lines.push('#SBATCH --output="logs/slurm-%j.out"');
  lines.push('#SBATCH --error="logs/slurm-%j.err"');
  if (executionSettings.slurmOptions) {
    lines.push(`#SBATCH ${executionSettings.slurmOptions}`);
  }
  lines.push("");
  lines.push("set -euo pipefail");
  lines.push("");
  lines.push(`RUN_FOLDER=${shellEscape(runFolder)}`);
  lines.push('STDOUT_LOG="$RUN_FOLDER/logs/pipeline.out"');
  lines.push('STDERR_LOG="$RUN_FOLDER/logs/pipeline.err"');
  lines.push('echo "Starting submg submission at $(date)" > "$STDOUT_LOG"');
  lines.push('echo "" > "$STDERR_LOG"');
  lines.push(
    "trap 'EXIT_CODE=$?; echo \"Pipeline completed with exit code: ${EXIT_CODE} at $(date)\" >> \"$STDOUT_LOG\"; exit ${EXIT_CODE}' EXIT"
  );
  lines.push("");

  lines.push(`export ENA_USERNAME=${shellEscape(credentials.username)}`);
  lines.push(`export ENA_USER=${shellEscape(credentials.username)}`);
  lines.push(`export ENA_PASSWORD=${shellEscape(credentials.password)}`);
  lines.push(`export ENA_TEST_MODE=${credentials.testMode ? "true" : "false"}`);
  lines.push("");

  if (executionSettings.condaPath) {
    const condaBase = executionSettings.condaPath;
    const condaSh = path.join(condaBase, "etc", "profile.d", "conda.sh");
    lines.push(`export PATH=${shellEscape(path.join(condaBase, "bin"))}:"$PATH"`);
    lines.push(`if [ -f ${shellEscape(condaSh)} ]; then`);
    lines.push(`  source ${shellEscape(condaSh)}`);
    lines.push("fi");
    lines.push(`conda activate ${shellEscape(config.condaEnv)} >> "$STDOUT_LOG" 2>> "$STDERR_LOG"`);
    lines.push("");
  }

  lines.push("if ! command -v submg >/dev/null 2>&1; then");
  lines.push('  echo "submg command not found in PATH" >> "$STDERR_LOG"');
  lines.push("  exit 1");
  lines.push("fi");
  lines.push('SUBMG_BIN="$(command -v submg)"');
  lines.push("");

  for (const entry of entries) {
    lines.push(`echo "Submitting sample ${entry.sampleCode} (${entry.index + 1}/${entries.length})" >> "$STDOUT_LOG"`);
    lines.push('STAGING_DIR="$RUN_FOLDER/staging"');
    lines.push('LOGGING_DIR="$RUN_FOLDER/logging"');
    lines.push('OUTPUT_FILE="$RUN_FOLDER/output"');
    lines.push('ERROR_FILE="$RUN_FOLDER/error"');
    lines.push('mkdir -p "$STAGING_DIR" "$LOGGING_DIR"');
    lines.push('rm -f "$OUTPUT_FILE" "$ERROR_FILE"');

    const commandParts = [
      '"$SUBMG_BIN"',
      "submit",
      `--config ${shellEscape(entry.yamlPath)}`,
      '--staging_dir "$STAGING_DIR"',
      '--logging_dir "$LOGGING_DIR"',
      "--submit_samples",
      "--submit_reads",
      "--submit_assembly",
    ];

    if (config.submitBins && entry.hasBins) {
      commandParts.push("--submit_bins");
    }
    if (config.skipChecks) {
      commandParts.push("--skip_checks");
    }

    lines.push(`${commandParts.join(" ")} > "$OUTPUT_FILE" 2> "$ERROR_FILE"`);
    lines.push('if [ -f "$OUTPUT_FILE" ]; then cat "$OUTPUT_FILE" >> "$STDOUT_LOG"; fi');
    lines.push('if [ -f "$ERROR_FILE" ]; then cat "$ERROR_FILE" >> "$STDERR_LOG"; fi');
    lines.push(`rm -rf "$RUN_FOLDER/staging_${entry.index}" "$RUN_FOLDER/logging_${entry.index}"`);
    lines.push(`rm -f "$RUN_FOLDER/output_${entry.index}" "$RUN_FOLDER/error_${entry.index}"`);
    lines.push(`if [ -d "$STAGING_DIR" ]; then mv "$STAGING_DIR" "$RUN_FOLDER/staging_${entry.index}"; fi`);
    lines.push(`if [ -d "$LOGGING_DIR" ]; then mv "$LOGGING_DIR" "$RUN_FOLDER/logging_${entry.index}"; fi`);
    lines.push(`if [ -f "$OUTPUT_FILE" ]; then mv "$OUTPUT_FILE" "$RUN_FOLDER/output_${entry.index}"; fi`);
    lines.push(`if [ -f "$ERROR_FILE" ]; then mv "$ERROR_FILE" "$RUN_FOLDER/error_${entry.index}"; fi`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function findFilesRecursive(rootDir: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const matches: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        matches.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return matches;
}

function indexFromDirectoryName(name: string, base: string): number | null {
  if (name === base) return 0;
  if (!name.startsWith(`${base}_`)) return null;
  const suffix = name.slice(base.length + 1);
  const parsed = Number.parseInt(suffix, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function listNamedDirectories(runFolder: string, base: string): Promise<Array<{ index: number; path: string }>> {
  const result: Array<{ index: number; path: string }> = [];

  try {
    const entries = await fs.readdir(runFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const index = indexFromDirectoryName(entry.name, base);
      if (index === null) continue;
      result.push({
        index,
        path: path.join(runFolder, entry.name),
      });
    }
  } catch {
    return [];
  }

  result.sort((a, b) => a.index - b.index);
  return result;
}

function parseSubmissionAccessions(content: string): {
  runAccession: string | null;
  experimentAccession: string | null;
} {
  const runMatch = content.match(/run accession[^\n]*submission:\s*([^\s]+)/i);
  const experimentMatch = content.match(/experiment accession[^\n]*submission:\s*([^\s]+)/i);

  return {
    runAccession: runMatch?.[1] || null,
    experimentAccession: experimentMatch?.[1] || null,
  };
}

function parseAssemblyAccession(content: string): string | null {
  const patterns = [
    /analysis accession[^\n]*submission:\s*([^\s]+)/i,
    /assembly accession[^\n]*submission:\s*([^\s]+)/i,
    /\b(ERZ[0-9A-Z]+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function parseChecksumsFromRunXml(content: string): string[] {
  const checksums: string[] = [];
  const regex = /checksum=\"([^\"]+)\"/gi;
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    checksums.push(match[1]);
    match = regex.exec(content);
  }
  return checksums;
}

async function createRunArtifacts(runId: string, metadataPath: string, loggingDirs: Array<{ path: string }>): Promise<number> {
  let created = 0;

  const artifactPaths = [metadataPath, ...loggingDirs.map((dir) => dir.path)];

  for (const artifactPath of artifactPaths) {
    const existing = await db.pipelineArtifact.findFirst({
      where: {
        pipelineRunId: runId,
        path: artifactPath,
      },
      select: { id: true },
    });

    if (existing) continue;

    await db.pipelineArtifact.create({
      data: {
        type: "report",
        name: path.basename(artifactPath),
        path: artifactPath,
        pipelineRunId: runId,
        producedByStepId: "parse_receipts",
      },
    });
    created += 1;
  }

  return created;
}

export async function prepareSubmgRun(options: PrepareSubmgRunOptions): Promise<PrepareSubmgRunResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const run = await db.pipelineRun.findUnique({
    where: { id: options.runId },
    select: {
      id: true,
      inputSampleIds: true,
    },
  });

  if (!run) {
    return {
      success: false,
      errors: ["Pipeline run not found"],
      warnings,
    };
  }

  const siteSettings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enaUsername: true,
      enaPassword: true,
      enaTestMode: true,
    },
  });

  if (!siteSettings?.enaUsername || !siteSettings?.enaPassword) {
    return {
      success: false,
      errors: [
        "ENA credentials are not configured. Set Webin username/password in Admin > Data Upload > ENA.",
      ],
      warnings,
    };
  }

  const study = await db.study.findUnique({
    where: { id: options.studyId },
    include: {
      samples: {
        include: {
          reads: true,
          assemblies: {
            select: {
              id: true,
              assemblyName: true,
              assemblyFile: true,
              createdByPipelineRunId: true,
              createdByPipelineRun: {
                select: {
                  id: true,
                  runNumber: true,
                  createdAt: true,
                },
              },
            },
          },
          bins: true,
          order: {
            select: {
              platform: true,
              customFields: true,
              instrumentModel: true,
              librarySource: true,
              librarySelection: true,
              libraryStrategy: true,
            },
          },
        },
        orderBy: { sampleId: "asc" },
      },
    },
  });

  if (!study) {
    return {
      success: false,
      errors: ["Study not found"],
      warnings,
    };
  }

  if (!study.studyAccessionId) {
    return {
      success: false,
      errors: ["Study is missing ENA accession (PRJ*) and cannot be submitted with submg"],
      warnings,
    };
  }

  const enaTestMode = siteSettings.enaTestMode !== false;
  if (enaTestMode) {
    if (!study.testRegisteredAt) {
      return {
        success: false,
        errors: [
          `ENA target is Test server, but study ${study.studyAccessionId} has no ENA Test registration timestamp. Register the study on ENA Test first (or switch ENA target to Production).`,
        ],
        warnings,
      };
    }

    const registrationAgeMs = Date.now() - new Date(study.testRegisteredAt).getTime();
    if (registrationAgeMs > TEST_STUDY_ACCESSION_MAX_AGE_MS) {
      return {
        success: false,
        errors: [
          `ENA Test registration for study ${study.studyAccessionId} is older than 24 hours (${study.testRegisteredAt.toISOString()}) and may be expired. Re-register the study on ENA Test before SubMG submission.`,
        ],
        warnings,
      };
    }
  }

  const requestedSampleIds = parseSampleSelection(run.inputSampleIds, options.sampleIds);
  const selectedSamples = requestedSampleIds
    ? study.samples.filter((sample) => requestedSampleIds.includes(sample.id))
    : study.samples;

  if (selectedSamples.length === 0) {
    return {
      success: false,
      errors: ["No samples selected for SubMG submission"],
      warnings,
    };
  }

  const skipChecks = false;
  const submitBins = toBoolean(options.config.submitBins, true);
  const condaEnv = toString(options.config.condaEnv, "submg");
  const assemblySoftware = toString(options.config.assemblySoftware, "MEGAHIT");
  const completenessSoftware = toString(options.config.completenessSoftware, "CheckM");
  const binningSoftware = toString(options.config.binningSoftware, "MetaBAT2");
  const insertSize = toPositiveInteger(options.config.insertSize, DEFAULT_INSERT_SIZE);

  const runNumber = await generateRunNumber("submg");
  const runFolder = await prepareRunDirectory(runNumber, options.executionSettings.pipelineRunDir);

  const metadataEntries: SubmgEntryMetadata[] = [];

  for (let index = 0; index < selectedSamples.length; index += 1) {
    const sample = selectedSamples[index];
    const sampleCode = sanitizeSampleCode(sample.sampleId);
    const sampleTitle = sample.sampleTitle || sample.sampleAlias || sample.sampleId;
    const sampleErrors: string[] = [];
    const sampleWarnings: string[] = [];

    if (!sample.taxId) {
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          "missing taxId. Set taxonomy metadata before starting SubMG."
        )
      );
    }

    const scientificName = sample.scientificName || "metagenome";

    const pairedReads = sample.reads.filter((read) => Boolean(read.file1 && read.file2));
    if (pairedReads.length === 0) {
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          "has no paired-end read files. SubMG requires FASTQ R1/R2 inputs."
        )
      );
    }

    const readsWithoutChecksums = pairedReads.filter((read) => !read.checksum1 || !read.checksum2);
    if (readsWithoutChecksums.length > 0) {
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          `has reads without MD5 checksums (${readsWithoutChecksums.map((read) => read.id).join(", ")}). Calculate checksums before running SubMG.`
        )
      );
    }

    const resolvedReads = await Promise.all(
      pairedReads.map(async (read) => {
        const absFile1 = toAbsoluteDataPath(options.dataBasePath, read.file1 as string);
        const absFile2 = toAbsoluteDataPath(options.dataBasePath, read.file2 as string);
        const [file1Exists, file2Exists] = await Promise.all([
          pathExists(absFile1),
          pathExists(absFile2),
        ]);

        return {
          id: read.id,
          file1: absFile1,
          file2: absFile2,
          file1Exists,
          file2Exists,
          checksum1: read.checksum1,
          checksum2: read.checksum2,
          librarySource: sample.order.librarySource || DEFAULT_LIBRARY_SOURCE,
          librarySelection: sample.order.librarySelection || DEFAULT_LIBRARY_SELECTION,
          libraryStrategy: sample.order.libraryStrategy || DEFAULT_LIBRARY_STRATEGY,
          instrumentModel: sample.order.instrumentModel || DEFAULT_INSTRUMENT,
          insertSize,
        };
      })
    );

    for (const read of resolvedReads) {
      if (!read.file1Exists) {
        sampleErrors.push(
          formatSampleIssue(
            sample.sampleId,
            `read ${read.id} is missing FASTQ R1 file at ${read.file1}. Reattach reads or regenerate input files.`
          )
        );
      }
      if (!read.file2Exists) {
        sampleErrors.push(
          formatSampleIssue(
            sample.sampleId,
            `read ${read.id} is missing FASTQ R2 file at ${read.file2}. Reattach reads or regenerate input files.`
          )
        );
      }
    }

    const assemblySelection = resolveAssemblySelection(sample, {
      strictPreferred: true,
    });
    const assembly = assemblySelection.assembly;
    let absAssemblyPath: string | null = null;
    if (!assembly?.assemblyFile) {
      const fallback = assemblySelection.fallbackAssembly;
      const fallbackHint = fallback
        ? ` Another assembly is available (${fallback.createdByPipelineRun?.runNumber || "manual"}); switch to Automatic or pick that run explicitly.`
        : "";
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          sample.preferredAssemblyId
            ? `preferred assembly selection is unavailable. Update it in the Study Pipelines panel before running SubMG.${fallbackHint}`
            : "has no assembly file. SubMG requires an assembly FASTA; run the MAG pipeline first for this sample."
        )
      );
    } else {
      absAssemblyPath = toAbsoluteDataPath(options.dataBasePath, assembly.assemblyFile);
      if (!(await pathExists(absAssemblyPath))) {
        sampleErrors.push(
          formatSampleIssue(
            sample.sampleId,
            `assembly file does not exist at ${absAssemblyPath}. Re-run MAG or fix the assembly path in the sample outputs.`
          )
        );
      }
    }

    const binsForSample = sample.bins.filter((bin) => Boolean(bin.binFile));
    if (submitBins && binsForSample.length === 0) {
      sampleWarnings.push(
        formatSampleIssue(
          sample.sampleId,
          "has no bins. Bin submission is optional; this sample will be submitted without bins. Run MAG binning first to include bins."
        )
      );
    }

    const binDescriptors: Array<{
      id: string;
      name: string;
      path: string;
      completeness: number | null;
      contamination: number | null;
    }> = [];
    if (submitBins && binsForSample.length > 0) {
      const resolvedBins = await Promise.all(
        binsForSample.map(async (bin) => {
          const absBinPath = toAbsoluteDataPath(options.dataBasePath, bin.binFile as string);
          return {
            id: bin.id,
            path: absBinPath,
            exists: await pathExists(absBinPath),
            completeness: bin.completeness,
            contamination: bin.contamination,
          };
        })
      );

      for (const bin of resolvedBins) {
        if (!bin.exists) {
          sampleWarnings.push(
            formatSampleIssue(
              sample.sampleId,
              `bin file does not exist at ${bin.path}; this bin will be skipped. Re-run MAG binning to regenerate it.`
            )
          );
          continue;
        }

        binDescriptors.push({
          id: bin.id,
          name: normalizeFileStem(bin.path),
          path: bin.path,
          completeness: bin.completeness,
          contamination: bin.contamination,
        });
      }

      if (binDescriptors.length === 0) {
        sampleWarnings.push(
          formatSampleIssue(
            sample.sampleId,
            "no usable bin files were found on disk. Bin submission will be skipped for this sample."
          )
        );
      }
    }

    const checklistFields = extractScalarChecklistFields(sample.checklistData);
    const collectionDate = findChecklistFieldValueByAliases(
      checklistFields,
      REQUIRED_COLLECTION_DATE_FIELD.aliases
    );
    const geographicLocation = findChecklistFieldValueByAliases(
      checklistFields,
      REQUIRED_GEO_LOCATION_FIELD.aliases
    );
    if (!collectionDate) {
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          `is missing "${REQUIRED_COLLECTION_DATE_FIELD.label}" in checklist metadata. Add it before running SubMG.`
        )
      );
    }
    if (!geographicLocation) {
      sampleErrors.push(
        formatSampleIssue(
          sample.sampleId,
          `is missing "${REQUIRED_GEO_LOCATION_FIELD.label}" in checklist metadata. Add it before running SubMG.`
        )
      );
    }
    const additionalChecklistFields = filterChecklistFields(checklistFields, [
      ...REQUIRED_COLLECTION_DATE_FIELD.aliases,
      ...REQUIRED_GEO_LOCATION_FIELD.aliases,
    ]);

    if (sampleErrors.length > 0) {
      errors.push(...sampleErrors);
      warnings.push(...sampleWarnings);
      continue;
    }

    if (!sample.taxId || !assembly || !absAssemblyPath) {
      errors.push(
        formatSampleIssue(
          sample.sampleId,
          "is missing required SubMG inputs after validation. Recheck reads/assembly metadata."
        )
      );
      warnings.push(...sampleWarnings);
      continue;
    }

    warnings.push(...sampleWarnings);
    const taxId = sample.taxId;

    let taxonomyFilePath: string | null = null;
    let qualityFilePath: string | null = null;

    if (submitBins && binDescriptors.length > 0) {
      taxonomyFilePath = path.join(runFolder, `tax_ids_${sampleCode}.txt`);
      qualityFilePath = path.join(runFolder, `checkm_summary_${sampleCode}.tsv`);

      await fs.writeFile(
        taxonomyFilePath,
        buildTaxonomyFileContent(binDescriptors, scientificName, taxId)
      );
      await fs.writeFile(
        qualityFilePath,
        buildQualityFileContent(binDescriptors)
      );
    }

    const readsBlock = resolvedReads.map((read) => ({
      file1: read.file1,
      file2: read.file2,
      librarySource: read.librarySource,
      librarySelection: read.librarySelection,
      libraryStrategy: read.libraryStrategy,
      instrumentModel: read.instrumentModel,
      insertSize: read.insertSize,
    }));

    const yaml = buildSubmgYaml({
      studyAccession: study.studyAccessionId,
      studyTitle: study.title,
      platform: mapSubmissionPlatform(resolveOrderPlatform(sample.order)),
      sampleCode,
      sampleTitle,
      taxId,
      scientificName,
      collectionDate: collectionDate as string,
      geographicLocation: geographicLocation as string,
      checklistFields: additionalChecklistFields,
      reads: readsBlock,
      assembly: {
        name: `${sampleCode}_assembly`,
        software: assemblySoftware,
        file: absAssemblyPath as string,
      },
      bins:
        submitBins && taxonomyFilePath && qualityFilePath && binDescriptors.length > 0
          ? {
              directory: path.dirname(binDescriptors[0].path),
              completenessSoftware,
              binningSoftware,
              qualityFile: qualityFilePath,
              taxonomyFile: taxonomyFilePath,
            }
          : undefined,
    });

    const yamlPath = path.join(runFolder, `submg_${run.id}_${index}.yaml`);
    await fs.writeFile(yamlPath, yaml);

    metadataEntries.push({
      index,
      sampleId: sample.id,
      sampleCode,
      sampleTitle,
      yamlPath,
      readIds: pairedReads.map((read) => read.id),
      reads: pairedReads.map((read) => ({
        id: read.id,
        checksum1: read.checksum1,
        checksum2: read.checksum2,
      })),
      assemblyId: assembly.id,
      assemblyFile: absAssemblyPath,
      bins: binDescriptors.map((bin) => ({
        id: bin.id,
        name: bin.name,
        path: bin.path,
      })),
    });
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings,
    };
  }

  if (metadataEntries.length === 0) {
    return {
      success: false,
      errors: ["No valid samples available for submg submission"],
      warnings,
    };
  }

  const metadata: SubmgRunMetadata = {
    runId: run.id,
    studyId: study.id,
    generatedAt: new Date().toISOString(),
    entries: metadataEntries,
  };

  const metadataPath = path.join(runFolder, "submg-metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  const script = buildSubmgScript({
    runFolder,
    entries: metadataEntries.map((entry) => ({
      index: entry.index,
      yamlPath: entry.yamlPath,
      hasBins: entry.bins.length > 0,
      sampleCode: entry.sampleCode,
    })),
    executionSettings: options.executionSettings,
    config: {
      skipChecks,
      submitBins,
      condaEnv,
    },
    credentials: {
      username: siteSettings.enaUsername,
      password: siteSettings.enaPassword,
      testMode: siteSettings.enaTestMode !== false,
    },
  });

  const scriptPath = path.join(runFolder, "run.sh");
  await fs.writeFile(scriptPath, script);
  await fs.chmod(scriptPath, 0o755);

  await db.pipelineRun.update({
    where: { id: run.id },
    data: {
      runNumber,
      runFolder,
      outputPath: path.join(runFolder, "logs", "pipeline.out"),
      errorPath: path.join(runFolder, "logs", "pipeline.err"),
      status: "queued",
      queuedAt: new Date(),
      config: JSON.stringify(options.config),
    },
  });

  return {
    success: true,
    runNumber,
    runFolder,
    scriptPath,
    errors,
    warnings,
  };
}

export async function processSubmgRunResults(runId: string): Promise<SubmgProcessingResult> {
  const result: SubmgProcessingResult = {
    samplesUpdated: 0,
    readsUpdated: 0,
    assembliesUpdated: 0,
    binsUpdated: 0,
    artifactsCreated: 0,
    errors: [],
    warnings: [],
  };

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            include: {
              reads: true,
              assemblies: true,
              bins: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    result.errors.push("Run not found");
    return result;
  }

  if (!run.runFolder) {
    result.errors.push("Run has no runFolder");
    return result;
  }

  const metadataPath = path.join(run.runFolder, "submg-metadata.json");
  const metadataRaw = await readFileIfExists(metadataPath);

  let metadata: SubmgRunMetadata | null = null;
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw) as SubmgRunMetadata;
    } catch {
      result.warnings.push("Failed to parse submg-metadata.json");
    }
  }

  const entryByIndex = new Map<number, SubmgEntryMetadata>();
  const sampleAliasToId = new Map<string, string>();
  const sampleTitleToId = new Map<string, string>();

  for (const entry of metadata?.entries || []) {
    entryByIndex.set(entry.index, entry);
    sampleAliasToId.set(entry.sampleCode, entry.sampleId);
    sampleTitleToId.set(entry.sampleTitle, entry.sampleId);
  }

  const selectedSampleIds = new Set((metadata?.entries || []).map((entry) => entry.sampleId));

  const loggingDirs = await listNamedDirectories(run.runFolder, "logging");

  for (const loggingDir of loggingDirs) {
    const entry = entryByIndex.get(loggingDir.index) || null;

    const sampleAccessionPath = path.join(
      loggingDir.path,
      "biological_samples",
      "sample_preliminary_accessions.txt"
    );
    const sampleAccessionContent = await readFileIfExists(sampleAccessionPath);

    if (sampleAccessionContent) {
      const lines = sampleAccessionContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (let i = 1; i < lines.length; i += 1) {
        const parts = lines[i].split(/\s+/);
        if (parts.length < 3) continue;

        const [alias, sampleAccession, biosampleAccession] = parts;
        const sampleId =
          sampleAliasToId.get(alias) ||
          sampleTitleToId.get(alias) ||
          entry?.sampleId ||
          null;

        if (!sampleId) {
          result.warnings.push(`Could not map sample alias '${alias}' to sample ID`);
          continue;
        }

        try {
          await db.sample.update({
            where: { id: sampleId },
            data: {
              sampleAccessionNumber: sampleAccession,
              biosampleNumber: biosampleAccession,
            },
          });
          result.samplesUpdated += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          result.warnings.push(`Failed to update sample ${sampleId}: ${message}`);
        }
      }
    }

    const readReports = await findFilesRecursive(
      loggingDir.path,
      (filePath) =>
        path.basename(filePath) === "webin-cli.report" &&
        filePath.includes(`${path.sep}reads${path.sep}`)
    );

    for (const readReportPath of readReports) {
      const reportContent = await readFileIfExists(readReportPath);
      if (!reportContent) continue;

      const accessions = parseSubmissionAccessions(reportContent);
      if (!accessions.runAccession && !accessions.experimentAccession) {
        continue;
      }

      const readDir = path.dirname(readReportPath);
      const readDirName = path.basename(readDir);
      const readToken = readDirName.replace(/^reads_/, "");

      const runXmlCandidates = [
        path.join(readDir, "reads", readToken, "submit", "run.xml"),
        path.join(readDir, "submit", "run.xml"),
      ];

      let checksums: string[] = [];
      for (const candidate of runXmlCandidates) {
        const runXml = await readFileIfExists(candidate);
        if (!runXml) continue;
        checksums = parseChecksumsFromRunXml(runXml);
        if (checksums.length >= 2) break;
      }

      let readId: string | null = null;

      if (checksums.length >= 2 && entry) {
        for (const readMeta of entry.reads) {
          const directMatch =
            readMeta.checksum1 === checksums[0] && readMeta.checksum2 === checksums[1];
          const swappedMatch =
            readMeta.checksum1 === checksums[1] && readMeta.checksum2 === checksums[0];
          if (directMatch || swappedMatch) {
            readId = readMeta.id;
            break;
          }
        }
      }

      if (!readId && entry && entry.readIds.length === 1) {
        readId = entry.readIds[0];
      }

      if (!readId && checksums.length >= 2) {
        const matchedRead = await db.read.findFirst({
          where: {
            OR: [
              {
                checksum1: checksums[0],
                checksum2: checksums[1],
              },
              {
                checksum1: checksums[1],
                checksum2: checksums[0],
              },
            ],
            sampleId:
              selectedSampleIds.size > 0
                ? { in: Array.from(selectedSampleIds) }
                : undefined,
          },
          select: { id: true },
        });
        readId = matchedRead?.id || null;
      }

      if (!readId) {
        result.warnings.push(`Could not map read report ${readReportPath} to a read record`);
        continue;
      }

      try {
        await db.read.update({
          where: { id: readId },
          data: {
            runAccessionNumber: accessions.runAccession,
            experimentAccessionNumber: accessions.experimentAccession,
          },
        });
        result.readsUpdated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        result.warnings.push(`Failed to update read ${readId}: ${message}`);
      }
    }

    const assemblyReports = await findFilesRecursive(
      loggingDir.path,
      (filePath) =>
        path.basename(filePath) === "webin-cli.report" &&
        filePath.includes(`${path.sep}assembly_fasta${path.sep}`)
    );

    if (assemblyReports.length > 0) {
      const assemblyReportContent = await readFileIfExists(assemblyReports[0]);
      if (assemblyReportContent) {
        const assemblyAccession = parseAssemblyAccession(assemblyReportContent);
        const assemblyId = entry?.assemblyId || null;

        if (assemblyAccession && assemblyId) {
          try {
            await db.assembly.update({
              where: { id: assemblyId },
              data: {
                assemblyAccession,
              },
            });
            result.assembliesUpdated += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            result.warnings.push(`Failed to update assembly ${assemblyId}: ${message}`);
          }
        }
      }
    }

    const binAccessionFiles = await findFilesRecursive(
      loggingDir.path,
      (filePath) =>
        path.basename(filePath) === "bin_to_preliminary_accession.tsv" &&
        filePath.includes(`${path.sep}bins${path.sep}`)
    );

    if (binAccessionFiles.length > 0) {
      const binAccessionContent = await readFileIfExists(binAccessionFiles[0]);
      if (binAccessionContent) {
        const binLookup = new Map<string, string>();
        for (const bin of entry?.bins || []) {
          binLookup.set(bin.name, bin.id);
        }

        const lines = binAccessionContent
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length < 2) continue;

          const rawBinName = parts[0];
          const accession = parts[1];
          const normalizedBinName = normalizeFileStem(rawBinName);

          let binId = binLookup.get(normalizedBinName) || null;

          if (!binId && entry?.sampleId) {
            const matchedBin = await db.bin.findFirst({
              where: {
                sampleId: entry.sampleId,
                binFile: {
                  contains: normalizedBinName,
                },
              },
              select: { id: true },
            });
            binId = matchedBin?.id || null;
          }

          if (!binId) {
            result.warnings.push(`Could not map bin '${rawBinName}' to bin record`);
            continue;
          }

          try {
            await db.bin.update({
              where: { id: binId },
              data: {
                binAccession: accession,
              },
            });
            result.binsUpdated += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            result.warnings.push(`Failed to update bin ${binId}: ${message}`);
          }
        }
      }
    }
  }

  result.artifactsCreated = await createRunArtifacts(runId, metadataPath, loggingDirs);

  const summary = {
    samplesUpdated: result.samplesUpdated,
    readsUpdated: result.readsUpdated,
    assembliesUpdated: result.assembliesUpdated,
    binsUpdated: result.binsUpdated,
    artifactsCreated: result.artifactsCreated,
    errors: result.errors.length > 0 ? result.errors : undefined,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };

  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      results: JSON.stringify(summary),
    },
  });

  return result;
}
