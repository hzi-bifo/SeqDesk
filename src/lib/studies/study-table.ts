import { db } from "@/lib/db";
import {
  isStudyModuleEnabled,
  loadStudyFormSchema,
  parseStudyModulesConfig,
} from "@/lib/studies/schema";
import { loadOrderFormSchema } from "@/lib/orders/order-form";
import { getChecklistForStudy } from "@/lib/mixs/config";
import { resolveChecklistRef } from "@/lib/mixs/checklist-aliases";
import { FIELD_TO_COLUMN_MAP } from "@/lib/sample-fields";
import {
  FACILITY_SAMPLE_STATUS_LABELS,
  isFacilitySampleStatus,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";
import type { FormFieldDefinition } from "@/types/form-config";

/**
 * One column in the study "Table overview". `group` drives the header colour so a
 * reader can tell identity vs. Sequencing Order metadata vs. Study metadata apart.
 */
export type StudyTableColumnGroup =
  | "identity"
  | "status"
  | "order"
  | "study"
  | "mixs"
  | "output";

export interface StudyTableColumn {
  key: string;
  label: string;
  kind: "identity" | "status" | "field";
  group: StudyTableColumnGroup;
  fieldType?: string;
  /** Per-column help text (from the form field, or a description for fixed columns). */
  helpText?: string;
  required?: boolean;
  /** Whether this column's cells can be edited inline (PATCH …/table). */
  editable?: boolean;
  /** Choices for a `select` editor. */
  options?: Array<{ value: string; label: string }>;
  /** True for user-added MIxS columns that can be removed from the view. */
  removable?: boolean;
}

// Per-sample field types we render an inline editor for. Special types
// (organism, barcode, mixs, funding, …) keep their own surfaces and stay read-only.
export const EDITABLE_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "number",
  "date",
  "email",
  "url",
  "tel",
  "select",
]);

// Core Sample columns that are safe to edit as plain text from the table.
export const EDITABLE_CORE_COLUMNS = new Set([
  "sampleTitle",
  "sampleAlias",
  "sampleDescription",
]);

export interface StudyTableRow {
  /** Sample.id (the database id), used as a stable React key. */
  id: string;
  status: FacilitySampleStatus;
  statusLabel: string;
  /** column key -> display string */
  cells: Record<string, string>;
}

export interface StudyInfoField {
  label: string;
  value: string;
}

/** A panel of "not per-row" information shown above the table. */
export interface StudyInfoPanel {
  heading: string;
  /** Optional sub-heading, e.g. an order's display name. */
  subheading?: string;
  fields: StudyInfoField[];
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
  /**
   * Information that is NOT per-sample, grouped into panels: the study itself
   * (incl. MIxS checklist) and each Sequencing Order the samples came from
   * (sequencer / library settings). Shown as a header above the table.
   */
  info: StudyInfoPanel[];
  /** MIxS checklist fields not yet shown, for the "+ Add MIxS field" picker. */
  availableMixsFields: Array<{ name: string; label: string }>;
  /** True when the per-sample columns came from the study's OWN questionnaire. */
  perStudy: boolean;
}

const IDENTITY_COLUMNS: StudyTableColumn[] = [
  {
    key: "_sampleId",
    label: "Sample ID",
    kind: "identity",
    group: "identity",
    helpText: "The sample's identifier within its Sequencing Order.",
  },
  {
    key: "_status",
    label: "Status",
    kind: "status",
    group: "status",
    helpText: "Facility sequencing status (Waiting → Processing → Sequenced → Ready).",
  },
  {
    key: "_organism",
    label: "Organism",
    kind: "identity",
    group: "identity",
    helpText: "Scientific name and NCBI taxonomy id.",
  },
  {
    key: "_accession",
    label: "ENA Accession",
    kind: "identity",
    group: "identity",
    helpText: "ENA sample accession, assigned once the study is submitted.",
  },
  // Which Sequencing Order each sample came from (studies can span several).
  {
    key: "_order",
    label: "Sequencing Order",
    kind: "identity",
    group: "order",
    helpText: "The Sequencing Order this sample was collected in.",
  },
];

// Read-only pipeline-output columns (reads, QC, assembly, accessions).
const OUTPUT_COLUMNS: StudyTableColumn[] = [
  {
    key: "out:dataClass",
    label: "Read type",
    kind: "field",
    group: "output",
    helpText: "Whether the active reads are raw or host-cleaned (read-cleaning pipeline).",
  },
  {
    key: "out:readFiles",
    label: "Read files",
    kind: "field",
    group: "output",
    helpText: "Number of read files linked to the sample (R1/R2).",
  },
  {
    key: "out:readCount",
    label: "Read count",
    kind: "field",
    group: "output",
    helpText: "Total reads (R1+R2) measured by FastQC / reads-QC.",
  },
  {
    key: "out:avgQuality",
    label: "Avg quality",
    kind: "field",
    group: "output",
    helpText: "Mean Phred quality score from FastQC.",
  },
  {
    key: "out:biosample",
    label: "BioSample",
    kind: "field",
    group: "output",
    helpText: "BioSample accession, assigned when the study is registered at ENA.",
  },
  {
    key: "out:runAccession",
    label: "ENA Run",
    kind: "field",
    group: "output",
    helpText: "ENA run accession for the reads (Register at ENA).",
  },
  {
    key: "out:assembly",
    label: "Assembly",
    kind: "field",
    group: "output",
    helpText: "Assembly produced by the assembly / MAG pipeline.",
  },
];

const studyTableSelect = {
  id: true,
  title: true,
  alias: true,
  description: true,
  userId: true,
  checklistType: true,
  mixsVersion: true,
  studyMetadata: true,
} as const;

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

// Turn a raw stored key ("collection_date", "sampleVolume") into a readable header.
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
    return null;
  }
}

/** A resolved per-sample field column: where to read its value from. */
interface FieldColumnSource {
  key: string;
  source: "order" | "study";
  fieldName: string;
  coreColumn?: string;
}

/**
 * Build the read-only spreadsheet model for a study: identity + status + the
 * Sequencing Order per-sample fields (from `customFields`) + the Study per-sample
 * metadata (from `checklistData`) + any stray stored keys, one row per sample. Shared
 * by the page API and the XLSX export so both stay in lockstep. Null if not found.
 */
export async function buildStudyTableData(
  idOrAlias: string,
  options: { isFacilityAdmin: boolean }
): Promise<StudyTableData | null> {
  const study = await resolveStudy(idOrAlias);
  if (!study) return null;

  const [studySchema, orderSchema, samples, settings] = await Promise.all([
    loadStudyFormSchema({
      studyId: study.id,
      isFacilityAdmin: options.isFacilityAdmin,
      applyRoleFilter: true,
      applyModuleFilter: true,
    }),
    loadOrderFormSchema({ isFacilityAdmin: options.isFacilityAdmin }),
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
        customFields: true,
        facilityStatus: true,
        biosampleNumber: true,
        reads: {
          where: { isActive: true },
          orderBy: { id: "desc" },
          select: {
            file1: true,
            file2: true,
            readCount1: true,
            readCount2: true,
            avgQuality1: true,
            avgQuality2: true,
            dataClass: true,
            runAccessionNumber: true,
          },
        },
        assemblies: {
          select: { assemblyName: true, assemblyAccession: true },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            name: true,
            platform: true,
            instrumentModel: true,
            libraryStrategy: true,
            librarySource: true,
            librarySelection: true,
            customFields: true,
          },
        },
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

  // Names of the study's MIxS checklist fields, so MIxS columns can be coloured
  // distinctly (best-effort — generic study colour if the checklist can't resolve).
  // The form uses slugs ("geographic_location") while the registry uses full ENA
  // names ("geographic location (country and/or sea)"), so we match on a normalised
  // form too (drop parentheticals + punctuation).
  const studyMetadata = parseJsonObject(study.studyMetadata);
  const normalizeMixs = (name: string) =>
    name
      .replace(/\([^)]*\)/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  let mixsFieldNames = new Set<string>();
  let mixsNormalized = new Set<string>();
  let mixsChecklistFields: Array<{
    name: string;
    label: string;
    type: string;
    helpText?: string;
    options?: Array<{ value: string; label: string }>;
  }> = [];
  if (study.checklistType) {
    try {
      const ref = resolveChecklistRef(study.checklistType);
      const checklist = await getChecklistForStudy(db, {
        ...ref,
        version: study.mixsVersion,
      });
      if (checklist) {
        const visible = checklist.fields.filter((field) => field.visible !== false);
        mixsFieldNames = new Set(visible.map((field) => field.name));
        mixsNormalized = new Set(visible.map((field) => normalizeMixs(field.name)));
        mixsChecklistFields = visible.map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          helpText: field.helpText,
          options: Array.isArray(field.options)
            ? field.options.map((option) => ({
                value: String(option.value),
                label: String(option.label),
              }))
            : undefined,
        }));
      }
    } catch {
      // Leave MIxS columns in the generic study group.
    }
  }
  const mixsFieldByName = new Map(
    mixsChecklistFields.map((field) => [field.name, field])
  );
  const mixsNormalizedList = [...mixsNormalized];
  const isMixsName = (fieldName: string): boolean => {
    if (mixsFieldNames.has(fieldName)) return true;
    const normalized = normalizeMixs(fieldName);
    if (!normalized) return false;
    if (mixsNormalized.has(normalized)) return true;
    // The form slug is often a prefix of a more specific registry term
    // (e.g. geographic_location → geographic_location_country_and_or_sea).
    return (
      normalized.length >= 5 &&
      mixsNormalizedList.some((registry) => registry.startsWith(normalized))
    );
  };
  const studyGroupFor = (
    fieldName: string,
    moduleSource?: string,
    fieldType?: string
  ): StudyTableColumnGroup =>
    isMixsName(fieldName) ||
    moduleSource === "mixs-metadata" ||
    fieldType === "mixs"
      ? "mixs"
      : "study";

  const columns: StudyTableColumn[] = [...IDENTITY_COLUMNS];
  const fieldColumns: FieldColumnSource[] = [];

  // Identity already shows organism (scientific name + tax id), so don't repeat it
  // as a per-sample field column.
  const seen = new Set<string>(["core:scientificName", "core:taxId"]);

  const addSchemaFields = (
    fields: FormFieldDefinition[],
    source: "order" | "study"
  ) => {
    for (const field of fields) {
      if (field.visible === false) continue;
      const coreColumn = FIELD_TO_COLUMN_MAP[field.name];
      const key = coreColumn
        ? `core:${coreColumn}`
        : `${source === "order" ? "custom" : "checklist"}:${field.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const editable = coreColumn
        ? EDITABLE_CORE_COLUMNS.has(coreColumn)
        : EDITABLE_FIELD_TYPES.has(field.type);
      const group =
        source === "study"
          ? studyGroupFor(field.name, field.moduleSource, field.type)
          : source;
      columns.push({
        key,
        label: field.label,
        kind: "field",
        group,
        fieldType: field.type,
        helpText: field.helpText,
        required: field.required,
        editable,
        options:
          field.type === "select" && Array.isArray(field.options)
            ? field.options.map((option) => ({
                value: String(option.value ?? option.label ?? ""),
                label: String(option.label ?? option.value ?? ""),
              }))
            : undefined,
      });
      fieldColumns.push({ key, source, fieldName: field.name, coreColumn });
    }
  };

  // Order metadata first (what the customer specified in the Sequencing Order),
  // then the study's own per-sample metadata.
  addSchemaFields(orderSchema.perSampleFields, "order");
  addSchemaFields(studySchema.perSampleFields, "study");

  const parsedSamples = samples.map((sample) => ({
    custom: parseJsonObject(sample.customFields),
    checklist: parseJsonObject(sample.checklistData),
  }));

  // Surface anything we collected but that neither current form lists (e.g. a field
  // later removed from a form), so the sheet is genuinely "everything we have".
  const addExtraKeys = (
    blob: "custom" | "checklist",
    source: "order" | "study"
  ) => {
    const extras = new Set<string>();
    for (const parsed of parsedSamples) {
      for (const key of Object.keys(parsed[blob])) {
        const coreColumn = FIELD_TO_COLUMN_MAP[key];
        if (coreColumn && seen.has(`core:${coreColumn}`)) continue;
        const columnKey = `${blob}:${key}`;
        if (seen.has(columnKey)) continue;
        extras.add(key);
      }
    }
    for (const key of extras) {
      const columnKey = `${blob}:${key}`;
      if (seen.has(columnKey)) continue;
      seen.add(columnKey);
      columns.push({
        key: columnKey,
        label: humanizeKey(key),
        kind: "field",
        group: source === "study" ? studyGroupFor(key) : source,
        helpText: "Stored on samples but not part of the current form.",
      });
      fieldColumns.push({ key: columnKey, source, fieldName: key });
    }
  };
  addExtraKeys("custom", "order");
  addExtraKeys("checklist", "study");

  // MIxS columns the user added from the table's "+ Add MIxS field" picker
  // (stored on the study). The registry field name IS the checklistData key, so
  // these stay in sync with the per-sample MIxS metadata editor.
  const addedMixsColumns = Array.isArray(studyMetadata._mixsColumns)
    ? (studyMetadata._mixsColumns as unknown[]).filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  for (const name of addedMixsColumns) {
    const columnKey = `checklist:${name}`;
    if (seen.has(columnKey)) continue;
    seen.add(columnKey);
    const def = mixsFieldByName.get(name);
    const fieldType = def?.type || "text";
    columns.push({
      key: columnKey,
      label: def?.label || humanizeKey(name),
      kind: "field",
      group: "mixs",
      fieldType,
      helpText: def?.helpText,
      editable: EDITABLE_FIELD_TYPES.has(fieldType),
      options: def?.options,
      removable: true,
    });
    fieldColumns.push({ key: columnKey, source: "study", fieldName: name });
  }

  // MIxS checklist fields not yet shown — offered by the "+ Add MIxS field" picker.
  const availableMixsFields = mixsChecklistFields
    .filter((field) => !seen.has(`checklist:${field.name}`))
    .map((field) => ({ name: field.name, label: field.label }));

  // Pipeline outputs (read-only) come last.
  columns.push(...OUTPUT_COLUMNS);

  const rows: StudyTableRow[] = samples.map((sample, index) => {
    const { custom, checklist } = parsedSamples[index];
    const status = isFacilitySampleStatus(sample.facilityStatus)
      ? sample.facilityStatus
      : "WAITING";

    const organism = [
      sample.scientificName ?? "",
      sample.taxId ? `(taxid ${sample.taxId})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const orderLabel = sample.order
      ? `${sample.order.orderNumber}${sample.order.name ? ` (${sample.order.name})` : ""}`
      : "";

    const cells: Record<string, string> = {
      _sampleId: sample.sampleId ?? "",
      _status: FACILITY_SAMPLE_STATUS_LABELS[status],
      _organism: organism,
      _accession: sample.sampleAccessionNumber ?? "",
      _order: orderLabel,
    };

    for (const column of fieldColumns) {
      let raw: unknown;
      if (column.coreColumn) {
        raw = (sample as Record<string, unknown>)[column.coreColumn];
      } else if (column.source === "order") {
        raw = custom[column.fieldName];
      } else {
        raw = checklist[column.fieldName];
      }
      cells[column.key] = formatCell(raw);
    }

    // ── Pipeline outputs ──
    const reads = sample.reads ?? [];
    const read = reads.find((r) => r.file1 || r.file2) ?? reads[0];
    const readFiles = read
      ? [read.file1, read.file2].filter(Boolean).length
      : 0;
    const readCount =
      (read?.readCount1 ?? 0) + (read?.readCount2 ?? 0);
    const avgQuality = read?.avgQuality1 ?? read?.avgQuality2 ?? null;
    const assemblyNames = (sample.assemblies ?? [])
      .map((assembly) => assembly.assemblyName || assembly.assemblyAccession || "")
      .filter(Boolean);

    cells["out:dataClass"] = read?.dataClass ?? "";
    cells["out:readFiles"] = readFiles > 0 ? String(readFiles) : "";
    cells["out:readCount"] = readCount > 0 ? readCount.toLocaleString("en-US") : "";
    cells["out:avgQuality"] = avgQuality !== null ? avgQuality.toFixed(1) : "";
    cells["out:biosample"] = sample.biosampleNumber ?? "";
    cells["out:runAccession"] = read?.runAccessionNumber ?? "";
    cells["out:assembly"] = assemblyNames.join(", ");

    return {
      id: sample.id,
      status,
      statusLabel: FACILITY_SAMPLE_STATUS_LABELS[status],
      cells,
    };
  });

  // ── "Not per-row" information, grouped into header panels ──
  const studyFields: StudyInfoField[] = [];
  if (study.checklistType) {
    studyFields.push({ label: "MIxS checklist", value: study.checklistType });
  }
  if (study.mixsVersion !== null && study.mixsVersion !== undefined) {
    studyFields.push({ label: "MIxS version", value: String(study.mixsVersion) });
  }
  if (study.description) {
    studyFields.push({ label: "Description", value: study.description });
  }
  for (const field of studySchema.studyFields) {
    if (field.visible === false) continue;
    if (field.type === "mixs" || field.type === "funding") continue;
    if (field.name === "_sample_association") continue;
    const value = formatCell(studyMetadata[field.name]);
    if (value) studyFields.push({ label: field.label, value });
  }

  // Labels for order-level custom fields come from the order form's non-per-sample
  // fields; sequencer/library settings are explicit Order columns.
  const orderFieldLabels = new Map<string, string>();
  for (const field of orderSchema.fields) {
    if (!field.perSample) orderFieldLabels.set(field.name, field.label);
  }

  const distinctOrders = new Map<string, (typeof samples)[number]["order"]>();
  for (const sample of samples) {
    if (sample.order && !distinctOrders.has(sample.order.id)) {
      distinctOrders.set(sample.order.id, sample.order);
    }
  }

  const orderPanels: StudyInfoPanel[] = [];
  for (const order of distinctOrders.values()) {
    if (!order) continue;
    const fields: StudyInfoField[] = [];
    const sequencer: Array<[string, string | null]> = [
      ["Platform", order.platform],
      ["Instrument", order.instrumentModel],
      ["Library strategy", order.libraryStrategy],
      ["Library source", order.librarySource],
      ["Library selection", order.librarySelection],
    ];
    for (const [label, value] of sequencer) {
      const formatted = formatCell(value);
      if (formatted) fields.push({ label, value: formatted });
    }
    for (const [key, value] of Object.entries(parseJsonObject(order.customFields))) {
      const formatted = formatCell(value);
      if (formatted) {
        fields.push({ label: orderFieldLabels.get(key) ?? humanizeKey(key), value: formatted });
      }
    }
    if (fields.length > 0) {
      orderPanels.push({
        heading: "Sequencing Order",
        subheading: order.name ? `${order.orderNumber} · ${order.name}` : order.orderNumber,
        fields,
      });
    }
  }

  const info: StudyInfoPanel[] = [];
  if (studyFields.length > 0) info.push({ heading: "Study", fields: studyFields });
  info.push(...orderPanels);

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
    info,
    availableMixsFields,
    perStudy: dynamicStudiesEnabled && hasOwnForm,
  };
}
