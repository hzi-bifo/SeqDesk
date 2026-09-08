import { db } from "@/lib/db";
import { coerceCell, inferSchema } from "../schema";
import type { ExploreRowData } from "../types";
import type { BuildContext, BuiltDataset } from "./types";

const LABELS: Record<string, string> = {
  sample_db_id: "Sample record",
  sample_id: "Sample ID",
  run_db_id: "Run record",
  run_id: "Run ID",
  run_name: "Run name",
  platform: "Platform",
  instrument: "Instrument",
  run_date: "Run date",
  barcode: "Barcode",
  q30_score: "Q30 score",
  cluster_density: "Cluster density",
  pass_filter_pct: "Pass filter %",
  run_total_reads: "Run total reads",
  run_total_bases: "Run total bases",
  read_file_1: "Read file 1",
  read_file_2: "Read file 2",
  read_count_1: "Read count 1",
  read_count_2: "Read count 2",
  avg_quality_1: "Average quality 1",
  avg_quality_2: "Average quality 2",
  data_class: "Data class",
  read_active: "Active read",
};

/**
 * The sequencing dataset: one row per sample per sequencing run, with the
 * run's quality metrics and the read files that belong to that sample on that
 * run. Samples without a run still appear once so nothing is silently lost.
 */
export async function buildSequencingDataset(context: BuildContext): Promise<BuiltDataset | null> {
  const sampleWhere =
    context.target.type === "study"
      ? { studyId: context.target.id }
      : context.target.type === "order"
        ? { orderId: context.target.id }
        : null;
  if (!sampleWhere) return null;

  const samples = await db.sample.findMany({
    where: sampleWhere,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sampleId: true,
      sequencingRunSamples: {
        select: {
          barcode: true,
          sequencingRun: {
            select: {
              id: true,
              runId: true,
              runName: true,
              platform: true,
              instrument: true,
              runDate: true,
              q30Score: true,
              clusterDensity: true,
              passFilterPct: true,
              totalReads: true,
              totalBases: true,
            },
          },
        },
      },
      reads: {
        where: { isActive: true },
        orderBy: { dataClass: "asc" },
        select: {
          file1: true,
          file2: true,
          readCount1: true,
          readCount2: true,
          avgQuality1: true,
          avgQuality2: true,
          dataClass: true,
          isActive: true,
          sequencingRunId: true,
        },
      },
    },
  });

  const rows: ExploreRowData[] = [];
  for (const sample of samples) {
    const runLinks = sample.sequencingRunSamples;
    if (runLinks.length === 0) {
      for (const read of sample.reads.length ? sample.reads : [null]) {
        rows.push(buildRow(sample, null, null, read));
      }
      continue;
    }
    for (const link of runLinks) {
      const run = link.sequencingRun;
      const reads = sample.reads.filter((read) => read.sequencingRunId === run.id);
      for (const read of reads.length ? reads : [null]) {
        rows.push(buildRow(sample, run, link.barcode, read));
      }
    }
  }

  const schema = inferSchema(rows, {
    labels: LABELS,
    roles: { sample: "sample_db_id", date: "run_date" },
    groups: Object.fromEntries(Object.keys(LABELS).map((key) => [key, key.startsWith("read") || key === "data_class" ? "reads" : key.startsWith("sample") ? "identity" : "run"])),
  });
  const targetLabel = context.target.type === "study" ? "study" : "sequencing order";
  return {
    kind: "sequencing",
    tableKind: "sample-summary",
    name: `Sequencing of the ${targetLabel}`,
    description: "One row per sample per sequencing run, with run quality metrics and read files.",
    sensitivity: "standard",
    roles: { sample: "sample_db_id", date: "run_date" },
    schema,
    rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "sequencing@1",
      sources: [{ type: context.target.type === "study" ? "study" : "order", id: context.target.id }],
      notes: [`${samples.length} samples, ${rows.length} rows`],
    },
    keys: { sample: "sample_db_id", key: "run_db_id" },
    sourceConfig: { builder: "sequencing" },
    warnings: [],
  };
}

type RunSelection = {
  id: string;
  runId: string;
  runName: string | null;
  platform: string | null;
  instrument: string | null;
  runDate: Date | null;
  q30Score: number | null;
  clusterDensity: number | null;
  passFilterPct: number | null;
  totalReads: number | null;
  totalBases: bigint | null;
} | null;

type ReadSelection = {
  file1: string | null;
  file2: string | null;
  readCount1: number | null;
  readCount2: number | null;
  avgQuality1: number | null;
  avgQuality2: number | null;
  dataClass: string;
  isActive: boolean;
} | null;

function buildRow(
  sample: { id: string; sampleId: string },
  run: RunSelection,
  barcode: string | null,
  read: ReadSelection
): ExploreRowData {
  return {
    sample_db_id: sample.id,
    sample_id: sample.sampleId,
    run_db_id: run?.id ?? null,
    run_id: run?.runId ?? null,
    run_name: run?.runName ?? null,
    platform: run?.platform ?? null,
    instrument: run?.instrument ?? null,
    run_date: coerceCell(run?.runDate ?? null),
    barcode: barcode ?? null,
    q30_score: run?.q30Score ?? null,
    cluster_density: run?.clusterDensity ?? null,
    pass_filter_pct: run?.passFilterPct ?? null,
    run_total_reads: run?.totalReads ?? null,
    run_total_bases: run?.totalBases !== null && run?.totalBases !== undefined ? Number(run.totalBases) : null,
    read_file_1: read?.file1 ?? null,
    read_file_2: read?.file2 ?? null,
    read_count_1: read?.readCount1 ?? null,
    read_count_2: read?.readCount2 ?? null,
    avg_quality_1: read?.avgQuality1 ?? null,
    avg_quality_2: read?.avgQuality2 ?? null,
    data_class: read?.dataClass ?? null,
    read_active: read ? read.isActive : null,
  };
}
