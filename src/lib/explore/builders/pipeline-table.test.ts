import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildContext } from "./types";
import { ManifestSchema } from "@/lib/pipelines/manifest-schema";
import { initialChartSpec } from "../report-source-actions";
import { buildChart } from "../report-widgets";

const mocks = vi.hoisted(() => ({
  db: { sample: { findMany: vi.fn() }, pipelineRun: { findMany: vi.fn() },
    pipelineResultSelection: { findUnique: vi.fn(), findMany: vi.fn() } },
  getPackage: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/pipelines/package-loader", () => ({ getPackage: mocks.getPackage }));
import { buildPipelineTableDataset, listPipelineTableSources } from "./pipeline-table";

const context: BuildContext = { target: { type: "study", id: "comparison" }, targetKey: "study:comparison",
  userId: "owner", installation: false, isFacilityAdmin: false };
const options = { pipelineId: "internal-test-pipeline", outputId: "profile" };
const sample = (id: string, group: string, studyId = "comparison") => ({
  id, sampleId: `INTERNAL_${id}`, sampleAlias: null as string | null, studyId,
  studyMemberships: [{ studyId: "comparison", groupLabel: group, role: group }],
});
const caseSample = sample("case", "case");
const control = sample("control", "control", "source-study");
let root: string;
let fileNumber = 0;

async function artifact(sampleId: string | null, contents = "taxon\tvalue\nInternal taxon\t40\n") {
  const id = `artifact-${++fileNumber}`;
  const file = path.join(root, `${id}.tsv`);
  await fs.writeFile(file, contents);
  return { id, outputId: "profile", sampleId, path: file, checksum: null };
}

function run(id: string, artifacts: Awaited<ReturnType<typeof artifact>>[], extras: Record<string, unknown> = {}) {
  return { id, runNumber: `INTERNAL_${id}`, pipelineId: options.pipelineId, completedAt: new Date(),
    studyId: null, orderId: "source-order", runFolder: root,
    inputSampleIds: JSON.stringify(artifacts.map(entry => entry.sampleId).filter(Boolean)), artifacts, ...extras };
}

describe("cohort-safe pipeline table datasets", () => {
  it("uses a saved artifact's contract after the installed package changes", async () => {
    const saved = { tableKind: "sample-summary", format: "tsv", schemaId: "internal.measurement", schemaVersion: "old", columns: { value: { type: "number", unit: "percent" } } };
    const file = { ...await artifact("case"), metadata: JSON.stringify({ seqdeskOutput: { table: saved } }) };
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("old", [file])]);
    const sources = await listPipelineTableSources(context);
    expect(sources[0].table).toMatchObject(saved);
    expect((await buildPipelineTableDataset(context, options))?.schema).toMatchObject({ schemaVersion: "old", columns: expect.arrayContaining([expect.objectContaining({ key: "value", unit: "percent" })]) });
  });

  it("keeps saved tables usable when their package is no longer installed", async () => {
    const file = { ...await artifact("case"), metadata: JSON.stringify({ seqdeskOutput: { table: { tableKind: "sample-summary", format: "tsv" } } }) };
    mocks.getPackage.mockReturnValue(null);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("saved", [file])]);
    expect((await buildPipelineTableDataset(context, options))?.rows).toHaveLength(1);
  });

  it("refuses to mix source runs with different declared units", async () => {
    const file = async (id: string, unit: string) => ({ ...await artifact(id), metadata: JSON.stringify({ seqdeskOutput: { table: { tableKind: "sample-summary", format: "tsv", columns: { value: { type: "number", unit } } } } }) });
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("first", [await file("case", "percent")]), run("second", [await file("control", "fraction")])]);
    expect(await listPipelineTableSources(context)).toHaveLength(2);
    await expect(buildPipelineTableDataset(context, options)).rejects.toThrow(/different output schemas or units/);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-report-table-test-"));
    fileNumber = 0;
    mocks.db.sample.findMany.mockResolvedValue([caseSample, control]);
    mocks.db.pipelineResultSelection.findMany.mockResolvedValue([]);
    mocks.db.pipelineResultSelection.findUnique.mockResolvedValue(null);
    mocks.getPackage.mockReturnValue({ manifest: { package: { name: "Internal regression fixture" }, outputs: [
      { id: "profile", scope: "sample", table: { tableKind: "taxon-abundance-long", format: "tsv", roles: { taxon: "taxon", value: "value" } } },
    ] } });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("combines case and linked-control runs, excluding unrelated artifacts and retaining groups", async () => {
    const caseFile = await artifact("case");
    const controlFile = await artifact("control");
    const foreignFile = await artifact("unrelated");
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run("new-case", [caseFile]), run("earlier-control", [controlFile, foreignFile]),
    ]);
    const sources = await listPipelineTableSources(context);
    expect(sources[0].runs.map(entry => entry.artifactCount)).toEqual([1, 1]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows.map(row => row.sample_db_id)).toEqual(["case", "control"]);
    expect(result?.rows[1]).toMatchObject({ source_study_id: "source-study", cohort_group: "control", cohort_role: "control" });
    expect(result?.roles).toMatchObject({ sample: "sample_db_id", group: "cohort_group" });
    expect(result?.warnings).toEqual([]);
    expect(result?.provenance.sources.map(source => source.id)).not.toContain(foreignFile.id);
    expect(mocks.db.sample.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [
      { OR: [{ studyId: "comparison" }, { studyMemberships: { some: { studyId: "comparison" } } }] },
      { OR: [{ order: { userId: "owner" } }, { orderId: null, study: { userId: "owner" } }] },
    ] } }));
  });

  it("prefers the selected result per sample and fills controls from other runs without duplicates", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run("new", [await artifact("case")]), run("control", [await artifact("control")]),
      run("selected", [await artifact("case")], { studyId: "comparison" }),
    ]);
    mocks.db.pipelineResultSelection.findUnique.mockResolvedValue({ selectedRunId: "selected" });
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows.map(row => row.pipeline_run)).toEqual(["INTERNAL_selected", "INTERNAL_control"]);
    expect(result?.provenance.sources.filter(source => source.type === "pipeline-run").map(source => source.id)).toEqual(["selected", "control"]);
  });

  it("keeps duplicate sample labels distinct when artifacts have stable sample IDs", async () => {
    mocks.db.sample.findMany.mockResolvedValue([{ ...caseSample, sampleId: "same" }, { ...control, sampleId: "same" }]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("source", [await artifact("case"), await artifact("control")])]);
    expect((await buildPipelineTableDataset(context, options))?.rows.map(row => row.sample_db_id)).toEqual(["case", "control"]);
  });

  it.each([null, "not-json", "[]", '["case","inaccessible"]'])("excludes aggregate tables with unknown or out-of-scope frozen inputs (%s)", async frozen => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("aggregate", [await artifact(null)], { studyId: "comparison", inputSampleIds: frozen })]);
    expect(await listPipelineTableSources(context)).toEqual([]);
    expect(await buildPipelineTableDataset(context, options)).toBeNull();
  });

  it("does not reuse a different study's aggregate even with matching inputs", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("aggregate", [await artifact(null)], { studyId: "source-study", inputSampleIds: '["case","control"]' })]);
    expect(await buildPipelineTableDataset(context, options)).toBeNull();
  });

  it("excludes unknown and ambiguous labels from an eligible combined table", async () => {
    const pkg = mocks.getPackage();
    pkg.manifest.outputs[0].table.sampleColumn = "label";
    mocks.db.sample.findMany.mockResolvedValue([{ ...caseSample, sampleAlias: "same" }, { ...control, sampleAlias: "same" }]);
    const table = await artifact(null, "label\ttaxon\tvalue\ncase\tInternal A\t10\nsame\tInternal B\t20\nunknown\tInternal C\t30\ncontrol\tInternal D\t40\n");
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("combined", [table], { studyId: "comparison", inputSampleIds: '["case","control"]' })]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows.map(row => row.sample_db_id)).toEqual(["case", "control"]);
    expect(result?.warnings).toContain("2 rows with unknown or ambiguous sample labels were excluded.");
  });

  it("allows a known same-target aggregate but does not assign an invented sample role", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("aggregate", [await artifact(null)], { studyId: "comparison", inputSampleIds: '["case","control"]' })]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].sample_db_id).toBeNull();
    expect(result?.roles).not.toHaveProperty("sample");
  });

  it("rejects combined rows for cohort samples that were not frozen inputs of that run", async () => {
    mocks.getPackage().manifest.outputs[0].table.sampleColumn = "label";
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("combined", [await artifact(null,
      "label\ttaxon\tvalue\ncontrol\tInternal\t40\n")], { studyId: "comparison", inputSampleIds: '["case"]' })]);
    await expect(buildPipelineTableDataset(context, options)).rejects.toThrow("No rows could be matched unambiguously");
  });

  it("does not guess when a sample alias collides with another sample's database ID", async () => {
    mocks.getPackage().manifest.outputs[0].table.sampleColumn = "label";
    mocks.db.sample.findMany.mockResolvedValue([caseSample, { ...control, sampleAlias: "case" }]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("combined", [await artifact(null,
      "label\ttaxon\tvalue\ncase\tInternal\t40\n")], { studyId: "comparison", inputSampleIds: '["case","control"]' })]);
    await expect(buildPipelineTableDataset(context, options)).rejects.toThrow("matched unambiguously");
  });

  it("reports malformed declared headers without falling back to a different parser", async () => {
    mocks.getPackage().manifest.outputs[0].table.headerLinePrefix = "@@";
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("source", [await artifact("case")])]);
    await expect(buildPipelineTableDataset(context, options)).rejects.toThrow("manifest-declared format");
  });

  it("honors an empty explicit run selection and reports unavailable selections", async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("available", [await artifact("case")])]);
    expect(await buildPipelineTableDataset(context, { ...options, runIds: [] })).toBeNull();
    const result = await buildPipelineTableDataset(context, { ...options, runIds: ["available", "foreign"] });
    expect(result?.rows).toHaveLength(1);
    expect(result?.warnings.join(" ")).toContain("Some requested runs");
    expect(result?.sourceConfig.runIds).toEqual(["available", "foreign"]);
  });

  it("does not use stale membership or widen the sample query to source artifacts", async () => {
    mocks.db.sample.findMany.mockResolvedValue([caseSample]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("source", [await artifact("case"), await artifact("control")])]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows.map(row => row.sample_db_id)).toEqual(["case"]);
    expect(JSON.stringify(mocks.db.sample.findMany.mock.calls)).not.toContain('"control"');
  });

  it("keeps manifest roles and server identities authoritative over caller/file columns", async () => {
    mocks.db.sample.findMany.mockResolvedValue([caseSample]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("source", [await artifact("case",
      "taxon\tvalue\tsample_db_id\tpipeline_run\tcohort_group\nInternal\t40\tforeign\tforged\twrong\n")])]);
    const result = await buildPipelineTableDataset(context, { ...options, table: { tableKind: "sample-summary", format: "csv" } });
    expect(result?.tableKind).toBe("taxon-abundance-long");
    expect(result?.rows[0]).toMatchObject({ sample_db_id: "case", pipeline_run: "INTERNAL_source", cohort_group: "case" });
  });

  it("rejects symlink escapes and omits unread files from provenance", async () => {
    const outside = await artifact("control");
    const runRoot = path.join(root, "run");
    await fs.mkdir(runRoot);
    const link = path.join(runRoot, "escape.tsv");
    await fs.symlink(outside.path, link);
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      run("safe", [await artifact("case")]), run("escaping", [{ ...outside, path: link }], { runFolder: runRoot }),
    ]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.rows.map(row => row.sample_db_id)).toEqual(["case"]);
    expect(result?.warnings.join(" ")).toContain("could not be read");
    expect(result?.provenance.sources.map(source => source.id)).not.toContain("escaping");
    expect(result?.description).toContain("1 sample-scoped output files of 1 run");
  });

  it("fails closed before looking for results without an actor", async () => {
    mocks.db.sample.findMany.mockResolvedValue([]);
    expect(await buildPipelineTableDataset({ ...context, userId: "" }, options)).toBeNull();
    expect(mocks.db.sample.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [] } } }));
    expect(mocks.db.pipelineRun.findMany).not.toHaveBeenCalled();
  });

  it("exposes existing FastQC summaries with useful labels without rerunning older packages", async () => {
    mocks.getPackage.mockReturnValue({ manifest: { package: { name: "FastQC" }, outputs: [{ id: "summary", scope: "run" }] } });
    mocks.db.sample.findMany.mockResolvedValue([caseSample]);
    const table = { ...await artifact(null, "sample_id\tr1_read_count\tr1_avg_quality\tr2_read_count\tr2_avg_quality\nINTERNAL_case\t16647395\t33.7\t16647395\t31.9\n"), outputId: "summary" };
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("fastqc", [table], { pipelineId: "fastqc", studyId: "comparison", inputSampleIds: '["case"]' })]);
    const sources = await listPipelineTableSources(context);
    expect(sources[0]).toMatchObject({ pipelineName: "FastQC", label: "FastQC quality summary", format: "tsv", columnLabels: { r1_read_count: "R1 reads" } });
    expect(sources[0].description).toContain("PASS / WARN / FAIL");
    const result = await buildPipelineTableDataset(context, { pipelineId: "fastqc", outputId: "summary", runIds: ["fastqc"] });
    expect(result?.schema.columns.find(column => column.key === "r1_avg_quality")?.label).toBe("R1 mean quality (Phred)");
    expect(result?.provenance.sources).toContainEqual({ type: "pipeline-run", id: "fastqc", label: "INTERNAL_fastqc" });
    expect(result?.provenance.notes).toContain("Only the explicitly chosen completed runs are used.");
  });

  it("does not expose FastQC HTML reports as tables", async () => {
    mocks.getPackage.mockReturnValue(null);
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("html", [{ ...await artifact("case"), outputId: "sample_qc_reports" }], { pipelineId: "fastqc" })]);
    expect(await listPipelineTableSources(context)).toEqual([]);
  });

  it("keeps server identity labels authoritative over package labels", async () => {
    mocks.getPackage().manifest.outputs[0].table.columnLabels = { value: "Abundance", sample_db_id: "Misleading identity", pipeline_run: "Wrong run" };
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("source", [await artifact("case")])]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.schema.columns.find(column => column.key === "value")?.label).toBe("Abundance");
    expect(result?.schema.columns.find(column => column.key === "sample_db_id")?.label).toBe("Sample record");
    expect(result?.schema.columns.find(column => column.key === "pipeline_run")?.label).toBe("Pipeline run");
  });

  it.each(["nanoplot", "read-cleaning"])("supports %s's output contract under an entirely new pipeline and output ID", async pipeline => {
    const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(process.cwd(), `pipelines/${pipeline}/manifest.json`), "utf8")));
    const declaration = manifest.outputs.find(output => output.table)!;
    const customId = "new-user-pipeline-without-app-integration";
    const outputId = "user-defined-measurements";
    mocks.getPackage.mockImplementation(id => id === customId ? { manifest: {
      ...manifest, package: { ...manifest.package, id: customId, name: "User's new pipeline" },
      outputs: [{ ...declaration, id: outputId }],
    } } : null);
    mocks.db.sample.findMany.mockResolvedValue([caseSample]);
    const contents = pipeline === "nanoplot"
      ? "sample_id\tnum_reads\ttotal_bases\tmean_length\tmedian_length\tread_n50\tmean_quality\nINTERNAL_case\t4\t8000\t2000\t1800\t2200\t14.1\n"
      : JSON.stringify([{ sample_record: "case", source_sample: "INTERNAL_case", classifier: "Kraken2", classified_read_ids: 4, blastn_unique_ids: null }]);
    const file = { ...await artifact(null, contents), outputId };
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("new-tool", [file], { pipelineId: customId, studyId: "comparison", inputSampleIds: '["case"]' })]);
    const sources = await listPipelineTableSources(context);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ pipelineId: customId, pipelineName: "User's new pipeline", outputId, table: declaration.table });
    const result = await buildPipelineTableDataset(context, { pipelineId: customId, outputId, runIds: ["new-tool"] });
    expect(result?.rows[0]).toMatchObject({ sample_db_id: "case", sample_id: "INTERNAL_case", cohort_group: "case" });
    expect(result?.provenance.sources).toContainEqual({ type: "pipeline-run", id: "new-tool", label: "INTERNAL_new-tool" });
    const columns = result!.schema.columns.filter(column => !column.key.endsWith("_db_id"));
    const chart = buildChart(result!.rows, columns, initialChartSpec(columns));
    expect(chart.data[0].x).toEqual(["INTERNAL_case"]);
    expect(chart.data[0].y).toEqual([4]);
  });

  it("supports a new row entity, table kind, column vocabulary and unit without pretending it is sample-level QC", async () => {
    const table = ManifestSchema.shape.outputs.element.shape.table.parse({
      label: "Instrument signals", tableKind: "user.instrument-signals", format: "json",
      schemaId: "user.signal-measurements", schemaVersion: "3", rowEntity: "instrument-channel",
      roles: { value: "amplitude" }, columns: {
        channel: { type: "string", label: "Channel", required: true },
        amplitude: { type: "number", label: "Amplitude", unit: "mV", required: true },
      },
    });
    mocks.getPackage.mockReturnValue({ manifest: { package: { name: "Internal instrument fixture" }, outputs: [{ id: "profile", scope: "run", table }] } });
    mocks.db.pipelineRun.findMany.mockResolvedValue([run("signals", [await artifact(null, JSON.stringify([
      { channel: "A", amplitude: 12.5 }, { channel: "B", amplitude: 0 },
    ]))], { studyId: "comparison", inputSampleIds: '["case","control"]' })]);
    const result = await buildPipelineTableDataset(context, options);
    expect(result?.tableKind).toBe("user.instrument-signals");
    expect(result?.schema.rowEntity).toBe("instrument-channel");
    expect(result?.roles).not.toHaveProperty("sample");
    expect(result?.rows.every(row => row.sample_db_id === null)).toBe(true);
    const chart = buildChart(result!.rows, result!.schema.columns, { chart: "values", x: "channel", y: "amplitude" });
    expect(chart.data[0].y).toEqual([12.5, 0]);
    expect(chart.layout.yaxis).toEqual({ title: { text: "Amplitude (mV)" } });
  });
});
