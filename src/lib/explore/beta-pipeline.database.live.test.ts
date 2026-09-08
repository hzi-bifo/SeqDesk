import { PrismaClient, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

// Real PostgreSQL and real app builders; no external API or scientific result
// is simulated. The small profile is an explicitly internal parser fixture.
const state = vi.hoisted(() => ({ tx: null as Prisma.TransactionClient | null, root: "" }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_target, key) => {
    if (!state.tx) throw new Error("Test transaction is not active");
    return state.tx[key as keyof Prisma.TransactionClient];
  } }),
}));
vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  return { ...actual, resolveExploreStorage: async () => ({
    baseDir: state.root, datasetsRoot: path.join(state.root, "datasets"),
    importsRoot: path.join(state.root, "imports"), runsRoot: path.join(state.root, "runs"),
  }) };
});
import { listPipelineTableSources } from "./builders/pipeline-table";
import { buildDataset } from "./build";
import { getDatasetDetail } from "./datasets";
import { createAnalysis } from "./analyses";
import { createReport, saveReport } from "./reports";
import { getKit } from "./kits/loader";
import { datasetFitsInput } from "./dataset-kinds";

const url = process.env.SEQDESK_BETA_DATABASE_URL;
it.skipIf(!url)("builds a manifest-declared profile dataset and a report analysis in PostgreSQL, then rolls back", async () => {
  const parsed = new URL(url!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^\/seqdesk_beta_.*test/.test(parsed.pathname)) {
    throw new Error("Use an explicitly configured local seqdesk_beta_*test database");
  }
  const db = new PrismaClient({ datasourceUrl: url });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-beta-report-test-"));
  const suffix = randomUUID();
  const rollback = new Error("Intentional beta integration test rollback");
  let completed = false;
  state.root = root;
  try {
    await expect(db.$transaction(async tx => {
      state.tx = tx;
      const owner = await tx.user.create({ data: {
        email: `beta-${suffix}@example.invalid`, password: "!disabled-internal-fixture",
        firstName: "Internal", lastName: "Beta test", isActive: false,
      } });
      const order = await tx.order.create({ data: {
        orderNumber: `BETA-INTERNAL-${suffix}`, userId: owner.id,
        name: "Internal imported-data entry", dataOrigin: "import",
      } });
      const sample = await tx.sample.create({ data: {
        sampleId: "INTERNAL_PROFILE_SAMPLE", orderId: order.id,
      } });
      const profile = path.join(root, "internal.cami.profile");
      await fs.writeFile(profile, "# Internal regression fixture, not CAMI benchmark data\n@SampleID:INTERNAL_PROFILE_SAMPLE\n@Version:0.10.0\n@@TAXID\tRANK\tTAXPATH\tTAXPATHSN\tPERCENTAGE\ninternal-A\tspecies\tinternal-A\tInternal taxon A\t60\ninternal-B\tspecies\tinternal-B\tInternal taxon B\t30\n");
      const run = await tx.pipelineRun.create({ data: {
        runNumber: `BETA-PROFILE-${suffix}`, pipelineId: "metaphlan",
        status: "completed", targetType: "order", orderId: order.id,
        userId: owner.id, runFolder: root, completedAt: new Date(),
        inputSampleIds: JSON.stringify([sample.id]),
      } });
      await tx.pipelineArtifact.create({ data: {
        pipelineRunId: run.id, outputId: "cami_profile", type: "artifact",
        path: profile, sampleId: sample.id,
      } });
      const targetKey = `order:${order.id}`;
      const context = { target: { type: "order" as const, id: order.id }, targetKey,
        isFacilityAdmin: false, userId: owner.id, installation: false };
      const sources = await listPipelineTableSources(context);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({ pipelineId: "metaphlan", outputId: "cami_profile", tableKind: "taxon-abundance-long" });
      const built = await buildDataset({
        context, kind: "pipeline-table", createdById: owner.id,
        options: { pipelineId: "metaphlan", outputId: "cami_profile" },
      });
      expect(built?.warnings).toEqual([]);
      expect(built?.version.rowCount).toBe(2);
      expect(built?.dataset.roles).toMatchObject({ sample: "sample_db_id", value: "PERCENTAGE", rank: "RANK" });
      expect(built?.dataset.roles).not.toHaveProperty("count");
      const detail = await getDatasetDetail(built!.dataset.id);
      expect(detail?.provenance?.sources).toContainEqual(expect.objectContaining({ type: "pipeline-run", id: run.id }));
      const kit = await getKit("abundance-composition");
      expect(datasetFitsInput(built!.dataset, kit!.manifest.inputs[0])).toEqual({ ok: true });
      const report = await createReport(targetKey, owner.id, "Internal profile report");
      const analysis = await createAnalysis({
        targetKey, reportId: report.id, createdById: owner.id, kitId: kit!.manifest.id,
        inputs: [{ alias: "profiles", datasetId: built!.dataset.id, versionId: null }],
      });
      expect(analysis.kitId).toBe("abundance-composition");
      const view = await saveReport(report.id, {
        title: report.title, blocks: [{ id: "profile-table", type: "table", datasetId: built!.dataset.id }],
      });
      expect(view.blocks[0]).toMatchObject({ type: "table", table: { rowCount: 2 } });
      const block = view.blocks[0];
      if (block.type !== "table") throw new Error("Expected report table");
      expect(block.table?.rows.map(row => row.sample_db_id)).toEqual([sample.id, sample.id]);
      completed = true;
      throw rollback;
    }, { timeout: 30_000 })).rejects.toBe(rollback);
    expect(completed).toBe(true);
    expect(await db.user.count({ where: { email: { contains: suffix } } })).toBe(0);
  } finally {
    state.tx = null;
    await db.$disconnect();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 45_000);
