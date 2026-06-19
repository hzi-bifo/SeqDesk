import { db } from "@/lib/db";
import {
  isStudyModuleEnabled,
  loadStudyFormSchema,
  parseStudyModulesConfig,
} from "@/lib/studies/schema";
import { FIELD_TO_COLUMN_MAP } from "@/lib/sample-fields";
import {
  FACILITY_SAMPLE_STATUS_LABELS,
  isFacilitySampleStatus,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";

/**
 * A single column in the study "Table overview" — either a fixed identity/status
 * column or a per-sample form field. When the `dynamic-studies` module is enabled
 * and the study has its own questionnaire, the field columns come from THAT study's
 * schema; otherwise they come from the global study form.
 */
export interface StudyTableColumn {
  key: string;
  label: string;
  kind: "identity" | "status" | "field";
  fieldType?: string;
}

export interface StudyTableRow {
  /** Sample.id (the database id), used as a stable React key. */
  id: string;
  status: FacilitySampleStatus;
  statusLabel: string;
  /** column key -> display string */
  cells: Record<string, string>;
}

export interface StudyTableData {
  study: {
    id: string;
    title: string;
    alias: string | null;
    userId: string;
    checklistType: string | null;
    sampleCount: number;
  };
  columns: StudyTableColumn[];
  rows: StudyTableRow[];
  /** Study-level (per-study, not per-sample) fields rendered as a summary strip. */
  studySummary: Array<{ label: string; value: string }>;
  /** True when these columns came from the study's OWN questionnaire (dynamic-studies). */
  perStudy: boolean;
}

const IDENTITY_COLUMNS: StudyTableColumn[] = [
  { key: "_sampleId", label: "Sample ID", kind: "identity" },
  { key: "_status", label: "Status", kind: "status" },
  { key: "_organism", label: "Organism", kind: "identity" },
  { key: "_accession", label: "ENA Accession", kind: "identity" },
];

// Core columns the identity block already renders, so we don't duplicate them as
// per-sample field columns (organism + tax id are folded into the Organism column).
const CORE_COLUMNS_ALREADY_SHOWN = new Set(["scientificName", "taxId"]);

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => formatCell(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function resolveStudy(idOrAlias: string) {
  const byId = await db.study.findUnique({
    where: { id: idOrAlias },
    select: studyTableSelect,
  });
  if (byId) return byId;
  try {
    return await db.study.findFirst({
      where: { alias: idOrAlias },
      orderBy: { createdAt: "desc" },
      select: studyTableSelect,
    });
  } catch {
    // `alias` may not exist on older schemas — fall through to "not found".
    return null;
  }
}

const studyTableSelect = {
  id: true,
  title: true,
  alias: true,
  userId: true,
  checklistType: true,
  studyMetadata: true,
} as const;

/**
 * Build the read-only spreadsheet model for a study: identity + status + per-sample
 * metadata columns, one row per assigned sample, plus a study-level summary. Shared
 * by the page API and the XLSX export so both stay in lockstep. Returns null if the
 * study cannot be resolved.
 */
export async function buildStudyTableData(
  idOrAlias: string,
  options: { isFacilityAdmin: boolean }
): Promise<StudyTableData | null> {
  const study = await resolveStudy(idOrAlias);
  if (!study) return null;

  const [schema, samples, settings] = await Promise.all([
    loadStudyFormSchema({
      studyId: study.id,
      isFacilityAdmin: options.isFacilityAdmin,
      applyRoleFilter: true,
      applyModuleFilter: true,
    }),
    db.sample.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sampleId: true,
        sampleAlias: true,
        sampleTitle: true,
        sampleDescription: true,
        scientificName: true,
        taxId: true,
        sampleAccessionNumber: true,
        checklistData: true,
        facilityStatus: true,
      },
    }),
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { modulesConfig: true },
    }),
  ]);

  const dynamicStudiesEnabled = isStudyModuleEnabled(
    parseStudyModulesConfig(settings?.modulesConfig ?? null),
    "dynamic-studies"
  );
  const hasOwnForm = dynamicStudiesEnabled
    ? Boolean(
        await db.studyFormConfig.findUnique({
          where: { studyId: study.id },
          select: { id: true },
        })
      )
    : false;

  // Per-sample field columns: every visible per-sample field that isn't already
  // covered by an identity column.
  const fieldColumns = schema.perSampleFields.filter((field) => {
    if (field.visible === false) return false;
    const coreColumn = FIELD_TO_COLUMN_MAP[field.name];
    return !(coreColumn && CORE_COLUMNS_ALREADY_SHOWN.has(coreColumn));
  });

  const columns: StudyTableColumn[] = [
    ...IDENTITY_COLUMNS,
    ...fieldColumns.map((field) => ({
      key: `f:${field.name}`,
      label: field.label,
      kind: "field" as const,
      fieldType: field.type,
    })),
  ];

  const rows: StudyTableRow[] = samples.map((sample) => {
    const checklist = parseJsonObject(sample.checklistData);
    const status = isFacilitySampleStatus(sample.facilityStatus)
      ? sample.facilityStatus
      : "WAITING";

    const organism = [
      sample.scientificName ?? "",
      sample.taxId ? `(taxid ${sample.taxId})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const cells: Record<string, string> = {
      _sampleId: sample.sampleId ?? "",
      _status: FACILITY_SAMPLE_STATUS_LABELS[status],
      _organism: organism,
      _accession: sample.sampleAccessionNumber ?? "",
    };

    for (const field of fieldColumns) {
      const coreColumn = FIELD_TO_COLUMN_MAP[field.name];
      const raw = coreColumn
        ? (sample as Record<string, unknown>)[coreColumn]
        : checklist[field.name];
      cells[`f:${field.name}`] = formatCell(raw);
    }

    return {
      id: sample.id,
      status,
      statusLabel: FACILITY_SAMPLE_STATUS_LABELS[status],
      cells,
    };
  });

  const studyMetadata = parseJsonObject(study.studyMetadata);
  const studySummary = schema.studyFields
    .filter(
      (field) =>
        field.visible !== false &&
        field.type !== "mixs" &&
        field.type !== "funding" &&
        field.name !== "_sample_association"
    )
    .map((field) => ({
      label: field.label,
      value: formatCell(studyMetadata[field.name]),
    }))
    .filter((entry) => entry.value);

  return {
    study: {
      id: study.id,
      title: study.title,
      alias: study.alias ?? null,
      userId: study.userId,
      checklistType: study.checklistType ?? null,
      sampleCount: samples.length,
    },
    columns,
    rows,
    studySummary,
    perStudy: dynamicStudiesEnabled && hasOwnForm,
  };
}
