/**
 * Lineage, plot source and capsules against a real PostgreSQL database and
 * real run folders on disk (see flow-runs.live.test.ts for
 * SEQDESK_FLOW_DATABASE_URL).
 */
import { spawnSync } from "child_process";
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import unzipper from "unzipper";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SEQDESK_FLOW_DATABASE_URL;
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: process.env.SEQDESK_FLOW_DATABASE_URL || "postgresql://invalid@127.0.0.1:1/none" }) };
});
vi.mock("./storage", async () => ({ ...(await vi.importActual<object>("./storage")), resolveExploreStorage: async () => ({ baseDir: state.root, datasetsRoot: state.root, importsRoot: state.root, runsRoot: state.root }) }));
vi.mock("./environments", () => ({ resolveCondaExecutable: vi.fn().mockResolvedValue("/nonexistent/conda") }));

import { db } from "@/lib/db";
import { createAnalysis } from "./analyses";
import { buildCapsule, outputLineage, plotSource, requestCapsule } from "./capsules";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:capsuletest-${suffix}`;
let userId = "";
let flowId = "";
let figureId = "";
let tableId = "";
const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const PLOT = "import seqdesk_explore as sx\n\nkept = sx.input('kept')\n\nfig = make(kept)\nsx.figure('volcano', fig)\nsx.finish()\n";

async function stepFolder(name: string, code: string, inputs: Record<string, { text: string; sensitivity: string }>, outputs: Record<string, string>) {
  const folder = path.join(state.root, "runs", name);
  await fs.mkdir(path.join(folder, "inputs"), { recursive: true });
  await fs.mkdir(path.join(folder, "outputs"), { recursive: true });
  await fs.writeFile(path.join(folder, "analysis.py"), code);
  await fs.writeFile(path.join(folder, "params.json"), "{}");
  const document: Record<string, unknown> = {};
  for (const [alias, input] of Object.entries(inputs)) {
    await fs.writeFile(path.join(folder, "inputs", `${alias}.tsv`), input.text);
    await fs.writeFile(path.join(folder, "inputs", `${alias}.schema.json`), "{\"schema\":{\"columns\":[]}}");
    document[alias] = { path: `inputs/${alias}.tsv`, schemaPath: `inputs/${alias}.schema.json`, sensitivity: input.sensitivity };
  }
  await fs.writeFile(path.join(folder, "inputs.json"), JSON.stringify({ inputs: document, params: {}, outputDir: "outputs" }));
  for (const [file, text] of Object.entries(outputs)) await fs.writeFile(path.join(folder, "outputs", file), text);
  return folder;
}

describe.skipIf(!url)("lineage and capsules (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) throw new Error("Use a local flow check database");
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-test-"));
    userId = (await db.user.create({ data: { email: `capsuletest-${suffix}@example.invalid`, password: "!disabled", firstName: "C", lastName: "T", isActive: false } })).id;
    flowId = (await db.exploreFlow.create({ data: { targetKey, name: "Differential expression", createdById: userId } })).id;
    await db.exploreEnvironment.upsert({ where: { name: `capsule-env-${suffix}` }, update: {}, create: { name: `capsule-env-${suffix}`, spec: "name: x\ndependencies:\n  - python=3.11\n", specHash: "h", status: "ready", prefixPath: "/nonexistent" } });
    const counts = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId, sensitivity: "pseudonymous" } });
    const filter = await createAnalysis({ targetKey, flowId, name: "Filter", code: "filter code\n", environmentName: `capsule-env-${suffix}`, inputs: [{ alias: "counts", datasetId: counts.id, versionId: null }], createdById: userId });
    const kept = await db.exploreDataset.create({ data: { targetKey, kind: "derived", name: "kept", createdById: userId, sourceConfig: JSON.stringify({ analysisId: filter.id, artifactName: "kept" }) } });
    const plot = await createAnalysis({ targetKey, flowId, name: "Volcano plot", code: PLOT, environmentName: `capsule-env-${suffix}`, inputs: [{ alias: "kept", datasetId: kept.id, versionId: null }], createdById: userId });
    await db.exploreAnalysis.update({ where: { id: plot.id }, data: { methodsSentence: { text: "A volcano plot shows fold change against significance." } } });
    const plan = [
      { analysisId: filter.id, label: "1", name: "Filter", revisionId: filter.currentRevision!.id, codeHash: "a", environmentName: `capsule-env-${suffix}`, language: "python", execute: true, dependsOn: [], reusedFrom: null },
      { analysisId: plot.id, label: "2", name: "Volcano plot", revisionId: plot.currentRevision!.id, codeHash: "b", environmentName: `capsule-env-${suffix}`, language: "python", execute: true, dependsOn: [filter.id], reusedFrom: null },
    ];
    const run = await db.exploreFlowRun.create({ data: { flowId, number: 1, kind: "full", status: "completed", startedById: userId, plan, recipeRevision: 2, completedAt: new Date(), startedAt: new Date(), environment: { label: "Python 3.11 · lock 5c1e9a" } } });
    const filterFolder = await stepFolder(`filter-${suffix}`, "filter code\n", { counts: { text: "gene\tc1\ng1\t5\n", sensitivity: "pseudonymous" } }, { "kept.tsv": "gene\tc1\ng1\t5\n" });
    const plotFolder = await stepFolder(`plot-${suffix}`, PLOT, { kept: { text: "gene\tc1\ng1\t5\n", sensitivity: "standard" } }, { "volcano.png": "PNG" });
    const filterRun = await db.exploreAnalysisRun.create({ data: { analysisId: filter.id, revisionId: filter.currentRevision!.id, runNumber: `EXP-CAP-${suffix}-1`, status: "completed", runFolder: filterFolder, createdById: userId, flowRunId: run.id, inputPins: [{ alias: "counts", datasetId: counts.id, versionId: "v1", versionNumber: 1, contentHash: "abc", name: "counts" }] } });
    const plotRun = await db.exploreAnalysisRun.create({ data: { analysisId: plot.id, revisionId: plot.currentRevision!.id, runNumber: `EXP-CAP-${suffix}-2`, status: "completed", runFolder: plotFolder, createdById: userId, flowRunId: run.id, inputPins: [{ alias: "kept", datasetId: kept.id, versionId: "v2", name: "kept" }] } });
    tableId = (await db.exploreArtifact.create({ data: { runId: filterRun.id, kind: "table", format: "tsv", name: "kept", path: path.join(filterFolder, "outputs", "kept.tsv"), checksum: sha("gene\tc1\ng1\t5\n") } })).id;
    figureId = (await db.exploreArtifact.create({ data: { runId: plotRun.id, kind: "figure", format: "png", name: "volcano", path: path.join(plotFolder, "outputs", "volcano.png"), checksum: sha("PNG") } })).id;
  });

  afterAll(async () => {
    if (!url || !userId) return;
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.exploreEnvironment.deleteMany({ where: { name: `capsule-env-${suffix}` } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
    await fs.rm(state.root, { recursive: true, force: true });
  });

  it("traces an output back through the steps of its run and finds the code that plots it", async () => {
    const lineage = await outputLineage(flowId, figureId);
    expect(lineage.steps.map((step) => step.label)).toEqual(["1", "2"]);
    expect(lineage.inputs).toEqual([expect.objectContaining({ name: "counts", version: 1 })]);
    expect(lineage.edges).toEqual([expect.objectContaining({ to: lineage.artifact.stepId, via: "kept" })]);
    expect((await outputLineage(flowId, tableId)).steps.map((step) => step.label)).toEqual(["1"]);
    const source = await plotSource(figureId);
    expect(source.region).toMatchObject({ lineStart: 5, lineEnd: 7 });
  });

  it("packs a capsule with code, hashes, a README, a reproduce script and RO-Crate metadata", async () => {
    const requested = await requestCapsule(figureId, userId);
    expect(requested.created).toBe(true);
    // The build started in the background; build synchronously too (a second build of a finished capsule is a no-op).
    await buildCapsule(requested.capsule.id);
    for (let index = 0; index < 50; index += 1) {
      if ((await db.exploreCapsule.findUnique({ where: { id: requested.capsule.id } }))?.status !== "building") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const capsule = await db.exploreCapsule.findUnique({ where: { id: requested.capsule.id } });
    expect(capsule?.error ?? null).toBeNull();
    expect(capsule?.status).toBe("ready");
    expect((await requestCapsule(figureId, userId)).created).toBe(false);
    const archive = await unzipper.Open.file(capsule!.path!);
    const names = archive.files.map((file) => file.path);
    expect(names).toEqual(expect.arrayContaining(["README.md", "reproduce", "ro-crate-metadata.json", "inputs.sha256", "steps/1-filter/analysis.py", "steps/2-volcano_plot/analysis.py",
      "steps/2-volcano_plot/inputs/kept.tsv", "steps/1-filter/inputs/counts.tsv.sha256", "steps/2-volcano_plot/expected-checksums.txt", `environment/capsule-env-${suffix}.yml`, "helpers/python/seqdesk_explore/__init__.py", "helpers/r/profile.R"]));
    expect(names).not.toContain("steps/1-filter/inputs/counts.tsv");
    const read = async (name: string) => (await archive.files.find((file) => file.path === name)!.buffer()).toString();
    const readme = await read("README.md");
    expect(readme).toContain("Not verified yet");
    expect(readme).toContain("2. Volcano plot — A volcano plot shows fold change against significance.");
    expect(readme).toContain("listed by hash only");
    const crate = JSON.parse(await read("ro-crate-metadata.json"));
    expect(crate["@graph"].find((entity: { "@id": string }) => entity["@id"] === "#run")).toMatchObject({ "@type": "CreateAction", name: "Run #1" });
    const reproduce = await read("reproduce");
    const scriptPath = path.join(state.root, "reproduce.sh");
    await fs.writeFile(scriptPath, reproduce);
    expect(spawnSync("bash", ["-n", scriptPath]).status).toBe(0);
    expect(await read("steps/2-volcano_plot/expected-checksums.txt")).toBe(`${sha("PNG")}  outputs/volcano.png\n`);
    expect((capsule!.contents as Array<{ path: string; withheld: boolean }>).find((entry) => entry.path === "steps/1-filter/inputs/counts.tsv")?.withheld).toBe(true);
  });
});
