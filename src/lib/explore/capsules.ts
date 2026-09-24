/**
 * Lineage and capsules of Flow outputs (FLOW-GAPS A7, D19). The lineage of an
 * output is the backward closure of the steps that led to it in the run that
 * made it. A capsule packs that slice so someone else can check it: every
 * step's code, settings and the exact tables it read (by hash only when a
 * table is not standard sensitivity), the environment spec and lock, a README
 * in words, a `reproduce` script and RO-Crate metadata (Workflow Run Crate).
 * It says "Not verified yet" until a clean-container check exists.
 */
import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { codeRegions } from "./code-regions";
import { resolveCondaExecutable } from "./environments";
import { getHelperLibDir } from "./kits/loader";
import { planOf, runRecords, type PlanEntry } from "./flow-runs";
import { resolveExploreStorage } from "./storage";
import { stepSlug } from "./variables";
import { ZipWriter } from "./zip";

const MAX_INPUT_BYTES = 200 * 1024 * 1024;

const sha256 = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");

/** The flow run an artifact belongs to: the run that executed its step, else a completed run that reused it. */
export async function flowRunOfArtifact(artifactId: string, flowRunId?: string | null) {
  const artifact = await db.exploreArtifact.findUnique({ where: { id: artifactId }, include: { run: { select: { id: true, analysisId: true, flowRunId: true, runFolder: true, revisionId: true, analysis: { select: { targetKey: true, flowId: true } } } } } });
  if (!artifact) throw flowError("not_found", "Output not found");
  let runId = flowRunId ?? artifact.run.flowRunId;
  if (!runId && artifact.run.analysis.flowId) {
    // A step run from before numbered runs, or one reused: the newest run that lists it.
    const candidates = await db.exploreFlowRun.findMany({ where: { flowId: artifact.run.analysis.flowId, status: "completed" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, plan: true } });
    runId = candidates.find((candidate) => planOf(candidate).some((entry) => entry.reusedFrom?.stepRunId === artifact.run.id))?.id ?? null;
  }
  if (!runId) throw flowError("invalid_request", "This output was not made by a numbered run of a recipe.");
  const loaded = await runRecords(runId);
  if (!loaded) throw flowError("not_found", "Run not found");
  const record = loaded.records.get(artifact.run.analysisId);
  if (!record || record.stepRunId !== artifact.run.id) throw flowError("invalid_request", "This output is not part of that run.");
  return { artifact, loaded };
}

/** The steps an output depends on in its run (its own step first), with the edges between them. */
export function lineageSlice(plan: PlanEntry[], stepId: string): { steps: PlanEntry[]; edges: Array<{ from: string; to: string }> } {
  const keep = new Set<string>([stepId]);
  const queue = [stepId];
  const edges: Array<{ from: string; to: string }> = [];
  while (queue.length) {
    const current = queue.pop()!;
    for (const dep of plan.find((entry) => entry.analysisId === current)?.dependsOn ?? []) {
      edges.push({ from: dep, to: current });
      if (!keep.has(dep)) { keep.add(dep); queue.push(dep); }
    }
  }
  return { steps: plan.filter((entry) => keep.has(entry.analysisId)), edges };
}

export async function outputLineage(flowId: string, artifactId: string, flowRunId?: string | null) {
  const { artifact, loaded } = await flowRunOfArtifact(artifactId, flowRunId);
  if (loaded.run.flowId !== flowId) throw flowError("not_found", "Output not found");
  const plan = planOf(loaded.run);
  const slice = lineageSlice(plan, artifact.run.analysisId);
  const ids = new Set(slice.steps.map((entry) => entry.analysisId));
  const produced = await db.exploreDataset.findMany({ where: { targetKey: artifact.run.analysis.targetKey, kind: "derived" }, select: { id: true, sourceConfig: true } });
  const producer = new Map(produced.map((dataset) => { try { return [dataset.id, (JSON.parse(dataset.sourceConfig ?? "{}") as { analysisId?: string; artifactName?: string })] as const; } catch { return [dataset.id, {}] as const; } }));
  const inputs = new Map<string, { datasetId: string; name: string; versionId: string; version: number | null; contentHash: string | null }>();
  const via = new Map<string, string>();
  for (const entry of slice.steps) {
    const record = loaded.records.get(entry.analysisId);
    const stepRun = record ? loaded.stepRuns.get(record.stepRunId) : undefined;
    for (const pin of (Array.isArray(stepRun?.inputPins) ? stepRun!.inputPins : []) as Array<{ alias: string; datasetId: string; versionId: string; versionNumber?: number; contentHash?: string; name?: string }>) {
      const source = producer.get(pin.datasetId);
      if (source?.analysisId && ids.has(source.analysisId)) via.set(`${source.analysisId}>${entry.analysisId}`, source.artifactName ?? pin.alias);
      else inputs.set(pin.datasetId, { datasetId: pin.datasetId, name: pin.name ?? pin.alias, versionId: pin.versionId, version: pin.versionNumber ?? null, contentHash: pin.contentHash ?? null });
    }
  }
  const revisions = await db.exploreAnalysisRevision.findMany({ where: { id: { in: slice.steps.map((entry) => entry.revisionId) } }, select: { id: true, codeHash: true } });
  return {
    artifact: { id: artifact.id, name: artifact.name, stepId: artifact.run.analysisId, runId: loaded.run.id },
    steps: slice.steps.map((entry) => ({ stepId: entry.analysisId, label: entry.label, name: entry.name, revisionId: entry.revisionId, codeHash: revisions.find((revision) => revision.id === entry.revisionId)?.codeHash || entry.codeHash })),
    inputs: [...inputs.values()],
    edges: slice.edges.map((edge) => ({ ...edge, via: via.get(`${edge.from}>${edge.to}`) ?? null })),
  };
}

/** The step code region that makes a figure, for the Figure builder. */
export async function plotSource(artifactId: string) {
  const artifact = await db.exploreArtifact.findUnique({ where: { id: artifactId }, include: { run: { select: { analysisId: true, revision: { select: { id: true, code: true } }, analysis: { select: { language: true } } } } } });
  if (!artifact) throw flowError("not_found", "Output not found");
  const code = artifact.run.revision.code;
  const lines = code.split("\n");
  const quoted = new RegExp(`["']${artifact.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  const call = /(save_figure|figure|save_plotly|ggsave|savefig)\s*\(/;
  const lineIndex = lines.findIndex((line) => call.test(line) && quoted.test(line));
  const region = lineIndex >= 0 ? codeRegions(code).find((candidate) => candidate.lineStart <= lineIndex + 1 && candidate.lineEnd >= lineIndex + 1) ?? null : null;
  return { artifactId, stepId: artifact.run.analysisId, language: artifact.run.analysis.language, revisionId: artifact.run.revision.id, code, region: region ? { lineStart: region.lineStart, lineEnd: region.lineEnd, regionHash: region.regionHash } : null };
}

// ---------------------------------------------------------------------------
// Capsules
// ---------------------------------------------------------------------------

type CapsuleRecord = Awaited<ReturnType<typeof db.exploreCapsule.findUnique>>;

export function serializeCapsule(capsule: NonNullable<CapsuleRecord>) {
  return {
    id: capsule.id, flowRunId: capsule.flowRunId, artifactId: capsule.artifactId, status: capsule.status,
    size: capsule.size === null ? null : Number(capsule.size), sha256: capsule.sha256, contents: capsule.contents,
    verifiedAt: capsule.verifiedAt?.toISOString() ?? null, verification: capsule.verification ?? null, error: capsule.error, createdAt: capsule.createdAt.toISOString(),
  };
}

export async function requestCapsule(artifactId: string, userId: string, flowRunId?: string | null) {
  const { loaded } = await flowRunOfArtifact(artifactId, flowRunId);
  if (loaded.run.kind === "trial" || loaded.run.status !== "completed") throw flowError("invalid_request", "Capsules are made from completed runs of the recipe.");
  const existing = await db.exploreCapsule.findFirst({ where: { flowRunId: loaded.run.id, artifactId, status: { in: ["building", "ready"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return { capsule: serializeCapsule(existing), created: false };
  const capsule = await db.exploreCapsule.create({ data: { flowRunId: loaded.run.id, artifactId, status: "building", createdById: userId } });
  // Built in the background; the client polls GET capsules/:id.
  void buildCapsule(capsule.id).catch((error) => console.error("[flow] capsule build failed", capsule.id, error));
  return { capsule: serializeCapsule(capsule), created: true };
}

function runCommand(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => execFile(command, args, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : stdout)));
}

async function readIfSmall(file: string): Promise<Buffer | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_INPUT_BYTES) return null;
  return fs.readFile(file);
}

async function hashFile(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r").catch(() => null);
  if (!handle) return null;
  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk as Buffer);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return hash.digest("hex");
}

async function addTree(zip: ZipWriter, contents: Array<{ path: string; size: number; sha256: string; withheld: boolean }>, source: string, prefix: string) {
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc") || entry.name === "tests") continue;
    const full = path.join(source, entry.name);
    if (entry.isDirectory()) await addTree(zip, contents, full, `${prefix}/${entry.name}`);
    else if (entry.isFile()) {
      const data = await fs.readFile(full);
      await zip.add(`${prefix}/${entry.name}`, data);
      contents.push({ path: `${prefix}/${entry.name}`, size: data.length, sha256: sha256(data), withheld: false });
    }
  }
}

export async function buildCapsule(capsuleId: string): Promise<void> {
  const capsule = await db.exploreCapsule.findUnique({ where: { id: capsuleId } });
  if (!capsule || capsule.status !== "building") return;
  const storage = await resolveExploreStorage();
  const dir = path.join(storage.baseDir, "capsules");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${capsule.id}.zip`);
  // One builder per capsule, across processes: the first to set the path builds it.
  const claimed = await db.exploreCapsule.updateMany({ where: { id: capsule.id, status: "building", path: null }, data: { path: target } });
  if (!claimed.count) return;
  const zip = new ZipWriter(target);
  const contents: Array<{ path: string; size: number; sha256: string; withheld: boolean }> = [];
  const add = async (name: string, data: Buffer | string, options: { executable?: boolean } = {}) => {
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await zip.add(name, buffer, options);
    contents.push({ path: name, size: buffer.length, sha256: sha256(buffer), withheld: false });
  };
  try {
    await zip.open();
    const { artifact, loaded } = await flowRunOfArtifact(capsule.artifactId, capsule.flowRunId);
    const run = loaded.run;
    const flow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { name: true } });
    const plan = planOf(run);
    const slice = lineageSlice(plan, artifact.run.analysisId);
    const ordered = plan.filter((entry) => slice.steps.includes(entry));
    const analyses = await db.exploreAnalysis.findMany({ where: { id: { in: ordered.map((entry) => entry.analysisId) } }, select: { id: true, name: true, purpose: true, language: true, environmentName: true, methodsSentence: true } });
    const assumptions = await db.exploreGloss.findMany({ where: { analysisId: { in: ordered.map((entry) => entry.analysisId) }, type: "assumes", state: "accepted" }, select: { analysisId: true, text: true } });

    const stepDirs: Array<{ entry: PlanEntry; dir: string; language: string; entrypoint: string; withheld: string[] }> = [];
    const inputHashes: string[] = [];
    const roCrateFiles: Array<{ id: string; kind: "input" | "output" | "code"; sha256: string; size: number }> = [];
    for (const entry of ordered) {
      const record = loaded.records.get(entry.analysisId);
      const stepRun = record ? loaded.stepRuns.get(record.stepRunId) : undefined;
      if (!stepRun?.runFolder) throw new Error(`Step ${entry.label} has no run folder to pack.`);
      const analysis = analyses.find((candidate) => candidate.id === entry.analysisId);
      const language = analysis?.language ?? entry.language;
      const entrypoint = language === "r" ? "analysis.R" : "analysis.py";
      const dirName = `steps/${entry.label}-${stepSlug(entry.name)}`;
      const code = await fs.readFile(path.join(stepRun.runFolder, entrypoint));
      await add(`${dirName}/${entrypoint}`, code);
      roCrateFiles.push({ id: `${dirName}/${entrypoint}`, kind: "code", sha256: sha256(code), size: code.length });
      for (const file of ["params.json", "inputs.json"]) {
        const data = await fs.readFile(path.join(stepRun.runFolder, file)).catch(() => null);
        if (data) await add(`${dirName}/${file}`, data);
      }
      const inputsInfo = JSON.parse((await fs.readFile(path.join(stepRun.runFolder, "inputs.json"), "utf8").catch(() => "{}")) || "{}") as { inputs?: Record<string, { path?: string; schemaPath?: string; sensitivity?: string }> };
      const withheld: string[] = [];
      for (const [alias, input] of Object.entries(inputsInfo.inputs ?? {})) {
        for (const relative of [input.path, input.schemaPath].filter((value): value is string => Boolean(value))) {
          const file = path.resolve(stepRun.runFolder, relative);
          if (!file.startsWith(`${stepRun.runFolder}${path.sep}`)) continue;
          const hash = await hashFile(file);
          if (!hash) continue;
          const name = `${dirName}/${relative}`;
          const data = (input.sensitivity ?? "standard") === "standard" ? await readIfSmall(file) : null;
          if (data) {
            await add(name, data);
            if (relative === input.path) roCrateFiles.push({ id: name, kind: "input", sha256: hash, size: data.length });
          } else {
            // Sensitive or large: listed by hash only; `reproduce` asks for the file.
            await add(`${name}.sha256`, `${hash}  ${path.posix.basename(relative)}\n`);
            contents.push({ path: name, size: 0, sha256: hash, withheld: true });
            if (relative === input.path) withheld.push(alias);
          }
          if (relative === input.path) inputHashes.push(`${hash}  ${name}`);
        }
      }
      const outputs = await db.exploreArtifact.findMany({ where: { runId: stepRun.id }, select: { path: true, checksum: true } });
      const expected = outputs.filter((output) => output.checksum).map((output) => `${output.checksum}  ${path.relative(stepRun.runFolder!, output.path).split(path.sep).join("/")}`);
      await add(`${dirName}/expected-checksums.txt`, `${expected.join("\n")}\n`);
      for (const output of outputs.filter((candidate) => candidate.checksum)) roCrateFiles.push({ id: `${dirName}/${path.relative(stepRun.runFolder!, output.path).split(path.sep).join("/")}`, kind: "output", sha256: output.checksum!, size: 0 });
      stepDirs.push({ entry, dir: dirName, language, entrypoint, withheld });
    }

    // The environment: the spec it was built from and, when conda can list it, the explicit lock.
    const environmentNames = [...new Set(ordered.map((entry) => entry.environmentName))];
    for (const name of environmentNames) {
      const environment = await db.exploreEnvironment.findUnique({ where: { name } });
      if (environment?.spec) await add(`environment/${name}.yml`, environment.spec);
      if (environment?.prefixPath) {
        const conda = await resolveCondaExecutable().catch(() => "conda");
        const lock = await runCommand(conda, ["list", "--explicit", "--md5", "-p", environment.prefixPath]);
        if (lock && lock.includes("@EXPLICIT")) await add(`environment/${name}.explicit.txt`, lock);
      }
    }
    await addTree(zip, contents, path.join(getHelperLibDir(), "python"), "helpers/python");
    await addTree(zip, contents, path.join(getHelperLibDir(), "r"), "helpers/r");
    await add("inputs.sha256", `${inputHashes.join("\n")}\n`);

    const envPin = run.environment as { label?: string; lockDigest?: string | null } | null;
    const runName = run.number !== null ? `Run #${run.number}` : `Trial ${run.trialNumber}`;
    const readme = [
      `# ${artifact.name} · ${flow?.name ?? "Flow"} · ${runName}`,
      "",
      "Not verified yet: no clean-container check has run on this capsule.",
      "",
      `Made on ${run.completedAt?.toISOString() ?? "?"} from recipe revision ${run.recipeRevision}${envPin?.label ? `, environment ${envPin.label}` : ""}.`,
      "",
      "## The recipe, in words",
      "",
      ...stepDirs.map(({ entry }) => {
        const analysis = analyses.find((candidate) => candidate.id === entry.analysisId);
        const sentence = (analysis?.methodsSentence as { text?: string } | null)?.text ?? analysis?.purpose ?? "";
        return `${entry.label}. ${entry.name}${sentence ? ` — ${sentence}` : ""}`;
      }),
      "",
      ...(assumptions.length ? ["## Assumptions", "", ...assumptions.map((gloss) => `- Step ${ordered.find((entry) => entry.analysisId === gloss.analysisId)?.label ?? "?"}: ${gloss.text}`), ""] : []),
      "## Reproduce",
      "",
      "Run `./reproduce` (bash, needs conda or mamba). It checks the input hashes, creates the environment,",
      "re-runs every step on the exact tables it read and compares the outputs with `expected-checksums.txt`.",
      ...(stepDirs.some((step) => step.withheld.length) ? ["", "Some inputs are sensitive and are listed by hash only; place the files next to their `.sha256` before running."] : []),
      "",
    ].join("\n");
    await add("README.md", readme);

    const reproduce = [
      "#!/usr/bin/env bash",
      "# Re-run this capsule's steps and compare their outputs with the recorded checksums.",
      "set -euo pipefail",
      'cd "$(dirname "$0")"',
      'hash_check() { if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "$@"; else shasum -a 256 -c "$@"; fi; }',
      'hash_list() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }',
      'CONDA="${CONDA_EXE:-$(command -v mamba || command -v conda || true)}"',
      "echo 'Checking input hashes'",
      "hash_check inputs.sha256",
      ...environmentNames.map((name) => [
        `if [ ! -d ".env-${name}" ]; then`,
        `  [ -n "$CONDA" ] || { echo "conda or mamba is needed to create the environment"; exit 1; }`,
        `  if [ -f "environment/${name}.explicit.txt" ]; then "$CONDA" create -y -p ".env-${name}" --file "environment/${name}.explicit.txt"; else "$CONDA" env create -p ".env-${name}" -f "environment/${name}.yml"; fi`,
        "fi",
      ].join("\n")),
      'export PYTHONPATH="$PWD/helpers/python" SEQDESK_EXPLORE_R_LIB="$PWD/helpers/r" R_PROFILE_USER="$PWD/helpers/r/profile.R" MPLBACKEND=Agg',
      ': > checksums.txt',
      ...stepDirs.map(({ entry, dir, language, entrypoint }) => [
        `echo 'Step ${entry.label}: ${entry.name.replace(/'/g, "")}'`,
        `rm -rf "${dir}/outputs"`,
        `".env-${entry.environmentName}/bin/${language === "r" ? "Rscript" : "python"}" "${dir}/${entrypoint}" --run-dir "$PWD/${dir}"`,
        `(cd "${dir}" && hash_check expected-checksums.txt && hash_list outputs/* | sed "s#  #  ${dir}/#") >> checksums.txt`,
      ].join("\n")),
      "echo 'All outputs match the recorded checksums. Written to checksums.txt.'",
      "",
    ].join("\n");
    await add("reproduce", reproduce, { executable: true });

    const now = new Date().toISOString();
    const graph: Array<Record<string, unknown>> = [
      { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", about: { "@id": "./" }, conformsTo: [{ "@id": "https://w3id.org/ro/crate/1.1" }, { "@id": "https://w3id.org/workflowhub/workflow-ro-crate/1.0" }] },
      { "@id": "./", "@type": "Dataset", name: `${artifact.name} · ${flow?.name ?? "Flow"} · ${runName}`, description: "A SeqDesk Flow capsule: the steps, settings, input hashes and environment behind one output.",
        datePublished: now, license: { "@id": "#license" }, mainEntity: { "@id": "reproduce" }, mentions: { "@id": "#run" },
        conformsTo: [{ "@id": "https://w3id.org/ro/wfrun/process/0.5" }, { "@id": "https://w3id.org/ro/wfrun/workflow/0.5" }, { "@id": "https://w3id.org/workflowhub/workflow-ro-crate/1.0" }],
        hasPart: [{ "@id": "reproduce" }, { "@id": "README.md" }, ...roCrateFiles.map((file) => ({ "@id": file.id }))] },
      { "@id": "#license", "@type": "CreativeWork", name: "As agreed for the study this capsule comes from" },
      { "@id": "reproduce", "@type": ["File", "SoftwareSourceCode", "ComputationalWorkflow"], name: `${flow?.name ?? "Flow"} recipe revision ${run.recipeRevision}`, programmingLanguage: { "@id": "#bash" },
        input: roCrateFiles.filter((file) => file.kind === "input").map((file) => ({ "@id": `#param-${file.id}` })), output: roCrateFiles.filter((file) => file.kind === "output").map((file) => ({ "@id": `#param-${file.id}` })) },
      { "@id": "#bash", "@type": "ComputerLanguage", name: "Bash" },
      { "@id": "#run", "@type": "CreateAction", name: runName, instrument: { "@id": "reproduce" }, startTime: run.startedAt?.toISOString(), endTime: run.completedAt?.toISOString(),
        object: roCrateFiles.filter((file) => file.kind === "input").map((file) => ({ "@id": file.id })), result: roCrateFiles.filter((file) => file.kind === "output").map((file) => ({ "@id": file.id })) },
      ...roCrateFiles.map((file) => ({ "@id": file.id, "@type": "File", sha256: file.sha256, ...(file.size ? { contentSize: String(file.size) } : {}), ...(file.kind === "output" ? { description: "Output of the run (not in the capsule; reproduce writes it)" } : {}) })),
      ...roCrateFiles.filter((file) => file.kind !== "code").map((file) => ({ "@id": `#param-${file.id}`, "@type": "FormalParameter", name: path.posix.basename(file.id), additionalType: "File" })),
      ...["process", "workflow"].map((kind) => ({ "@id": `https://w3id.org/ro/wfrun/${kind}/0.5`, "@type": "CreativeWork", name: `${kind === "process" ? "Process" : "Workflow"} Run Crate`, version: "0.5" })),
      { "@id": "https://w3id.org/workflowhub/workflow-ro-crate/1.0", "@type": "CreativeWork", name: "Workflow RO-Crate", version: "1.0" },
    ];
    await add("ro-crate-metadata.json", JSON.stringify({ "@context": "https://w3id.org/ro/crate/1.1/context", "@graph": graph }, null, 2));
    await zip.close();
    const bytes = await fs.readFile(target);
    await db.exploreCapsule.update({ where: { id: capsule.id }, data: { status: "ready", path: target, size: BigInt(bytes.length), sha256: sha256(bytes), contents } });
  } catch (error) {
    await zip.abort();
    await db.exploreCapsule.update({ where: { id: capsule.id }, data: { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } });
  }
}

/** Capsules left building by a stopped process are failed after 30 minutes. */
export async function failStaleCapsules(now = Date.now()): Promise<number> {
  const stale = await db.exploreCapsule.updateMany({ where: { status: "building", createdAt: { lt: new Date(now - 30 * 60 * 1000) } }, data: { status: "failed", error: "The capsule build stopped. Request it again." } });
  return stale.count;
}
