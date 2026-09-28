import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { readTail } from "@/lib/pipelines/nextflow";
import { createDataset, writeDatasetVersion } from "./datasets";
import { parseDelimited } from "./parsers/delimited";
import { readRunIsolation, sandboxFromLog } from "./sandbox/prepare";
import { applyTableContract, inferSchema } from "./schema";
import { TableContractSchema, type TableContract } from "./table-contract";
import { buildLedger, scanTable, type LedgerInput, type LedgerOutput } from "./ledger";
import type { ExploreRole, ExploreRoleMap, ExploreSensitivity } from "./types";
import { SENSITIVITY_RANK } from "./types";
import { parseMetricDefinition, type MetricDefinition } from "./metric-definition";
import { loadedResultsRuntimeFingerprint, runRuntimeInfo } from "./runtime-fingerprint";
import { resolveContainedPath } from "./storage";

const ARTIFACT_FORMATS = new Set(["plotly-json", "png", "svg", "html", "tsv", "md", "txt", "json", "csv", "pdf"]);
const ARTIFACT_KINDS = new Set(["figure", "table", "report", "log"]);

interface ManifestArtifact {
  name?: unknown;
  kind?: unknown;
  format?: unknown;
  path?: unknown;
  title?: unknown;
  description?: unknown;
  table?: { tableKind?: unknown; roles?: unknown; columns?: unknown; schemaId?: unknown; schemaVersion?: unknown; rowEntity?: unknown } | null;
}

interface OutputManifest {
  artifacts?: ManifestArtifact[];
  notes?: unknown;
  metrics?: unknown;
  metricMeta?: unknown;
  drops?: unknown;
  helperVersion?: unknown;
  language?: unknown;
}

/** Labels and units the step gave its values (`metric(key, value, label=, unit=)`). */
function parseMetricMeta(raw: unknown): Record<string, { label?: string; unit?: string; definition?: MetricDefinition }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const meta: Record<string, { label?: string; unit?: string; definition?: MetricDefinition }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { label?: unknown; unit?: unknown; definition?: unknown };
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim().slice(0, 80) : undefined;
    const unit = typeof entry.unit === "string" && entry.unit.trim() ? entry.unit.trim().slice(0, 80) : undefined;
    const definition = parseMetricDefinition(entry.definition) ?? undefined;
    if (label || unit || definition) meta[key] = { ...(label ? { label } : {}), ...(unit ? { unit } : {}), ...(definition ? { definition } : {}) };
  }
  return meta;
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * The real file behind a path the step named, or null. The step wrote the run folder, so a name inside it may be a
 * symlink to anywhere on the host (another run, the Compute env, $HOME): this runs outside the sandbox, so it must
 * follow links itself and accept only a regular file whose real path stays inside the run folder.
 */
async function containedFile(runFolder: string, absolute: string): Promise<string | null> {
  const real = await resolveContainedPath(runFolder, absolute).catch(() => null);
  if (!real) return null;
  const stat = await fs.stat(real).catch(() => null);
  return stat?.isFile() ? real : null;
}

async function sha256(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Finalize a run whose wrapper wrote the exit marker: record artifacts from
 * outputs/manifest.json, promote result tables to derived datasets (only when
 * the run succeeded), store a results summary and set the terminal status.
 */
export async function finalizeExploreRun(runId: string, exitCode: number): Promise<void> {
  const run = await db.exploreAnalysisRun.findUnique({
    where: { id: runId },
    include: { analysis: true, revision: true },
  });
  if (!run || !run.runFolder) return;
  const runFolder = run.runFolder;
  const outputsDir = path.join(runFolder, "outputs");
  const warnings: string[] = [];
  let manifest: OutputManifest | null = null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(outputsDir, "manifest.json"), "utf8")) as OutputManifest;
  } catch {
    if (exitCode === 0) warnings.push("The analysis finished but wrote no outputs/manifest.json; nothing was recorded.");
  }

  const inputsInfo = await fs
    .readFile(path.join(runFolder, "inputs.json"), "utf8")
    .then((text) => JSON.parse(text) as { inputs?: Record<string, { datasetId?: string; versionId?: string; sensitivity?: string; path?: string; roles?: Record<string, string> }> })
    .catch(() => null);
  let sensitivity: ExploreSensitivity = "standard";
  for (const input of Object.values(inputsInfo?.inputs ?? {})) {
    const candidate = (input.sensitivity ?? "standard") as ExploreSensitivity;
    if ((SENSITIVITY_RANK[candidate] ?? 0) > SENSITIVITY_RANK[sensitivity]) sensitivity = candidate;
  }

  let figures = 0;
  let tables = 0;
  let reports = 0;
  const ledgerOutputs: LedgerOutput[] = [];
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest!.artifacts : [];
  for (const entry of artifacts) {
    const relative = typeof entry.path === "string" ? entry.path : "";
    const kind = typeof entry.kind === "string" && ARTIFACT_KINDS.has(entry.kind) ? entry.kind : null;
    const format = typeof entry.format === "string" && ARTIFACT_FORMATS.has(entry.format) ? entry.format : null;
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 120) : null;
    if (!relative || !kind || !format || !name) {
      warnings.push(`Skipped a manifest entry with missing name, kind, format or path.`);
      continue;
    }
    const absolute = path.resolve(runFolder, relative);
    if (!isInside(runFolder, absolute)) {
      warnings.push(`Skipped ${relative}: outside the run folder.`);
      continue;
    }
    const real = await containedFile(runFolder, absolute);
    if (!real) {
      const link = await fs.lstat(absolute).then((stat) => stat.isSymbolicLink()).catch(() => false);
      warnings.push(link ? `Skipped ${relative}: a link that leaves the run folder or is not a file.` : `Skipped ${relative}: file not found.`);
      continue;
    }
    const size = BigInt((await fs.stat(real)).size);
    const checksum = await sha256(real).catch(() => null);
    const artifact = await db.exploreArtifact.upsert({
      where: { runId_path: { runId: run.id, path: absolute } },
      update: { kind, format, name, size, checksum },
      create: { runId: run.id, kind, format, name, path: absolute, size, checksum },
    });
    if (kind === "figure") figures += 1;
    else if (kind === "report") reports += 1;
    else if (kind === "table") {
      tables += 1;
      if (format !== "tsv" && format !== "csv") continue;
      const roles = entry.table?.roles && typeof entry.table.roles === "object" ? (entry.table.roles as Record<string, unknown>) : {};
      const scanned = await scanTable(real, { delimiter: format === "csv" ? "," : "\t", sampleColumn: typeof roles.sample === "string" ? roles.sample : null }).catch(() => null);
      ledgerOutputs.push({ name, dims: scanned?.dims ?? null, samples: scanned?.samples ?? null });
      // Trial runs (a sample of the data) never write tables: they feed nothing (FLOW-GAPS D13).
      if (run.trial) continue;
      if (exitCode !== 0) {
        // The file stays downloadable from the run page, but a failed run must
        // not move a dataset's current version forward with a partial table.
        warnings.push(`Table ${name} was not promoted to a dataset because the run failed.`);
        continue;
      }
      try {
        const contract = TableContractSchema.parse({ columns: entry.table?.columns, schemaId: entry.table?.schemaId, schemaVersion: entry.table?.schemaVersion, rowEntity: entry.table?.rowEntity });
        const derived = await promoteTable(run, artifact.id, real, {
          artifactName: name,
          name: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : name,
          format: format as "tsv" | "csv",
          tableKind: typeof entry.table?.tableKind === "string" ? entry.table.tableKind : null,
          roles: entry.table?.roles && typeof entry.table.roles === "object" ? (entry.table.roles as Record<string, string>) : {},
          sensitivity,
          contract,
        });
        await db.exploreArtifact.update({ where: { id: artifact.id }, data: { derivedDatasetId: derived.datasetId, derivedVersionId: derived.versionId } });
      } catch (error) {
        warnings.push(`Table ${name} could not be promoted to a dataset: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const [outputTail, errorTail] = await Promise.all([
    readTail(path.join(runFolder, "logs", "pipeline.out")),
    readTail(path.join(runFolder, "logs", "pipeline.err")),
  ]);
  const isolation = await readRunIsolation(runFolder);
  const fullLog = await fs.readFile(path.join(runFolder, "logs", "pipeline.out"), "utf8").catch(() => null);
  const reported = sandboxFromLog(fullLog);
  if (isolation && isolation.tool !== "none" && reported && reported.used === "none") {
    warnings.push(`The run was not sandboxed: ${reported.detail || "the sandbox tool was missing where the run executed"}.`);
  }
  // What the step did to its tables, from what was staged, what it wrote and its drop() calls.
  const ledgerInputs: LedgerInput[] = [];
  for (const [alias, input] of Object.entries(inputsInfo?.inputs ?? {})) {
    const relative = typeof input.path === "string" ? input.path : "";
    const absolute = relative ? path.resolve(runFolder, relative) : "";
    const real = absolute && isInside(runFolder, absolute) ? await containedFile(runFolder, absolute) : null;
    const scanned = real ? await scanTable(real, { sampleColumn: typeof input.roles?.sample === "string" ? input.roles.sample : null }).catch(() => null) : null;
    ledgerInputs.push({ alias, dims: scanned?.dims ?? null, samples: scanned?.samples ?? null });
  }
  const ledger = buildLedger(ledgerInputs, ledgerOutputs, manifest?.drops);
  const results = {
    exitCode,
    sandbox: reported ? { used: reported.used, detail: reported.detail, planHash: isolation?.planHash ?? null, network: isolation?.network ?? null } : null,
    figures,
    tables,
    reports,
    notes: Array.isArray(manifest?.notes) ? manifest!.notes.filter((note): note is string => typeof note === "string").slice(0, 50) : [],
    metrics: manifest?.metrics && typeof manifest.metrics === "object" ? manifest.metrics : {},
    metricMeta: parseMetricMeta(manifest?.metricMeta),
    ledger,
    warnings,
    // Which helper wrote the manifest and which finalizer read it, so results
    // finished by an older monitor can be told apart.
    runtime: runRuntimeInfo(loadedResultsRuntimeFingerprint(), manifest),
  };
  const completedAt = new Date();
  await db.exploreAnalysisRun.updateMany({
    where: { id: run.id, status: { in: ["pending", "queued", "running"] } },
    data: {
      status: exitCode === 0 ? "completed" : "failed",
      exitCode,
      completedAt,
      durationMs: run.startedAt ? Math.max(0, completedAt.getTime() - run.startedAt.getTime()) : null,
      outputTail: outputTail ?? undefined,
      errorTail: errorTail ?? undefined,
      results: JSON.stringify(results),
    },
  });
}

async function promoteTable(
  run: { id: string; runNumber: string; analysisId: string; analysis: { targetKey: string; name: string; createdById: string }; revision: { number: number } },
  artifactId: string,
  filePath: string,
  options: { artifactName: string; name: string; format: "tsv" | "csv"; tableKind: string | null; roles: Record<string, string>; sensitivity: ExploreSensitivity; contract: TableContract }
): Promise<{ datasetId: string; versionId: string }> {
  const text = await fs.readFile(filePath, "utf8");
  const parsed = parseDelimited(text, { delimiter: options.format === "csv" ? "," : "\t" });
  if (parsed.columns.length === 0) throw new Error("empty table");
  const roles: ExploreRoleMap = {};
  for (const [role, column] of Object.entries(options.roles)) {
    if (parsed.columns.includes(column)) roles[role as ExploreRole] = column;
  }
  const schema = applyTableContract(inferSchema(parsed.rows, { roles, groups: Object.fromEntries(parsed.columns.map((key) => [key, "analysis"])) }), parsed.rows, options.contract);
  const datasetName = `${options.name} (${run.analysis.name})`;
  const description = `Written by analysis ${run.analysis.name}, revision ${run.revision.number}, run ${run.runNumber}.`;
  const sourceConfig = { builder: "analysis-run", analysisId: run.analysisId, artifactName: options.artifactName, runId: run.id, artifactId };

  // One output dataset per analysis and table name: a re-run writes a new
  // version instead of a new dataset, so the canvas shows outputs refreshing.
  const candidates = await db.exploreDataset.findMany({ where: { targetKey: run.analysis.targetKey, kind: "derived" }, select: { id: true, name: true, sourceConfig: true } });
  const parsedCandidates = candidates.map((candidate) => {
    try {
      return { candidate, config: JSON.parse(candidate.sourceConfig ?? "{}") as { analysisId?: string; artifactName?: string; runId?: string } };
    } catch {
      return { candidate, config: {} as { analysisId?: string; artifactName?: string; runId?: string } };
    }
  });
  let existing = parsedCandidates.find(({ config }) => config.analysisId === run.analysisId && config.artifactName === options.artifactName)?.candidate;
  if (!existing) {
    // Datasets written before analysisId and artifactName were recorded: match
    // a dataset of this table name written by an earlier run of the same analysis.
    const runIds = new Set((await db.exploreAnalysisRun.findMany({ where: { analysisId: run.analysisId }, select: { id: true } })).map((entry) => entry.id));
    existing = parsedCandidates.find(({ candidate, config }) => !config.artifactName && config.runId && runIds.has(config.runId) && candidate.name.startsWith(`${options.name} (`))?.candidate;
  }
  const dataset = existing
    ? await db.exploreDataset.update({
        where: { id: existing.id },
        data: { name: datasetName, description, tableKind: options.tableKind, sensitivity: options.sensitivity, roles: JSON.stringify(roles), sourceConfig: JSON.stringify(sourceConfig) },
      })
    : await createDataset({
        targetKey: run.analysis.targetKey,
        kind: "derived",
        tableKind: options.tableKind,
        name: datasetName,
        description,
        sensitivity: options.sensitivity,
        roles,
        sourceConfig,
        createdById: run.analysis.createdById,
      });
  const version = await writeDatasetVersion({
    datasetId: dataset.id,
    schema,
    rows: parsed.rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "analysis-run@1",
      sources: [
        { type: "analysis-run", id: run.id, label: run.runNumber },
        { type: "artifact", id: artifactId, label: path.basename(filePath) },
      ],
    },
    buildSource: "analysis-run",
    createdById: run.analysis.createdById,
    keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon },
  });
  return { datasetId: dataset.id, versionId: version.versionId };
}
