/**
 * Demo reports: pages built over the seeded pipeline tables, so a demo user
 * opens a study and finds a report with numbers, a chart and the tables
 * behind them, made the same way a researcher would make one.
 */
import { db } from "@/lib/db";
import { createAnalysis } from "@/lib/explore/analyses";
import { buildDataset } from "@/lib/explore/build";
import { getDatasetRecord } from "@/lib/explore/datasets";
import { parseSchema } from "@/lib/explore/schema";
import type { BuildContext } from "@/lib/explore/builders/types";
import type { ReportBlock } from "@/lib/explore/report-blocks";
import { createReport, saveReport } from "@/lib/explore/reports";
import { STUDY_HUMAN_GUT_PRJEB54724, STUDY_MOUSE_GUT_PRJDB6165, STUDY_SURFACE_RESISTOME } from "@/lib/seed/templates";

interface BuiltTable {
  datasetId: string;
  columns: Set<string>;
}

function blockId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The dashboard numbers block for a table: one card per statistic the table can answer. */
export function numbersBlock(table: BuiltTable, figures: Array<{ column: string; stat: "count" | "mean" | "sum" | "max" | "median"; label: string; unit?: string; digits?: number }>, label: string): ReportBlock | null {
  const usable = figures.filter((figure) => table.columns.has(figure.column));
  if (usable.length === 0) return null;
  const entries = usable.map((figure) => ({ id: blockId("f").slice(2), figure }));
  return {
    id: blockId("numbers"),
    type: "run-metric",
    metrics: [],
    figures: entries.map(({ id, figure }) => ({ id, datasetId: table.datasetId, column: figure.column, stat: figure.stat })),
    labels: Object.fromEntries(entries.map(({ id, figure }) => [`f:${id}`, figure.label])),
    units: Object.fromEntries(entries.filter(({ figure }) => figure.unit).map(({ id, figure }) => [`f:${id}`, figure.unit as string])),
    digits: Object.fromEntries(entries.filter(({ figure }) => figure.digits !== undefined).map(({ id, figure }) => [`f:${id}`, figure.digits as number])),
    label,
    span: 2,
  };
}

function chartBlock(table: BuiltTable, chart: "bar" | "histogram" | "box" | "scatter", x: string, caption: string, y?: string): ReportBlock | null {
  if (!table.columns.has(x) || (y && !table.columns.has(y))) return null;
  return { id: blockId("chart"), type: "chart", datasetId: table.datasetId, chart, x, y, caption, span: 1 };
}

function tableBlock(table: BuiltTable, caption: string, rows = 25): ReportBlock {
  return { id: blockId("table"), type: "table", datasetId: table.datasetId, caption, rows, sortable: true, download: true, span: 2 };
}

function textBlock(markdown: string): ReportBlock {
  return { id: blockId("text"), type: "text", markdown, span: 2 };
}

/** Compose the human-gut report: the Kraken2/Bracken top-taxon table and the sample metadata. */
export function humanGutBlocks(taxa: BuiltTable | null, samples: BuiltTable | null): ReportBlock[] {
  const blocks: ReportBlock[] = [
    textBlock(
      "## Human gut cohort\n\nTwelve faecal shotgun libraries profiled with Kraken2 and Bracken against the standard database. The table behind this page holds the most abundant species per sample; the numbers and the chart below are computed from it and follow the table when it is rebuilt."
    ),
  ];
  if (taxa) {
    const numbers = numbersBlock(
      taxa,
      [
        { column: "sample_id", stat: "count", label: "Samples profiled" },
        { column: "fraction_total_reads", stat: "mean", label: "Mean share of the top species", digits: 2 },
        { column: "new_est_reads", stat: "sum", label: "Reads in top species" },
        { column: "new_est_reads", stat: "max", label: "Largest top-species count" },
      ],
      "The profiling in numbers"
    );
    if (numbers) blocks.push(numbers);
    const bar = chartBlock(taxa, "bar", "top_taxon", "How often each species is the top species");
    if (bar) blocks.push(bar);
    const share = chartBlock(taxa, "histogram", "fraction_total_reads", "Share of classified reads taken by the top species");
    if (share) blocks.push(share);
    blocks.push(tableBlock(taxa, "Top species per sample"));
  }
  if (samples) blocks.push(tableBlock(samples, "Samples of the study", 12));
  blocks.push(textBlock("## Methods\n\nKraken2 classification against the standard database, Bracken re-estimation at species level, Krona charts per sample. The per-sample Krona charts are on the pipeline run; this page reads only the summary table."));
  return blocks;
}

/** Compose the mouse-gut report: read quality from the FastQC summary of eight real ENA libraries. */
export function mouseGutBlocks(qc: BuiltTable | null, samples: BuiltTable | null): ReportBlock[] {
  const blocks: ReportBlock[] = [
    textBlock(
      "## Mouse gut metagenome: read quality\n\nEight public mouse-faecal Illumina MiSeq read pairs (ENA project PRJDB6165). FastQC ran on every file; the summary table gives read counts, mean Phred quality and the number of passed, warned and failed checks per mate."
    ),
  ];
  if (qc) {
    const numbers = numbersBlock(
      qc,
      [
        { column: "sample_id", stat: "count", label: "Samples" },
        { column: "r1_read_count", stat: "sum", label: "R1 reads" },
        { column: "r1_avg_quality", stat: "mean", label: "Mean R1 quality", unit: "Phred", digits: 1 },
        { column: "r1_fail", stat: "sum", label: "Failed checks (R1)" },
      ],
      "Read quality in numbers"
    );
    if (numbers) blocks.push(numbers);
    const reads = chartBlock(qc, "histogram", "r1_read_count", "Reads per library (R1)");
    if (reads) blocks.push(reads);
    const quality = chartBlock(qc, "scatter", "r1_read_count", "Mean quality against read count", "r1_avg_quality");
    if (quality) blocks.push(quality);
    blocks.push(tableBlock(qc, "FastQC summary per sample"));
  }
  if (samples) blocks.push(tableBlock(samples, "Samples of the study", 8));
  return blocks;
}

/** Compose the pilot report: simulated reads, their checksums and FastQC, as a small end-to-end QC page. */
export function pilotBlocks(qc: BuiltTable | null, simulation: BuiltTable | null, checksums: BuiltTable | null): ReportBlock[] {
  const blocks: ReportBlock[] = [
    textBlock(
      "## Surface resistome pilot: sequencing QC\n\nA two-sample pilot run through the facility's showcase pipelines: reads were simulated, checksummed and checked with FastQC. Every table on this page is a pipeline output that was added to the study; rebuilding a table after a new run refreshes the page."
    ),
  ];
  if (qc) {
    const numbers = numbersBlock(
      qc,
      [
        { column: "sample_id", stat: "count", label: "Samples" },
        { column: "r1_read_count", stat: "sum", label: "R1 reads" },
        { column: "r1_avg_quality", stat: "mean", label: "Mean R1 quality", unit: "Phred", digits: 1 },
      ],
      "Pilot QC in numbers"
    );
    if (numbers) blocks.push(numbers);
    blocks.push(tableBlock(qc, "FastQC summary"));
  }
  if (simulation) blocks.push(tableBlock(simulation, "Read simulation settings and outputs"));
  if (checksums) blocks.push(tableBlock(checksums, "FASTQ checksums"));
  return blocks;
}

async function build(context: BuildContext, kind: "samples" | "pipeline-table", options?: Record<string, unknown>): Promise<BuiltTable | null> {
  try {
    const result = await buildDataset({ context, kind, options, createdById: context.userId });
    if (!result) return null;
    let columns = result.dataset.schema?.columns ?? [];
    if (columns.length === 0) {
      const record = await getDatasetRecord(result.dataset.id);
      const version = record?.versions.find((entry) => entry.id === result.version.versionId) ?? record?.versions[0] ?? null;
      columns = parseSchema(version?.schema).columns;
    }
    return { datasetId: result.dataset.id, columns: new Set(columns.map((column) => column.key)) };
  } catch (error) {
    console.warn(`[Demo Reports] ${kind}${options?.pipelineId ? ` ${String(options.pipelineId)}` : ""} skipped:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function writeReport(targetKey: string, userId: string, title: string, blocks: ReportBlock[]): Promise<string | null> {
  if (blocks.length <= 1) return null;
  const report = await createReport(targetKey, userId, title);
  await saveReport(report.id, { title, blocks, filters: [] });
  return report.id;
}

/**
 * Seed one report per showcase study of a freshly created demo workspace.
 * Every step is best effort: a table that cannot be built is left out of
 * its page, and a page that cannot be written is skipped with a warning.
 */
export async function seedDemoReports(userId: string): Promise<{ reports: number }> {
  let reports = 0;
  try {
    const studies = await db.study.findMany({ where: { userId }, select: { id: true, title: true } });
    const study = (base: string) => studies.find((entry) => entry.title === base) ?? studies.find((entry) => entry.title.startsWith(base)) ?? null;
    const contextFor = (id: string): BuildContext => ({ target: { type: "study", id }, targetKey: `study:${id}`, userId, installation: false, isFacilityAdmin: false });

    const human = study(STUDY_HUMAN_GUT_PRJEB54724.titleBase);
    if (human) {
      const context = contextFor(human.id);
      const taxa = await build(context, "pipeline-table", { pipelineId: "kraken2-bracken", outputId: "summary" });
      const samples = await build(context, "samples");
      if (await writeReport(context.targetKey, userId, "Human gut cohort: taxonomic profile", humanGutBlocks(taxa, samples))) reports += 1;
    }

    const mouse = study(STUDY_MOUSE_GUT_PRJDB6165.titleBase);
    if (mouse) {
      const context = contextFor(mouse.id);
      const qc = await build(context, "pipeline-table", { pipelineId: "fastqc", outputId: "summary" });
      const samples = await build(context, "samples");
      const reportId = await writeReport(context.targetKey, userId, "Mouse gut metagenome: read quality", mouseGutBlocks(qc, samples));
      if (reportId) {
        reports += 1;
        if (qc) {
          // An analysis step ready to run from the template, so the canvas is not empty.
          try {
            await createAnalysis({ targetKey: context.targetKey, reportId, kitId: "fastqc-overview", name: "FastQC quality overview", inputs: [{ alias: "qc", datasetId: qc.datasetId, versionId: null }], createdById: userId });
          } catch (error) {
            console.warn("[Demo Reports] analysis step skipped:", error instanceof Error ? error.message : error);
          }
        }
      }
    }

    const pilot = study(STUDY_SURFACE_RESISTOME.titleBase);
    if (pilot) {
      const context = contextFor(pilot.id);
      const qc = await build(context, "pipeline-table", { pipelineId: "fastqc", outputId: "summary" });
      const simulation = await build(context, "pipeline-table", { pipelineId: "simulate-reads", outputId: "summary" });
      const checksums = await build(context, "pipeline-table", { pipelineId: "fastq-checksum", outputId: "summary" });
      if (await writeReport(context.targetKey, userId, "Surface resistome pilot: sequencing QC", pilotBlocks(qc, simulation, checksums))) reports += 1;
    }
  } catch (error) {
    console.warn("[Demo Reports] seeding skipped:", error instanceof Error ? error.message : error);
  }
  return { reports };
}
