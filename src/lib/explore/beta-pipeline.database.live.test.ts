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
import { buildPipelineTableDataset, listPipelineTableSources } from "./builders/pipeline-table";
import { buildSamplesDataset } from "./builders/samples";
import { buildSequencingDataset } from "./builders/sequencing";
import { buildStudyTableData } from "@/lib/studies/study-table";
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

      // A real cross-source cohort: own facility sample + imported control,
      // with a different owner's linked sample and an unrelated source sample.
      const study = await tx.study.create({ data: { title: "Internal cohort comparison", userId: owner.id } });
      const sourceStudy = await tx.study.create({ data: { title: "Internal control source", userId: owner.id } });
      await tx.sample.update({ where: { id: sample.id }, data: { studyId: study.id } });
      const controlOrder = await tx.order.create({ data: {
        orderNumber: `BETA-CONTROL-${suffix}`, userId: owner.id, dataOrigin: "import",
      } });
      const control = await tx.sample.create({ data: {
        sampleId: "INTERNAL_CONTROL", orderId: controlOrder.id, studyId: sourceStudy.id,
        checklistData: JSON.stringify({ host_subject_id: "INTERNAL_SUBJECT", collection_date: "2026-01-01" }),
      } });
      const unrelated = await tx.sample.create({ data: { sampleId: "INTERNAL_UNRELATED", orderId: controlOrder.id } });
      const otherOwner = await tx.user.create({ data: {
        email: `beta-other-${suffix}@example.invalid`, password: "!disabled-internal-fixture",
        firstName: "Internal", lastName: "Other owner", isActive: false,
      } });
      const privateOrder = await tx.order.create({ data: { orderNumber: `BETA-PRIVATE-${suffix}`, userId: otherOwner.id } });
      const privateSample = await tx.sample.create({ data: { sampleId: "INTERNAL_PRIVATE", orderId: privateOrder.id } });
      await tx.studySample.createMany({ data: [
        { studyId: study.id, sampleId: sample.id, groupLabel: "Cases", role: "case" },
        { studyId: study.id, sampleId: control.id, groupLabel: "Controls", role: "control" },
        { studyId: study.id, sampleId: privateSample.id, groupLabel: "Private", role: "control" },
      ] });
      const controlRun = await tx.pipelineRun.create({ data: {
        runNumber: `BETA-CONTROL-RUN-${suffix}`, pipelineId: "metaphlan", status: "completed",
        targetType: "order", orderId: controlOrder.id, userId: owner.id, runFolder: root,
        completedAt: new Date(Date.now() - 60_000), inputSampleIds: JSON.stringify([control.id, unrelated.id]),
      } });
      for (const entry of [control, unrelated]) {
        const entryProfile = path.join(root, `${entry.id}.cami.profile`);
        await fs.writeFile(entryProfile, (await fs.readFile(profile, "utf8")).replace("@SampleID:INTERNAL_PROFILE_SAMPLE", `@SampleID:${entry.sampleId}`));
        await tx.pipelineArtifact.create({ data: { pipelineRunId: controlRun.id, outputId: "cami_profile",
          type: "artifact", sampleId: entry.id, path: entryProfile } });
      }
      const privateRun = await tx.pipelineRun.create({ data: {
        runNumber: `BETA-PRIVATE-RUN-${suffix}`, pipelineId: "metaphlan", status: "completed",
        targetType: "order", orderId: privateOrder.id, userId: otherOwner.id, runFolder: root,
        completedAt: new Date(), inputSampleIds: JSON.stringify([privateSample.id]),
      } });
      await tx.pipelineArtifact.create({ data: { pipelineRunId: privateRun.id, outputId: "cami_profile",
        type: "artifact", sampleId: privateSample.id, path: profile } });
      const cohortContext = { ...context, target: { type: "study" as const, id: study.id }, targetKey: `study:${study.id}` };
      const cohortSources = await listPipelineTableSources(cohortContext);
      expect(cohortSources[0].runs.map(entry => entry.id).sort()).toEqual([run.id, controlRun.id].sort());
      expect(cohortSources[0].runs.every(entry => entry.artifactCount === 1)).toBe(true);
      const metadata = await buildSamplesDataset(cohortContext);
      expect(metadata?.rows.map(row => row.sample_db_id).sort()).toEqual([sample.id, control.id].sort());
      expect(metadata?.rows.find(row => row.sample_db_id === control.id)).toMatchObject({
        source_study_id: sourceStudy.id, cohort_group: "Controls", cohort_role: "control",
        "checklist:host_subject_id": "INTERNAL_SUBJECT",
      });
      expect(metadata?.roles.group).toBe("cohort_group");
      const sequencing = await buildSequencingDataset(cohortContext);
      expect(sequencing?.rows.map(row => row.sample_db_id).sort()).toEqual([sample.id, control.id].sort());
      expect(sequencing?.rows.find(row => row.sample_db_id === control.id)?.cohort_group).toBe("Controls");
      // The editable/submission table must retain primary-only membership.
      const primaryTable = await buildStudyTableData(study.id, { isFacilityAdmin: false });
      expect(primaryTable?.rows.map(row => row.id)).toEqual([sample.id]);
      const cohortBuilt = await buildDataset({ context: cohortContext, kind: "pipeline-table", createdById: owner.id,
        options: { pipelineId: "metaphlan", outputId: "cami_profile" } });
      expect(cohortBuilt?.warnings).toEqual([]);
      expect(cohortBuilt?.version.rowCount).toBe(4);
      expect(cohortBuilt?.dataset.roles.group).toBe("cohort_group");
      const cohortReport = await createReport(cohortContext.targetKey, owner.id, "Internal cases and controls");
      const cohortView = await saveReport(cohortReport.id, {
        title: cohortReport.title, blocks: [{ id: "cohort-profiles", type: "table", datasetId: cohortBuilt!.dataset.id }],
      });
      const cohortBlock = cohortView.blocks[0];
      if (cohortBlock.type !== "table") throw new Error("Expected cohort report table");
      expect(cohortBlock.table?.rowCount).toBe(4);
      expect(new Set(cohortBlock.table?.rows.map(row => row.cohort_group))).toEqual(new Set(["Cases", "Controls"]));
      expect(await tx.sample.findUnique({ where: { id: control.id }, select: { studyId: true } })).toEqual({ studyId: sourceStudy.id });

      // Shared-lab/operational scientific access may include the linked sample,
      // but must still exclude the unrelated sample in the same source run.
      const shared = await buildPipelineTableDataset({ ...cohortContext, installation: true }, { pipelineId: "metaphlan", outputId: "cami_profile" });
      expect(new Set(shared?.rows.map(row => row.sample_db_id))).toEqual(new Set([sample.id, control.id, privateSample.id]));
      await tx.studySample.delete({ where: { studyId_sampleId: { studyId: study.id, sampleId: control.id } } });
      const afterUnlink = await buildPipelineTableDataset(cohortContext, { pipelineId: "metaphlan", outputId: "cami_profile" });
      expect(new Set(afterUnlink?.rows.map(row => row.sample_db_id))).toEqual(new Set([sample.id]));
      expect((await buildSamplesDataset(cohortContext))?.rows.map(row => row.sample_db_id)).toEqual([sample.id]);
      // Existing dataset versions remain reproducible snapshots, not a live join.
      expect((await getDatasetDetail(cohortBuilt!.dataset.id))?.currentVersion?.rowCount).toBe(4);
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
