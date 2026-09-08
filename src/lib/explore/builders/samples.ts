import { db } from "@/lib/db";
import { buildStudyTableData } from "@/lib/studies/study-table";
import { coerceCell, inferSchema } from "../schema";
import type { ExploreRoleMap, ExploreRowData } from "../types";
import type { BuildContext, BuiltDataset } from "./types";

const SUBJECT_FIELD_CANDIDATES = ["host_subject_id", "subject_id", "patient_id", "subject"];
const TIMEPOINT_FIELD_CANDIDATES = ["timepoint", "collection_day", "relative_day", "visit"];
const DATE_FIELD_CANDIDATES = ["collection_date", "sampling_date", "date"];

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickRole(columns: string[], candidates: string[]): string | undefined {
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column] as const));
  for (const candidate of candidates) {
    const direct = lower.get(candidate.toLowerCase());
    if (direct) return direct;
    for (const [key, original] of lower) {
      if (key.endsWith(`:${candidate.toLowerCase()}`)) return original;
    }
  }
  return undefined;
}

/**
 * The samples dataset: one row per sample of the scope.
 *
 * For a study it reuses the study table builder, so the columns are exactly
 * the ones the Table Overview shows (identity, order fields, study fields,
 * MIxS fields, outputs). For an order it flattens the sample's core columns and
 * form answers directly.
 */
export async function buildSamplesDataset(context: BuildContext): Promise<BuiltDataset | null> {
  if (context.target.type === "study") return buildFromStudy(context);
  if (context.target.type === "order") return buildFromOrder(context);
  return null;
}

async function buildFromStudy(context: BuildContext): Promise<BuiltDataset | null> {
  const table = await buildStudyTableData(context.target.id, { isFacilityAdmin: context.isFacilityAdmin });
  if (!table) return null;

  const labels: Record<string, string> = { sample_db_id: "Sample record", sample_status: "Facility status" };
  const groups: Record<string, string> = { sample_db_id: "identity", sample_status: "status" };
  for (const column of table.columns) {
    labels[column.key] = column.label;
    groups[column.key] = column.group;
  }

  const rows: ExploreRowData[] = table.rows.map((row) => {
    const out: ExploreRowData = { sample_db_id: row.id, sample_status: row.statusLabel };
    for (const column of table.columns) {
      out[column.key] = coerceCell(row.cells[column.key] ?? null);
    }
    return out;
  });

  const columnKeys = Object.keys(rows[0] ?? { sample_db_id: null, ...Object.fromEntries(table.columns.map((c) => [c.key, null])) });
  const roles: ExploreRoleMap = { sample: "sample_db_id" };
  const subjectColumn = pickRole(columnKeys, SUBJECT_FIELD_CANDIDATES);
  if (subjectColumn) roles.subject = subjectColumn;
  const timepointColumn = pickRole(columnKeys, TIMEPOINT_FIELD_CANDIDATES);
  if (timepointColumn) roles.timepoint = timepointColumn;
  const dateColumn = pickRole(columnKeys, DATE_FIELD_CANDIDATES);
  if (dateColumn) roles.date = dateColumn;

  const schema = inferSchema(rows, { labels, roles, groups });
  return {
    kind: "samples",
    tableKind: "sample-summary",
    name: `Samples of ${table.study.title}`,
    description: "One row per sample assigned to the study, with the same columns as the Table Overview.",
    sensitivity: subjectColumn ? "pseudonymous" : "standard",
    roles,
    schema,
    rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "samples@1",
      sources: [{ type: "study", id: table.study.id, label: table.study.title }],
      notes: [`${rows.length} samples`],
    },
    keys: { sample: "sample_db_id", subject: subjectColumn },
    sourceConfig: { builder: "samples" },
    warnings: [],
  };
}

async function buildFromOrder(context: BuildContext): Promise<BuiltDataset | null> {
  const order = await db.order.findUnique({
    where: { id: context.target.id },
    select: {
      id: true,
      orderNumber: true,
      name: true,
      samples: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sampleId: true,
          sampleAlias: true,
          sampleTitle: true,
          sampleDescription: true,
          scientificName: true,
          taxId: true,
          facilityStatus: true,
          customFields: true,
          checklistData: true,
          studyId: true,
        },
      },
    },
  });
  if (!order) return null;

  const labels: Record<string, string> = {
    sample_db_id: "Sample record",
    sample_id: "Sample ID",
    sample_alias: "Alias",
    sample_title: "Title",
    sample_description: "Description",
    scientific_name: "Organism",
    tax_id: "Taxonomy ID",
    sample_status: "Facility status",
    study_id: "Study",
  };
  const groups: Record<string, string> = {};
  const rows: ExploreRowData[] = order.samples.map((sample) => {
    const out: ExploreRowData = {
      sample_db_id: sample.id,
      sample_id: sample.sampleId,
      sample_alias: sample.sampleAlias,
      sample_title: sample.sampleTitle,
      sample_description: sample.sampleDescription,
      scientific_name: sample.scientificName,
      tax_id: sample.taxId,
      sample_status: sample.facilityStatus,
      study_id: sample.studyId,
    };
    for (const [key, value] of Object.entries(parseJsonRecord(sample.customFields))) {
      const column = `custom:${key}`;
      out[column] = coerceCell(value);
      labels[column] = key;
      groups[column] = "order";
    }
    for (const [key, value] of Object.entries(parseJsonRecord(sample.checklistData))) {
      const column = `checklist:${key}`;
      out[column] = coerceCell(value);
      labels[column] = key;
      groups[column] = "study";
    }
    return out;
  });

  const columnKeys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const roles: ExploreRoleMap = { sample: "sample_db_id" };
  const subjectColumn = pickRole(columnKeys, SUBJECT_FIELD_CANDIDATES);
  if (subjectColumn) roles.subject = subjectColumn;
  const schema = inferSchema(rows, { labels, roles, groups });
  return {
    kind: "samples",
    tableKind: "sample-summary",
    name: `Samples of ${order.name ? `${order.orderNumber} ${order.name}` : order.orderNumber}`,
    description: "One row per sample of the sequencing order with its form answers.",
    sensitivity: subjectColumn ? "pseudonymous" : "standard",
    roles,
    schema,
    rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "samples@1",
      sources: [{ type: "order", id: order.id, label: order.orderNumber }],
      notes: [`${rows.length} samples`],
    },
    keys: { sample: "sample_db_id", subject: subjectColumn },
    sourceConfig: { builder: "samples" },
    warnings: [],
  };
}
