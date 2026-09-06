import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { writePipelineLaunchIdentity } from "@/lib/pipelines/launch-identity";
import { preparePipelineRunDirectory } from "@/lib/pipelines/run-directory";
import { allocateRunNumber, parseInputBindings, serializeRun, type RunSummary } from "./analyses";
import { fetchAllDatasetRows, getDatasetRecord } from "./datasets";
import { applyEditsToRows, listActiveEdits } from "./edits";
import { resolveReadyEnvironment } from "./environments";
import { stageHelperLibrary } from "./kits/loader";
import { parseSchema } from "./schema";
import { resolveExploreStorage } from "./storage";
import { generateInnerScript, generateLocalRunScript, generateSlurmRunScript, INNER_SCRIPT } from "./run-script";
import { prepareRunSandbox, SandboxRefusedError } from "./sandbox/prepare";
import { getSandboxSettings } from "./sandbox/settings";
import type { ExploreCell } from "./types";

export type ExecutionModeRequest = "default" | "local" | "slurm";

export interface StartRunInput {
  analysisId: string;
  revisionId?: string | null;
  executionMode?: ExecutionModeRequest;
  createdById: string;
}

export class ExploreRunError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function tsvEscape(value: ExploreCell): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]/g, " ");
}

/**
 * Stage one dataset version into the run folder as TSV plus schema. Curation
 * edits are applied so analyses see the curated data; excluded rows are gone.
 */
async function stageInput(runFolder: string, alias: string, datasetId: string, versionId: string | null) {
  const dataset = await getDatasetRecord(datasetId);
  if (!dataset) throw new ExploreRunError(400, `Dataset ${datasetId} for input ${alias} no longer exists`);
  const version = versionId
    ? await db.exploreDatasetVersion.findFirst({ where: { id: versionId, datasetId } })
    : dataset.currentVersionId
      ? await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId } })
      : dataset.versions[0] ?? null;
  if (!version) throw new ExploreRunError(400, `Dataset ${dataset.name} has no version to run on`);

  const schema = parseSchema(version.schema);
  const edits = await listActiveEdits(datasetId);
  const rows = applyEditsToRows(await fetchAllDatasetRows(version.id), edits);
  const columns = schema.columns.map((column) => column.key);
  const lines = [columns.join("\t")];
  for (const row of rows) lines.push(columns.map((key) => tsvEscape(row.data[key] ?? null)).join("\t"));

  const inputsDir = path.join(runFolder, "inputs");
  await fs.mkdir(inputsDir, { recursive: true });
  const relativePath = path.posix.join("inputs", `${alias}.tsv`);
  const relativeSchemaPath = path.posix.join("inputs", `${alias}.schema.json`);
  await fs.writeFile(path.join(runFolder, relativePath), `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(
    path.join(runFolder, relativeSchemaPath),
    JSON.stringify({ schema, provenance: JSON.parse(version.provenance), contentHash: version.contentHash, editCount: edits.length }, null, 2),
    "utf8"
  );

  const roles = dataset.roles ? (JSON.parse(dataset.roles) as Record<string, string>) : {};
  return {
    path: relativePath,
    schemaPath: relativeSchemaPath,
    tableKind: dataset.tableKind,
    roles,
    datasetId: dataset.id,
    versionId: version.id,
    versionNumber: version.number,
    rowCount: rows.length,
    name: dataset.name,
    sensitivity: dataset.sensitivity,
  };
}

async function curationForTarget(targetKey: string) {
  const lists = await db.exploreCurationList.findMany({ where: { targetKey }, orderBy: { listId: "asc" } });
  return {
    lists: lists.map((list) => ({
      listId: list.listId,
      label: list.label,
      role: list.role,
      site: list.site,
      tier: list.tier,
      color: list.color,
      entries: (() => {
        try {
          const parsed = JSON.parse(list.entries) as Array<{ name?: string } | string>;
          return parsed.map((entry) => (typeof entry === "string" ? entry : entry.name ?? "")).filter(Boolean);
        } catch {
          return [];
        }
      })(),
    })),
  };
}

/**
 * Create a run record, prepare its folder (inputs, params, code, wrapper) and
 * launch it locally or through SLURM. Any failure before launch marks the run
 * failed with the reason so nothing is left half-prepared.
 */
export async function createAndStartRun(input: StartRunInput): Promise<RunSummary> {
  const analysis = await db.exploreAnalysis.findUnique({
    where: { id: input.analysisId },
    include: { revisions: { orderBy: { number: "desc" } } },
  });
  if (!analysis) throw new ExploreRunError(404, "Analysis not found");
  const revision = input.revisionId
    ? analysis.revisions.find((entry) => entry.id === input.revisionId)
    : analysis.revisions.find((entry) => entry.id === analysis.currentRevisionId) ?? analysis.revisions[0];
  if (!revision) throw new ExploreRunError(400, "The analysis has no revision to run");

  const environment = await resolveReadyEnvironment(analysis.environmentName);
  if (!environment) {
    throw new ExploreRunError(409, `Environment ${analysis.environmentName} is not built yet. A facility admin can build it under Explore environments.`);
  }

  // One run of an analysis at a time: two would write the same output tables.
  const active = await db.exploreAnalysisRun.findFirst({ where: { analysisId: analysis.id, status: { in: ["pending", "queued", "running"] } }, select: { runNumber: true } });
  if (active) throw new ExploreRunError(409, `Run ${active.runNumber} of this analysis is still active. Wait for it or stop it first.`);

  const settings = await getExecutionSettings();
  const mode: "local" | "slurm" =
    input.executionMode === "local" || input.executionMode === "slurm" ? input.executionMode : settings.useSlurm ? "slurm" : "local";

  const runNumber = await allocateRunNumber();
  const run = await db.exploreAnalysisRun.create({
    data: {
      analysisId: analysis.id,
      revisionId: revision.id,
      runNumber,
      status: "pending",
      executionMode: mode,
      createdById: input.createdById,
    },
  });

  try {
    const storage = await resolveExploreStorage();
    const runFolder = await preparePipelineRunDirectory(storage.runsRoot, runNumber, run.id);
    await fs.mkdir(path.join(runFolder, "outputs"), { recursive: true });

    const bindings = parseInputBindings(revision.inputs);
    const staged: Record<string, Awaited<ReturnType<typeof stageInput>>> = {};
    for (const binding of bindings) {
      staged[binding.alias] = await stageInput(runFolder, binding.alias, binding.datasetId, binding.versionId);
    }
    const params = JSON.parse(revision.params || "{}") as Record<string, unknown>;
    const inputsJson = {
      inputs: staged,
      params,
      outputDir: "outputs",
      run: { id: run.id, runNumber, analysisId: analysis.id, analysisName: analysis.name, revision: revision.number },
      curation: await curationForTarget(analysis.targetKey),
    };
    await fs.writeFile(path.join(runFolder, "inputs.json"), JSON.stringify(inputsJson, null, 2), "utf8");
    await fs.writeFile(path.join(runFolder, "params.json"), JSON.stringify(params, null, 2), "utf8");
    const entrypoint = analysis.language === "r" ? "analysis.R" : "analysis.py";
    await fs.writeFile(path.join(runFolder, entrypoint), revision.code, "utf8");
    // The helper library travels with the run: SLURM nodes only share the run
    // directory, and the copy records which helper version the run used.
    const helperLibDir = await stageHelperLibrary(runFolder);

    // The mount plan is written first: the wrapper is generated from it, and
    // the run page shows it from the moment the run exists.
    const sandboxSettings = await getSandboxSettings();
    let sandbox;
    try {
      sandbox = (await prepareRunSandbox({ runFolder, environmentPrefix: environment.prefixPath, settings: sandboxSettings })).sandbox;
    } catch (error) {
      if (error instanceof SandboxRefusedError) throw new ExploreRunError(409, error.message);
      throw error;
    }

    const scriptOptions = {
      runId: run.id,
      runFolder,
      language: analysis.language as "python" | "r",
      entrypoint,
      environmentPrefix: environment.prefixPath,
      condaPath: settings.condaPath,
      helperLibDir,
      slurm: settings,
      sandbox,
      timeLimitHours: sandboxSettings.localTimeLimitHours,
    };
    const innerPath = path.join(runFolder, INNER_SCRIPT);
    await fs.mkdir(path.dirname(innerPath), { recursive: true });
    await fs.writeFile(innerPath, generateInnerScript(scriptOptions), "utf8");
    await fs.chmod(innerPath, 0o755);
    const script = mode === "slurm" ? generateSlurmRunScript(scriptOptions) : generateLocalRunScript(scriptOptions);
    const scriptPath = path.join(runFolder, "run.sh");
    await fs.writeFile(scriptPath, script, "utf8");
    await fs.chmod(scriptPath, 0o755);

    let queueJobId: string;
    if (mode === "slurm") {
      queueJobId = await submitSbatch(scriptPath, runFolder);
      await writePipelineLaunchIdentity({ runFolder, runId: run.id, kind: "slurm", numericId: queueJobId });
      await db.exploreAnalysisRun.update({
        where: { id: run.id },
        data: { status: "queued", runFolder, queueJobId, queuedAt: new Date() },
      });
    } else {
      const child = spawn("bash", [scriptPath], { cwd: runFolder, detached: true, stdio: "ignore" });
      child.unref();
      if (!child.pid) throw new Error("The analysis process could not be started");
      queueJobId = `local-${child.pid}`;
      await writePipelineLaunchIdentity({ runFolder, runId: run.id, kind: "local", numericId: String(child.pid) });
      await db.exploreAnalysisRun.update({
        where: { id: run.id },
        data: { status: "running", runFolder, queueJobId, queuedAt: new Date(), startedAt: new Date() },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.exploreAnalysisRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date(), errorTail: message.slice(0, 4000), results: JSON.stringify({ error: message }) },
    });
    if (error instanceof ExploreRunError) throw error;
    throw new ExploreRunError(500, message);
  }

  const record = await db.exploreAnalysisRun.findUnique({
    where: { id: run.id },
    include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } } },
  });
  if (!record) throw new ExploreRunError(500, "Run vanished after launch");
  return serializeRun(record);
}

function submitSbatch(scriptPath: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sbatch", ["--parsable", scriptPath], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(new Error(`sbatch could not be started: ${error.message}`)));
    child.on("close", (code) => {
      const jobId = stdout.trim().split(/[;\n]/)[0]?.trim() ?? "";
      if (code === 0 && /^\d+$/.test(jobId)) resolve(jobId);
      else reject(new Error(`sbatch failed (${code}): ${stderr.trim() || stdout.trim() || "no output"}`));
    });
  });
}

/** Stop a run: kill the local process group or scancel the SLURM job. */
export async function cancelRun(runId: string): Promise<boolean> {
  const run = await db.exploreAnalysisRun.findUnique({ where: { id: runId } });
  if (!run || !["pending", "queued", "running"].includes(run.status)) return false;
  const jobId = run.queueJobId ?? "";
  if (jobId.startsWith("local-")) {
    const pid = Number.parseInt(jobId.slice("local-".length), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    }
  } else if (jobId) {
    await new Promise<void>((resolve) => {
      const child = spawn("scancel", [jobId]);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
  await db.exploreAnalysisRun.update({
    where: { id: runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
  return true;
}
