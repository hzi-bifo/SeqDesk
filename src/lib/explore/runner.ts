import { inputToken } from "./input-token";
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
import { condaErrorExcerpt, prepareStepEnvironment, preparingWords, resolveStepEnvironment, stepEnvironmentByName, prepareEnvironmentByName } from "./step-environments";
import { getKit, stageHelperLibrary } from "./kits/loader";
import { inputContractSnapshot, validateAnalysisInputs } from "./input-validation";
import { parseSchema } from "./schema";
import { resolveExploreStorage } from "./storage";
import { generateInnerScript, generateLocalRunScript, generateSlurmRunScript, INNER_SCRIPT, type ContinualfigMode } from "./run-script";
import { pinEnvironment } from "./environment-lock";
import { prepareRunSandbox, SandboxRefusedError } from "./sandbox/prepare";
import { getSandboxSettings } from "./sandbox/settings";
import type { ExploreCell } from "./types";
import { parseStoredFileBindings } from "@/lib/files/library-types";
import { stageLibraryFileInputs } from "@/lib/files/library";

export type ExecutionModeRequest = "default" | "local" | "slurm";

export interface StartRunInput {
  analysisId: string;
  revisionId?: string | null;
  executionMode?: ExecutionModeRequest;
  createdById: string;
  /** Stable identity for guided and integration requests; validated at the boundary. */
  runId?: string;
  inputTokens?: Record<string, string>;
  /** The numbered flow run this step run belongs to, with the step's label in it. */
  flowRun?: {
    id: string;
    stepLabel: string;
    trial: boolean;
    /** Trial runs: keep the first N samples (by the sample role) of tables no step of the run wrote. */
    sample?: number;
    /** Trial runs: inputs read from an upstream trial step's output file instead of the database. */
    fileInputs?: Record<string, { path: string; artifactId: string; name: string }>;
    environmentDigest?: string | null;
    /** The step's effective environment, fixed when the flow run started (a base, or `<base>+<key>`). */
    environmentName?: string;
    /** Figure trials: the proposed code, run instead of the revision's (the revision and recipe stay as they are). */
    codeOverride?: string;
    /** The figure hook for this run; flow steps record figure records by default. */
    continualfig?: ContinualfigMode;
  };
}

/** Rows a trial keeps when a table has no sample role. */
export const TRIAL_ROW_LIMIT = 2000;

/** The rows a trial run sees: the first `samples` samples, or the first rows when there is no sample role. */
export function trialRows<T extends { data: Record<string, ExploreCell> }>(rows: T[], sampleColumn: string | null, samples: number): T[] {
  if (!sampleColumn) return rows.slice(0, TRIAL_ROW_LIMIT);
  const kept = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const value = row.data[sampleColumn];
    const key = value === null || value === undefined ? "" : String(value);
    if (!kept.has(key)) {
      if (kept.size >= samples) continue;
      kept.add(key);
    }
    out.push(row);
  }
  return out;
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
async function stageInput(runFolder: string, alias: string, datasetId: string, versionId: string | null, expectedToken?: string, trialSamples?: number) {
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
  if (expectedToken && inputToken(version.id, edits) !== expectedToken) throw new ExploreRunError(409, "The input data changed. Review it before running again.");
  const roles = dataset.roles ? (JSON.parse(dataset.roles) as Record<string, string>) : {};
  const allRows = applyEditsToRows(await fetchAllDatasetRows(version.id), edits);
  const rows = trialSamples ? trialRows(allRows, roles.sample ?? null, trialSamples) : allRows;
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

  return {
    path: relativePath,
    schemaPath: relativeSchemaPath,
    tableKind: dataset.tableKind,
    roles,
    datasetId: dataset.id,
    versionId: version.id,
    versionNumber: version.number,
    contentHash: version.contentHash,
    rowCount: rows.length,
    name: dataset.name,
    sensitivity: dataset.sensitivity,
  };
}

/** Stage an upstream trial step's output file as an input: trials never write tables to the database. */
async function stageTrialFileInput(runFolder: string, alias: string, source: { path: string; artifactId: string; name: string }, datasetId: string) {
  const inputsDir = path.join(runFolder, "inputs");
  await fs.mkdir(inputsDir, { recursive: true });
  const text = await fs.readFile(source.path, "utf8");
  const relativePath = path.posix.join("inputs", `${alias}.tsv`);
  const relativeSchemaPath = path.posix.join("inputs", `${alias}.schema.json`);
  await fs.writeFile(path.join(runFolder, relativePath), text, "utf8");
  const dataset = await getDatasetRecord(datasetId);
  const version = dataset?.currentVersionId ? await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId } }) : null;
  const header = (text.split("\n", 1)[0] ?? "").split("\t").filter(Boolean);
  // The table's known schema when it has one, else every column as text.
  const known = version ? parseSchema(version.schema) : null;
  const schema = known && header.every((key) => known.columns.some((column) => column.key === key))
    ? known
    : { columns: header.map((key) => ({ key, label: key, type: "string" })) };
  await fs.writeFile(path.join(runFolder, relativeSchemaPath), JSON.stringify({ schema, provenance: { builder: "trial", sources: [{ type: "artifact", id: source.artifactId, label: source.name }] }, contentHash: null, editCount: 0 }, null, 2), "utf8");
  const roles = dataset?.roles ? (JSON.parse(dataset.roles) as Record<string, string>) : {};
  return {
    path: relativePath, schemaPath: relativeSchemaPath, tableKind: dataset?.tableKind ?? null, roles, datasetId, versionId: null as string | null, versionNumber: null as number | null,
    contentHash: null as string | null, rowCount: Math.max(0, text.split("\n").filter(Boolean).length - 1), name: source.name, sensitivity: dataset?.sensitivity ?? "standard",
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
  const existingRequest = async () => {
    if (!input.runId) return null;
    const existing = await db.exploreAnalysisRun.findUnique({ where: { id: input.runId }, include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } } } });
    if (!existing) return null;
    if (existing.analysisId !== input.analysisId || existing.createdById !== input.createdById || (input.revisionId && existing.revisionId !== input.revisionId)) throw new ExploreRunError(409, "This generation request belongs to another analysis.");
    return serializeRun(existing);
  };
  const previous = await existingRequest();
  if (previous) return previous;
  const analysis = await db.exploreAnalysis.findUnique({
    where: { id: input.analysisId },
    include: { revisions: { orderBy: { number: "desc" } } },
  });
  if (!analysis) throw new ExploreRunError(404, "Analysis not found");
  const revision = input.revisionId
    ? analysis.revisions.find((entry) => entry.id === input.revisionId)
    : analysis.revisions.find((entry) => entry.id === analysis.currentRevisionId) ?? analysis.revisions[0];
  if (!revision) throw new ExploreRunError(400, "The analysis has no revision to run");

  let bindings: Awaited<ReturnType<typeof validateAnalysisInputs>>;
  const trialFiles = input.flowRun?.fileInputs ?? {};
  try {
    const contract = inputContractSnapshot(revision.inputs) ?? (analysis.kitId ? (await getKit(analysis.kitId))?.manifest.inputs ?? null : null);
    const declared = parseInputBindings(revision.inputs);
    // Trial inputs that come from an upstream trial step are staged from its file; the rest are validated as usual.
    const validated = await validateAnalysisInputs(analysis.targetKey, declared.filter((binding) => !trialFiles[binding.alias]), trialFiles && Object.keys(trialFiles).length ? null : contract);
    bindings = declared.map((binding) => validated.find((entry) => entry.alias === binding.alias) ?? binding);
  } catch (error) {
    throw new ExploreRunError(400, error instanceof Error ? error.message : "Input validation failed.");
  }

  // The step's effective environment: its base, or the base plus the step's packages (built once, then reused).
  // A flow run fixes it when the run starts, so an edit to the packages mid-run does not change a queued step.
  const stepEnvironment = (input.flowRun?.environmentName ? await stepEnvironmentByName(input.flowRun.environmentName) : null) ?? await resolveStepEnvironment(analysis);
  if (stepEnvironment.derived && stepEnvironment.status !== "ready") {
    // Runs never install packages: start (or keep) the build and ask the caller to come back when it is ready.
    const prepared = stepEnvironment.status === "failed" ? stepEnvironment : input.flowRun?.environmentName ? (await prepareEnvironmentByName(stepEnvironment.name)) ?? stepEnvironment : await prepareStepEnvironment(analysis);
    if (prepared.status === "failed") throw new ExploreRunError(409, `Could not build the environment for this step (${prepared.name}).\n${condaErrorExcerpt(prepared.error ?? prepared.log ?? "")}`.trim());
    if (prepared.status !== "ready") throw new ExploreRunError(409, `${preparingWords(prepared)}. The run can start when the environment is ready.`);
  }
  const environmentName = stepEnvironment.name;
  const environment = await resolveReadyEnvironment(environmentName);
  if (!environment) {
    throw new ExploreRunError(409, `Environment ${environmentName} is not built yet. A facility admin can build it under Explore environments.`);
  }

  // One run of an analysis at a time: two would write the same output tables.
  const active = await db.exploreAnalysisRun.findFirst({ where: { analysisId: analysis.id, status: { in: ["pending", "queued", "running"] } }, select: { runNumber: true } });
  if (active) {
    const repeated = await existingRequest();
    if (repeated) return repeated;
    throw new ExploreRunError(409, `Run ${active.runNumber} of this analysis is still active. Wait for it or stop it first.`);
  }

  const settings = await getExecutionSettings();
  const mode: "local" | "slurm" =
    input.executionMode === "local" || input.executionMode === "slurm" ? input.executionMode : settings.useSlurm ? "slurm" : "local";

  const allocate = async () => db.exploreAnalysisRun.create({
    data: {
      ...(input.runId ? { id: input.runId } : {}),
      analysisId: analysis.id,
      revisionId: revision.id,
      runNumber: await allocateRunNumber(),
      status: "pending",
      executionMode: mode,
      createdById: input.createdById,
      ...(input.flowRun ? { flowRunId: input.flowRun.id, stepLabel: input.flowRun.stepLabel, trial: input.flowRun.trial, environmentDigest: input.flowRun.environmentDigest ?? null } : {}),
    },
  });
  let run;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { run = await allocate(); break; } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      const repeated = await existingRequest();
      if (repeated) return repeated;
      if (attempt === 2) throw new ExploreRunError(409, "Another run started at the same time. Try again.");
    }
  }
  if (!run) throw new ExploreRunError(500, "Could not allocate a run.");
  const runNumber = run.runNumber;

  try {
    const storage = await resolveExploreStorage();
    const runFolder = await preparePipelineRunDirectory(storage.runsRoot, runNumber, run.id);
    await fs.mkdir(path.join(runFolder, "outputs"), { recursive: true });

    const staged: Record<string, Awaited<ReturnType<typeof stageInput>> | Awaited<ReturnType<typeof stageTrialFileInput>>> = {};
    for (const binding of bindings) {
      const trialFile = trialFiles[binding.alias];
      staged[binding.alias] = trialFile
        ? await stageTrialFileInput(runFolder, binding.alias, trialFile, binding.datasetId)
        : await stageInput(runFolder, binding.alias, binding.datasetId, binding.versionId, input.inputTokens?.[binding.datasetId], input.flowRun?.trial ? input.flowRun.sample ?? 2 : undefined);
    }
    // What the step read, pinned on the step run (and so on its flow run).
    const inputPins = Object.entries(staged).map(([alias, entry]) => ({ alias, datasetId: entry.datasetId, versionId: entry.versionId, versionNumber: entry.versionNumber, contentHash: entry.contentHash, name: entry.name, rowCount: entry.rowCount }));
    await db.exploreAnalysisRun.update({ where: { id: run.id }, data: { inputPins } });
    const params = JSON.parse(revision.params || "{}") as Record<string, unknown>;
    const inputsJson = {
      inputs: staged,
      files: await stageLibraryFileInputs(runFolder, analysis.targetKey, parseStoredFileBindings(revision.fileInputs)),
      params,
      outputDir: "outputs",
      run: { id: run.id, runNumber, analysisId: analysis.id, analysisName: analysis.name, revision: revision.number, ...(input.flowRun ? { flowRunId: input.flowRun.id, stepLabel: input.flowRun.stepLabel, trial: input.flowRun.trial } : {}) },
      curation: await curationForTarget(analysis.targetKey),
    };
    await fs.writeFile(path.join(runFolder, "inputs.json"), JSON.stringify(inputsJson, null, 2), "utf8");
    await fs.writeFile(path.join(runFolder, "params.json"), JSON.stringify(params, null, 2), "utf8");
    // Which environment the step ran in: the base, or the base plus the step's packages.
    await fs.writeFile(path.join(runFolder, "environment.json"), JSON.stringify({ name: environmentName, base: stepEnvironment.baseName, specHash: environment.specHash, packages: stepEnvironment.packages, lockDigest: stepEnvironment.lockDigest ?? (await pinEnvironment(environmentName, analysis.language).catch(() => null))?.lockDigest ?? null }, null, 2), "utf8");
    const entrypoint = analysis.language === "r" ? "analysis.R" : analysis.language === "shell" ? "step.sh" : "analysis.py";
    await fs.writeFile(path.join(runFolder, entrypoint), input.flowRun?.codeOverride ?? revision.code, "utf8");
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
      if (error instanceof Error && error.message.startsWith("Invalid mount plan")) throw new ExploreRunError(409, `The sandbox settings do not fit this installation: ${error.message}`);
      throw error;
    }

    const scriptOptions = {
      runId: run.id,
      runFolder,
      language: analysis.language as "python" | "r" | "shell",
      entrypoint,
      environmentPrefix: environment.prefixPath,
      condaPath: settings.condaPath,
      helperLibDir,
      slurm: settings,
      sandbox,
      timeLimitHours: sandboxSettings.localTimeLimitHours,
      continualfig: (input.flowRun ? input.flowRun.continualfig ?? "record" : "off") as ContinualfigMode,
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
