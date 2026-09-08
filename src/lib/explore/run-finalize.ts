import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { readTail } from "@/lib/pipelines/nextflow";
import { createDataset, writeDatasetVersion } from "./datasets";
import { parseDelimited } from "./parsers/delimited";
import { readRunIsolation, sandboxFromLog } from "./sandbox/prepare";
import { inferSchema } from "./schema";
import type { ExploreRole, ExploreRoleMap, ExploreSensitivity } from "./types";
import { SENSITIVITY_RANK } from "./types";

const ARTIFACT_FORMATS = new Set(["plotly-json", "png", "svg", "html", "tsv", "md", "txt", "json", "csv", "pdf"]);
const ARTIFACT_KINDS = new Set(["figure", "table", "report", "log"]);

interface ManifestArtifact {
  name?: unknown;
  kind?: unknown;
  format?: unknown;
  path?: unknown;
  title?: unknown;
  description?: unknown;
  table?: { tableKind?: unknown; roles?: unknown } | null;
}

interface OutputManifest {
  artifacts?: ManifestArtifact[];
  notes?: unknown;
  metrics?: unknown;
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
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
    .then((text) => JSON.parse(text) as { inputs?: Record<string, { datasetId?: string; versionId?: string; sensitivity?: string }> })
    .catch(() => null);
  let sensitivity: ExploreSensitivity = "standard";
  for (const input of Object.values(inputsInfo?.inputs ?? {})) {
    const candidate = (input.sensitivity ?? "standard") as ExploreSensitivity;
    if ((SENSITIVITY_RANK[candidate] ?? 0) > SENSITIVITY_RANK[sensitivity]) sensitivity = candidate;
  }

  let figures = 0;
  let tables = 0;
  let reports = 0;
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
    let size: bigint | null = null;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw new Error("not a file");
      size = BigInt(stat.size);
    } catch {
      warnings.push(`Skipped ${relative}: file not found.`);
      continue;
    }
    const checksum = await sha256(absolute).catch(() => null);
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
      if (exitCode !== 0) {
        // The file stays downloadable from the run page, but a failed run must
        // not move a dataset's current version forward with a partial table.
        warnings.push(`Table ${name} was not promoted to a dataset because the run failed.`);
        continue;
      }
      try {
        const derivedId = await promoteTable(run, artifact.id, absolute, {
          artifactName: name,
          name: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : name,
          format: format as "tsv" | "csv",
          tableKind: typeof entry.table?.tableKind === "string" ? entry.table.tableKind : null,
          roles: entry.table?.roles && typeof entry.table.roles === "object" ? (entry.table.roles as Record<string, string>) : {},
          sensitivity,
        });
        await db.exploreArtifact.update({ where: { id: artifact.id }, data: { derivedDatasetId: derivedId } });
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
  const results = {
    exitCode,
    sandbox: reported ? { used: reported.used, detail: reported.detail, planHash: isolation?.planHash ?? null, network: isolation?.network ?? null } : null,
    figures,
    tables,
    reports,
    notes: Array.isArray(manifest?.notes) ? manifest!.notes.filter((note): note is string => typeof note === "string").slice(0, 50) : [],
    metrics: manifest?.metrics && typeof manifest.metrics === "object" ? manifest.metrics : {},
    warnings,
  };
  await db.exploreAnalysisRun.updateMany({
    where: { id: run.id, status: { in: ["pending", "queued", "running"] } },
    data: {
      status: exitCode === 0 ? "completed" : "failed",
      exitCode,
      completedAt: new Date(),
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
  options: { artifactName: string; name: string; format: "tsv" | "csv"; tableKind: string | null; roles: Record<string, string>; sensitivity: ExploreSensitivity }
): Promise<string> {
  const text = await fs.readFile(filePath, "utf8");
  const parsed = parseDelimited(text, { delimiter: options.format === "csv" ? "," : "\t" });
  if (parsed.columns.length === 0) throw new Error("empty table");
  const roles: ExploreRoleMap = {};
  for (const [role, column] of Object.entries(options.roles)) {
    if (parsed.columns.includes(column)) roles[role as ExploreRole] = column;
  }
  const schema = inferSchema(parsed.rows, { roles, groups: Object.fromEntries(parsed.columns.map((key) => [key, "analysis"])) });
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
  await writeDatasetVersion({
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
  return dataset.id;
}
