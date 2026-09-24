/**
 * Named values of a flow's runs, for Writer placeholders, peeks and findings
 * (FLOW-GAPS A6 "Values feed"). A value is what a step recorded with
 * `metric(key, value, label=, unit=)`, addressed as
 * `labdesk://value/<flowRunId>/<stepId>/<key>`. "Verified" means the value is
 * read back from the stored run record and, when asked, the step's output
 * files still have the checksums the run recorded (D16).
 */
import crypto from "crypto";
import fs from "fs";
import { db } from "@/lib/db";
import { flowError, parseValueRef } from "@/lib/integration/flow-contract";
import { getKit } from "./kits/loader";
import { loadRecipe } from "./recipe";
import { planOf, runRecords, stepValues } from "./flow-runs";
import { resolveContainedPath } from "./storage";

export interface FeedValue {
  key: string;
  ref: string;
  stepId: string;
  stepLabel: string;
  metric: string;
  label: string;
  unit: string | null;
  value: unknown;
  runId: string;
  runNumber: number | null;
  output: null;
  verified: boolean;
}

export async function flowValues(flowId: string, options: { run?: string | null; planned?: boolean }) {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { currentRunId: true } });
  if (!flow) throw flowError("not_found", "Flow not found");
  const runId = !options.run || options.run === "current" ? flow.currentRunId : options.run;
  const loaded = runId ? await runRecords(runId) : null;
  if (options.run && options.run !== "current" && (!loaded || loaded.run.flowId !== flowId)) throw flowError("not_found", "Run not found");
  const values: FeedValue[] = [];
  const withValues = new Set<string>();
  if (loaded) {
    for (const entry of planOf(loaded.run)) {
      const record = loaded.records.get(entry.analysisId);
      const stepRun = record ? loaded.stepRuns.get(record.stepRunId) : undefined;
      for (const value of stepValues(stepRun?.results)) {
        withValues.add(`${entry.analysisId}.${value.key}`);
        values.push({
          key: `${entry.analysisId}.${value.key}`, ref: `labdesk://value/${loaded.run.id}/${entry.analysisId}/${encodeURIComponent(value.key)}`, stepId: entry.analysisId, stepLabel: entry.label,
          metric: value.key, label: value.label, unit: value.unit, value: value.value, runId: loaded.run.id, runNumber: loaded.run.number, output: null,
          verified: loaded.run.status === "completed" && record?.status === "completed",
        });
      }
    }
  }
  const planned: Array<{ stepId: string; stepLabel: string; key: string; label: string; kind: "value" | "table" | "figure"; state: string }> = [];
  if (options.planned) {
    const model = await loadRecipe(flowId);
    for (const step of model?.steps ?? []) {
      const label = model!.labels.get(step.id) ?? "?";
      const ran = loaded?.records.get(step.id)?.status === "completed";
      const kit = step.kitId ? await getKit(step.kitId).catch(() => null) : null;
      for (const metric of kit?.manifest.report?.metrics ?? []) {
        if (!withValues.has(`${step.id}.${metric.key}`)) planned.push({ stepId: step.id, stepLabel: label, key: `${step.id}.${metric.key}`, label: metric.label, kind: "value", state: ran ? "notRecorded" : "notRun" });
      }
      if (ran) continue;
      for (const output of kit?.manifest.outputs ?? []) {
        if (output.kind === "report") continue;
        planned.push({ stepId: step.id, stepLabel: label, key: `${step.id}.${output.name}`, label: output.label ?? output.name, kind: output.kind, state: "notRun" });
      }
      for (const dataset of model!.datasets.values()) {
        if (dataset.producer === step.id && dataset.artifactName && !planned.some((entry) => entry.key === `${step.id}.${dataset.artifactName}`)) {
          planned.push({ stepId: step.id, stepLabel: label, key: `${step.id}.${dataset.artifactName}`, label: dataset.artifactName, kind: "table", state: "notRun" });
        }
      }
    }
  }
  return { run: loaded ? { id: loaded.run.id, number: loaded.run.number } : null, values, planned };
}

function sha256File(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => resolve(null));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** The step run's output files still match the checksums recorded when it finished. */
export async function artifactsIntact(stepRunId: string): Promise<boolean> {
  const stepRun = await db.exploreAnalysisRun.findUnique({ where: { id: stepRunId }, select: { runFolder: true, artifacts: { select: { path: true, checksum: true } } } });
  if (!stepRun?.runFolder) return false;
  for (const artifact of stepRun.artifacts) {
    if (!artifact.checksum) continue;
    const filePath = await resolveContainedPath(stepRun.runFolder, artifact.path).catch(() => null);
    if (!filePath || (await sha256File(filePath)) !== artifact.checksum) return false;
  }
  return true;
}

/**
 * Resolve value references. `canRead(flow)` decides access per flow; a
 * reference the caller cannot read is reported as unknown, like a missing one.
 */
export async function resolveValues(refs: string[], canRead: (flow: { id: string; targetKey: string }) => Promise<boolean>, options: { verify?: boolean } = {}) {
  const values: Array<FeedValue & { flowId: string; flowName: string; current: boolean; at: string | null }> = [];
  const unknown: string[] = [];
  const runs = new Map<string, Awaited<ReturnType<typeof runRecords>>>();
  const flows = new Map<string, { id: string; name: string; targetKey: string; currentRunId: string | null; readable: boolean }>();
  for (const ref of refs) {
    const parsed = parseValueRef(ref);
    if (!parsed) { unknown.push(ref); continue; }
    if (!runs.has(parsed.runId)) runs.set(parsed.runId, await runRecords(parsed.runId));
    const loaded = runs.get(parsed.runId);
    if (!loaded || loaded.run.kind === "trial") { unknown.push(ref); continue; }
    if (!flows.has(loaded.run.flowId)) {
      const flow = await db.exploreFlow.findUnique({ where: { id: loaded.run.flowId }, select: { id: true, name: true, targetKey: true, currentRunId: true } });
      flows.set(loaded.run.flowId, flow ? { ...flow, readable: await canRead(flow).catch(() => false) } : { id: loaded.run.flowId, name: "", targetKey: "", currentRunId: null, readable: false });
    }
    const flow = flows.get(loaded.run.flowId)!;
    const entry = planOf(loaded.run).find((candidate) => candidate.analysisId === parsed.analysisId);
    const record = loaded.records.get(parsed.analysisId);
    const stepRun = record ? loaded.stepRuns.get(record.stepRunId) : undefined;
    const value = stepValues(stepRun?.results).find((candidate) => candidate.key === parsed.key);
    if (!flow.readable || !entry || !record || !value) { unknown.push(ref); continue; }
    let verified = loaded.run.status === "completed" && record.status === "completed";
    if (verified && options.verify) verified = await artifactsIntact(record.stepRunId);
    values.push({
      key: `${parsed.analysisId}.${parsed.key}`, ref, stepId: parsed.analysisId, stepLabel: entry.label, metric: parsed.key, label: value.label, unit: value.unit, value: value.value,
      runId: loaded.run.id, runNumber: loaded.run.number, output: null, verified, flowId: flow.id, flowName: flow.name, current: flow.currentRunId === loaded.run.id,
      at: loaded.run.completedAt?.toISOString() ?? null,
    });
  }
  return { values, unknown };
}
