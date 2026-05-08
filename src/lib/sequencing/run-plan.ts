import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_FORM_SCHEMA,
  type FormFieldDefinition,
  type FormFieldGroup,
} from "@/types/form-config";
import { normalizeOrderFormSchema } from "@/lib/orders/fixed-sections";
import { FILES_ASSIGNABLE_STATUSES } from "./constants";

export const RUN_ASSIGNMENT_FORM_DEFAULTS_VERSION = 1;
export const RUN_PLAN_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const RUN_PLAN_IMPORT_MAX_ROWS = 1000;
export const RUN_PLAN_IMPORT_MAX_COLUMNS = 80;
export const RUN_PLAN_ASSIGNMENT_MAX_BATCH = 500;

const RUN_ASSIGNMENT_FIELDS_KEY = "sequencingRunSampleFormFields";
const RUN_ASSIGNMENT_GROUPS_KEY = "sequencingRunSampleFormGroups";
const RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY = "sequencingRunSampleFormDefaultsVersion";

function assertRunPlanManageableOrderStatus(status: string): void {
  if (!FILES_ASSIGNABLE_STATUSES.includes(status as (typeof FILES_ASSIGNABLE_STATUSES)[number])) {
    throw new Error("Sequencing run plans can only be managed on submitted or completed orders");
  }
}

export const RUN_ASSIGNMENT_GROUPS: FormFieldGroup[] = [
  {
    id: "group_run_assignment",
    name: "Run Assignment",
    description: "Barcode and sample-specific sequencing run details",
    icon: "Dna",
    order: 0,
  },
  {
    id: "group_prep",
    name: "Preparation",
    description: "Run-specific extraction, depletion, and concentration details",
    icon: "FlaskConical",
    order: 1,
  },
];

export const ONT_ORDER_FIELDS: FormFieldDefinition[] = [
  {
    id: "field_ont_run_type",
    type: "select",
    label: "Run Type",
    name: "run_type",
    required: false,
    visible: true,
    helpText: "Experiment type for this sequencing run.",
    options: [
      { value: "metagenomics", label: "Metagenomics" },
      { value: "metatranscriptomics", label: "Metatranscriptomics" },
      { value: "other", label: "Other" },
    ],
    order: 10,
    groupId: "group_sequencing",
  },
  {
    id: "field_ont_run_date",
    type: "date",
    label: "Planned/Actual Run Date",
    name: "run_date",
    required: false,
    visible: true,
    order: 11,
    groupId: "group_sequencing",
    adminOnly: true,
  },
  {
    id: "field_ont_library_prep_kit",
    type: "text",
    label: "Library Prep Kit",
    name: "library_prep_kit",
    required: false,
    visible: true,
    placeholder: "e.g., SQK-RPB114.24",
    order: 12,
    groupId: "group_sequencing",
    adminOnly: true,
  },
  {
    id: "field_ont_flowcell_type",
    type: "text",
    label: "Flowcell Type",
    name: "flowcell_type",
    required: false,
    visible: true,
    placeholder: "e.g., FLO-MIN114",
    order: 13,
    groupId: "group_sequencing",
    adminOnly: true,
  },
  {
    id: "field_ont_flowcell_id",
    type: "text",
    label: "Flowcell ID",
    name: "flowcell_id",
    required: false,
    visible: true,
    placeholder: "e.g., FBF50978",
    order: 14,
    groupId: "group_sequencing",
    adminOnly: true,
  },
  {
    id: "field_ont_flowcell_lot",
    type: "text",
    label: "Flowcell Lot",
    name: "flowcell_lot",
    required: false,
    visible: true,
    order: 15,
    groupId: "group_sequencing",
    adminOnly: true,
  },
  {
    id: "field_ont_measurement_device",
    type: "text",
    label: "Measurement Device",
    name: "measurement_device",
    required: false,
    visible: true,
    placeholder: "e.g., Qubit",
    order: 16,
    groupId: "group_sequencing",
    adminOnly: true,
  },
];

export const ONT_SAMPLE_FIELDS: FormFieldDefinition[] = [
  {
    id: "field_internal_sample_code",
    type: "text",
    label: "Internal Sample/Patient Code",
    name: "internal_sample_code",
    required: false,
    visible: true,
    order: 20,
    perSample: true,
  },
  {
    id: "field_material_body_site",
    type: "text",
    label: "Material / Body Site",
    name: "material_body_site",
    required: false,
    visible: true,
    placeholder: "e.g., BAL, ascites, blood, urine",
    order: 21,
    perSample: true,
  },
  {
    id: "field_sampling_date",
    type: "date",
    label: "Sampling Date",
    name: "sampling_date",
    required: false,
    visible: true,
    order: 22,
    perSample: true,
  },
  {
    id: "field_storage_box",
    type: "text",
    label: "Storage Box",
    name: "storage_box",
    required: false,
    visible: true,
    order: 23,
    perSample: true,
    adminOnly: true,
  },
  {
    id: "field_storage_position",
    type: "text",
    label: "Storage Position",
    name: "storage_position",
    required: false,
    visible: true,
    placeholder: "e.g., H9",
    order: 24,
    perSample: true,
    adminOnly: true,
  },
  {
    id: "field_storage_buffer",
    type: "text",
    label: "Buffer",
    name: "storage_buffer",
    required: false,
    visible: true,
    placeholder: "e.g., Shield buffer",
    order: 25,
    perSample: true,
    adminOnly: true,
  },
];

export const ONT_RUN_ASSIGNMENT_FIELDS: FormFieldDefinition[] = [
  {
    id: "field_run_barcode",
    type: "barcode",
    label: "Barcode",
    name: "barcode",
    required: false,
    visible: true,
    helpText: "Barcode assigned to this sample in this sequencing run.",
    order: 0,
    groupId: "group_run_assignment",
    adminOnly: true,
  },
  {
    id: "field_run_depletion",
    type: "select",
    label: "Depletion",
    name: "depletion",
    required: false,
    visible: true,
    options: [
      { value: "HD", label: "Host depletion" },
      { value: "ND", label: "No depletion" },
      { value: "other", label: "Other" },
    ],
    order: 1,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_extraction_date",
    type: "date",
    label: "Extraction Date",
    name: "extraction_date",
    required: false,
    visible: true,
    order: 2,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_extraction_method",
    type: "text",
    label: "Extraction Method",
    name: "extraction_method",
    required: false,
    visible: true,
    placeholder: "e.g., Zymo miniprep",
    order: 3,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_analyte",
    type: "select",
    label: "Analyte",
    name: "analyte",
    required: false,
    visible: true,
    options: [
      { value: "DNA", label: "DNA" },
      { value: "RNA", label: "RNA" },
    ],
    order: 4,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_concentration_ng_ul",
    type: "number",
    label: "Concentration (ng/uL)",
    name: "concentration_ng_ul",
    required: false,
    visible: true,
    order: 5,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_post_pcr_concentration_ng_ul",
    type: "number",
    label: "Post-PCR Concentration (ng/uL)",
    name: "post_pcr_concentration_ng_ul",
    required: false,
    visible: true,
    order: 6,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_total_volume_ul",
    type: "number",
    label: "Total Volume (uL)",
    name: "total_volume_ul",
    required: false,
    visible: true,
    order: 7,
    groupId: "group_prep",
    adminOnly: true,
  },
  {
    id: "field_run_specific_notes",
    type: "textarea",
    label: "Run-Specific Notes",
    name: "run_specific_notes",
    required: false,
    visible: true,
    order: 8,
    groupId: "group_run_assignment",
    adminOnly: true,
  },
];

export interface RunAssignmentFormSchema {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  version: number;
  defaultsVersion: number;
}

export interface SequencingRunPlanRow {
  id: string;
  sampleId: string;
  sampleCode: string;
  sampleTitle: string | null;
  material: string | null;
  barcode: string | null;
  customFields: Record<string, unknown>;
  readCount: number;
  artifactCount: number;
  latestMetaXpathStatus: string | null;
}

export interface SequencingRunPlan {
  id: string;
  runId: string;
  runName: string | null;
  platform: string | null;
  instrument: string | null;
  runDate: string | null;
  folderPath: string | null;
  runParameters: Record<string, unknown>;
  samples: SequencingRunPlanRow[];
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
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

function serializeJsonObject(value: Record<string, unknown>): string | null {
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function normalizeFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeField(field: FormFieldDefinition, index: number): FormFieldDefinition {
  return {
    ...field,
    id: field.id || `field_run_assignment_${normalizeFieldName(field.name || field.label)}_${index}`,
    name: normalizeFieldName(field.name || field.label),
    required: Boolean(field.required),
    visible: field.visible !== false,
    order: typeof field.order === "number" ? field.order : index,
    perSample: false,
  };
}

export function normalizeRunAssignmentFormSchema(input?: {
  fields?: FormFieldDefinition[];
  groups?: FormFieldGroup[];
}): Pick<RunAssignmentFormSchema, "fields" | "groups"> {
  const fields = (input?.fields ?? ONT_RUN_ASSIGNMENT_FIELDS).map(normalizeField);
  const groups = (input?.groups?.length ? input.groups : RUN_ASSIGNMENT_GROUPS)
    .map((group, index) => ({
      ...group,
      id: group.id || `group_run_assignment_${index}`,
      order: typeof group.order === "number" ? group.order : index,
    }))
    .sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  const dedupedFields = fields
    .filter((field) => {
      if (seen.has(field.name)) return false;
      seen.add(field.name);
      return true;
    })
    .sort((a, b) => a.order - b.order);

  return { fields: dedupedFields, groups };
}

export function filterRunAssignmentFieldsForRole(
  fields: FormFieldDefinition[],
  isFacilityAdmin: boolean
): FormFieldDefinition[] {
  return fields.filter((field) => field.visible && (isFacilityAdmin || !field.adminOnly));
}

async function loadExtraSettings(): Promise<Record<string, unknown>> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  return parseJsonObject(settings?.extraSettings);
}

async function saveExtraSettings(extraSettings: Record<string, unknown>): Promise<void> {
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    update: { extraSettings: JSON.stringify(extraSettings) },
    create: {
      id: "singleton",
      extraSettings: JSON.stringify(extraSettings),
    },
  });
}

export async function loadRunAssignmentFormSchema(options?: {
  isFacilityAdmin?: boolean;
  applyRoleFilter?: boolean;
}): Promise<RunAssignmentFormSchema> {
  const extraSettings = await loadExtraSettings();
  const normalized = normalizeRunAssignmentFormSchema({
    fields: Array.isArray(extraSettings[RUN_ASSIGNMENT_FIELDS_KEY])
      ? (extraSettings[RUN_ASSIGNMENT_FIELDS_KEY] as FormFieldDefinition[])
      : ONT_RUN_ASSIGNMENT_FIELDS,
    groups: Array.isArray(extraSettings[RUN_ASSIGNMENT_GROUPS_KEY])
      ? (extraSettings[RUN_ASSIGNMENT_GROUPS_KEY] as FormFieldGroup[])
      : RUN_ASSIGNMENT_GROUPS,
  });

  return {
    fields: options?.applyRoleFilter
      ? filterRunAssignmentFieldsForRole(
          normalized.fields,
          Boolean(options.isFacilityAdmin)
        )
      : normalized.fields,
    groups: normalized.groups,
    version: 1,
    defaultsVersion:
      typeof extraSettings[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] === "number"
        ? (extraSettings[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] as number)
        : RUN_ASSIGNMENT_FORM_DEFAULTS_VERSION,
  };
}

export async function saveRunAssignmentFormSchema(input: {
  fields: FormFieldDefinition[];
  groups?: FormFieldGroup[];
}): Promise<RunAssignmentFormSchema> {
  const normalized = normalizeRunAssignmentFormSchema(input);
  const extraSettings = await loadExtraSettings();
  extraSettings[RUN_ASSIGNMENT_FIELDS_KEY] = normalized.fields;
  extraSettings[RUN_ASSIGNMENT_GROUPS_KEY] = normalized.groups;
  extraSettings[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] =
    RUN_ASSIGNMENT_FORM_DEFAULTS_VERSION;
  await saveExtraSettings(extraSettings);
  return {
    ...normalized,
    version: 1,
    defaultsVersion: RUN_ASSIGNMENT_FORM_DEFAULTS_VERSION,
  };
}

function appendMissingFields(
  current: FormFieldDefinition[],
  additions: FormFieldDefinition[]
): FormFieldDefinition[] {
  const names = new Set(current.map((field) => field.name));
  return [
    ...current,
    ...additions.filter((field) => !names.has(field.name)),
  ];
}

export async function applyOntRunPlanPreset(): Promise<{
  orderFieldsAdded: number;
  runAssignmentFieldsAdded: number;
}> {
  const [orderConfig, extraSettings] = await Promise.all([
    db.orderFormConfig.findUnique({ where: { id: "singleton" } }),
    loadExtraSettings(),
  ]);

  const parsedOrder = orderConfig ? JSON.parse(orderConfig.schema) : DEFAULT_FORM_SCHEMA;
  const currentOrderFields = Array.isArray(parsedOrder)
    ? parsedOrder
    : parsedOrder.fields ?? DEFAULT_FORM_SCHEMA.fields;
  const currentOrderGroups = Array.isArray(parsedOrder)
    ? undefined
    : parsedOrder.groups;
  const normalizedOrder = normalizeOrderFormSchema({
    fields: appendMissingFields(
      currentOrderFields as FormFieldDefinition[],
      [...ONT_ORDER_FIELDS, ...ONT_SAMPLE_FIELDS]
    ),
    groups: currentOrderGroups,
  });

  const currentRunFields = Array.isArray(extraSettings[RUN_ASSIGNMENT_FIELDS_KEY])
    ? (extraSettings[RUN_ASSIGNMENT_FIELDS_KEY] as FormFieldDefinition[])
    : [];
  const normalizedRun = normalizeRunAssignmentFormSchema({
    fields: appendMissingFields(currentRunFields, ONT_RUN_ASSIGNMENT_FIELDS),
    groups: RUN_ASSIGNMENT_GROUPS,
  });

  const orderNamesBefore = new Set(
    (currentOrderFields as FormFieldDefinition[]).map((field) => field.name)
  );
  const runNamesBefore = new Set(currentRunFields.map((field) => field.name));

  await db.orderFormConfig.upsert({
    where: { id: "singleton" },
    update: {
      schema: JSON.stringify({
        fields: normalizedOrder.fields,
        groups: normalizedOrder.groups,
        enabledMixsChecklists: parsedOrder.enabledMixsChecklists || [],
      }),
      coreFieldConfig: "{}",
      version: (orderConfig?.version ?? 0) + 1,
    },
    create: {
      id: "singleton",
      schema: JSON.stringify({
        fields: normalizedOrder.fields,
        groups: normalizedOrder.groups,
        enabledMixsChecklists: [],
      }),
      coreFieldConfig: "{}",
      version: 1,
    },
  });

  extraSettings[RUN_ASSIGNMENT_FIELDS_KEY] = normalizedRun.fields;
  extraSettings[RUN_ASSIGNMENT_GROUPS_KEY] = normalizedRun.groups;
  extraSettings[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] =
    RUN_ASSIGNMENT_FORM_DEFAULTS_VERSION;
  await saveExtraSettings(extraSettings);

  return {
    orderFieldsAdded: normalizedOrder.fields.filter(
      (field) => !orderNamesBefore.has(field.name)
    ).length,
    runAssignmentFieldsAdded: normalizedRun.fields.filter(
      (field) => !runNamesBefore.has(field.name)
    ).length,
  };
}

export function normalizeBarcode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const numeric = lower.match(/^(?:barcode|bc)?\s*0*(\d{1,3})$/i);
  if (numeric) {
    return `barcode${numeric[1].padStart(2, "0")}`;
  }
  return lower;
}

export async function getRunPlanSampleBarcodeAssignments(orderId: string): Promise<{
  assignments: Array<{ sampleId: string; barcode: string }>;
  duplicateBarcodes: string[];
}> {
  const samples = await db.sample.findMany({
    where: { orderId },
    select: {
      id: true,
      customFields: true,
    },
  });

  const rows = samples
    .map((sample) => {
      const customFields = parseJsonObject(sample.customFields);
      const barcode = normalizeBarcode(customFields._barcode);
      return barcode ? { sampleId: sample.id, barcode } : null;
    })
    .filter((row): row is { sampleId: string; barcode: string } => row !== null);

  const barcodeCounts = new Map<string, number>();
  for (const row of rows) {
    barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) ?? 0) + 1);
  }

  const duplicateBarcodes = Array.from(barcodeCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([barcode]) => barcode);

  return {
    assignments: rows.filter((row) => barcodeCounts.get(row.barcode) === 1),
    duplicateBarcodes,
  };
}

export async function prefillSequencingRunSamplesFromOrderBarcodes(input: {
  orderId: string;
  runDbId: string;
}): Promise<{ assigned: number; duplicateBarcodes: string[] }> {
  const { assignments, duplicateBarcodes } =
    await getRunPlanSampleBarcodeAssignments(input.orderId);

  if (assignments.length > 0) {
    await upsertSequencingRunSamples({
      orderId: input.orderId,
      runDbId: input.runDbId,
      assignments,
    });
  }

  return {
    assigned: assignments.length,
    duplicateBarcodes,
  };
}

function parseRunDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value).trim();
  if (!text) return null;
  const germanDate = text.match(/^(\d{1,2})[._/](\d{1,2})[._/](\d{4})$/);
  const normalized = germanDate
    ? `${germanDate[3]}-${germanDate[2].padStart(2, "0")}-${germanDate[1].padStart(2, "0")}`
    : text.replace(/^(\d{2})_(\d{2})_(\d{4})$/, "$3-$2-$1");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeRunPlanImportedValue(
  fieldName: string,
  value: unknown
): string | number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (fieldName === "barcode") {
    return normalizeBarcode(text);
  }

  if (fieldName.endsWith("_date") || fieldName === "sampling_date") {
    const date = parseRunDate(text);
    return date ? date.toISOString().slice(0, 10) : text;
  }

  if (
    fieldName.includes("concentration") ||
    fieldName.endsWith("_ng_ul") ||
    fieldName.endsWith("_volume_ul") ||
    fieldName === "total_volume_ul"
  ) {
    const compact = text.replace(/\s+/g, "");
    const numericText = /^\d+,\d+$/.test(compact)
      ? compact.replace(",", ".")
      : compact;
    const parsed = Number(numericText);
    return Number.isFinite(parsed) ? parsed : text;
  }

  return text;
}

export function findDuplicateRunPlanBarcodes(
  rows: Array<{ runId: string; barcode?: string | null }>
): Array<{ runId: string; barcode: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const barcode = normalizeBarcode(row.barcode);
    if (!barcode) continue;
    const key = `${row.runId}::${barcode}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [runId, barcode] = key.split("::");
      return { runId, barcode, count };
    });
}

export async function listSequencingRunsForOrder(
  orderId: string,
  options?: { isFacilityAdmin?: boolean }
): Promise<{ fields: FormFieldDefinition[]; runs: SequencingRunPlan[] }> {
  const schema = await loadRunAssignmentFormSchema({
    isFacilityAdmin: Boolean(options?.isFacilityAdmin),
    applyRoleFilter: true,
  });
  const runs = await db.sequencingRun.findMany({
    where: { orderId },
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
    include: {
      samples: {
        orderBy: [{ barcode: "asc" }, { createdAt: "asc" }],
        include: {
          sample: {
            select: {
              id: true,
              sampleId: true,
              sampleTitle: true,
              sampleAlias: true,
              customFields: true,
              reads: {
                select: { id: true },
              },
              sequencingArtifacts: {
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  return {
    fields: schema.fields,
    runs: runs.map((run) => ({
      id: run.id,
      runId: run.runId,
      runName: run.runName,
      platform: run.platform,
      instrument: run.instrument,
      runDate: run.runDate?.toISOString() ?? null,
      folderPath: run.folderPath,
      runParameters: parseJsonObject(run.runParameters),
      samples: run.samples.map((assignment) => {
        const sampleCustomFields = parseJsonObject(assignment.sample.customFields);
        const customFields = parseJsonObject(assignment.customFields);
        return {
          id: assignment.id,
          sampleId: assignment.sample.id,
          sampleCode: assignment.sample.sampleId,
          sampleTitle: assignment.sample.sampleTitle,
          material:
            typeof sampleCustomFields.material_body_site === "string"
              ? sampleCustomFields.material_body_site
              : null,
          barcode: assignment.barcode,
          customFields,
          readCount: assignment.sample.reads.length,
          artifactCount: assignment.sample.sequencingArtifacts.length,
          latestMetaXpathStatus: null,
        };
      }),
    })),
  };
}

export async function createSequencingRunForOrder(input: {
  orderId: string;
  runId: string;
  runName?: string | null;
  platform?: string | null;
  instrument?: string | null;
  runDate?: string | null;
  folderPath?: string | null;
  runParameters?: Record<string, unknown>;
}) {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, status: true },
  });
  if (!order) {
    throw new Error("Order not found");
  }
  assertRunPlanManageableOrderStatus(order.status);
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("Run ID is required");
  }

  return db.sequencingRun.create({
    data: {
      orderId: input.orderId,
      runId,
      runName: input.runName?.trim() || null,
      platform: input.platform?.trim() || null,
      instrument: input.instrument?.trim() || null,
      runDate: parseRunDate(input.runDate),
      folderPath: input.folderPath?.trim() || null,
      runParameters: serializeJsonObject(input.runParameters ?? {}),
    },
  });
}

export async function updateSequencingRunForOrder(input: {
  orderId: string;
  runDbId: string;
  runName?: string | null;
  platform?: string | null;
  instrument?: string | null;
  runDate?: string | null;
  folderPath?: string | null;
  runParameters?: Record<string, unknown>;
}) {
  await assertRunBelongsToOrder(input.runDbId, input.orderId);
  return db.sequencingRun.update({
    where: { id: input.runDbId },
    data: {
      runName: input.runName === undefined ? undefined : input.runName?.trim() || null,
      platform: input.platform === undefined ? undefined : input.platform?.trim() || null,
      instrument: input.instrument === undefined ? undefined : input.instrument?.trim() || null,
      runDate: input.runDate === undefined ? undefined : parseRunDate(input.runDate),
      folderPath: input.folderPath === undefined ? undefined : input.folderPath?.trim() || null,
      runParameters:
        input.runParameters === undefined
          ? undefined
          : serializeJsonObject(input.runParameters),
    },
  });
}

export async function deleteSequencingRunForOrder(orderId: string, runDbId: string) {
  await assertRunBelongsToOrder(runDbId, orderId);
  await db.sequencingRun.delete({ where: { id: runDbId } });
}

async function assertRunBelongsToOrder(runDbId: string, orderId: string) {
  const run = await db.sequencingRun.findFirst({
    where: { id: runDbId, orderId },
    select: {
      id: true,
      order: {
        select: {
          status: true,
        },
      },
    },
  });
  if (!run) {
    throw new Error("Sequencing run not found");
  }
  assertRunPlanManageableOrderStatus(run.order?.status ?? "");
}

export async function upsertSequencingRunSamples(input: {
  orderId: string;
  runDbId: string;
  assignments: Array<{
    sampleId: string;
    barcode?: string | null;
    customFields?: Record<string, unknown>;
    notes?: string | null;
  }>;
}) {
  await assertRunBelongsToOrder(input.runDbId, input.orderId);
  if (input.assignments.length > RUN_PLAN_ASSIGNMENT_MAX_BATCH) {
    throw new Error(
      `Run assignment batch is limited to ${RUN_PLAN_ASSIGNMENT_MAX_BATCH} rows`
    );
  }
  const samples = await db.sample.findMany({
    where: { orderId: input.orderId },
    select: { id: true, sampleId: true },
  });
  const samplesByIdOrCode = new Map<string, string>();
  for (const sample of samples) {
    samplesByIdOrCode.set(sample.id, sample.id);
    samplesByIdOrCode.set(sample.sampleId, sample.id);
  }

  const seenBarcodes = new Set<string>();
  for (const assignment of input.assignments) {
    const barcode = normalizeBarcode(assignment.barcode);
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        throw new Error(`Barcode ${barcode} is assigned more than once in this request`);
      }
      seenBarcodes.add(barcode);
    }
  }

  const existingAssignments = await db.sequencingRunSample.findMany({
    where: {
      sequencingRunId: input.runDbId,
      barcode: { in: Array.from(seenBarcodes) },
    },
    select: { sampleId: true, barcode: true },
  });
  for (const existing of existingAssignments) {
    const incoming = input.assignments.find((assignment) => {
      const sampleDbId = samplesByIdOrCode.get(assignment.sampleId);
      return (
        sampleDbId !== existing.sampleId &&
        normalizeBarcode(assignment.barcode) === existing.barcode
      );
    });
    if (incoming && existing.barcode) {
      throw new Error(`Barcode ${existing.barcode} is already assigned in this run`);
    }
  }

  const results = [];
  for (const assignment of input.assignments) {
    const sampleDbId = samplesByIdOrCode.get(assignment.sampleId);
    if (!sampleDbId) {
      throw new Error(`Sample not found: ${assignment.sampleId}`);
    }
    const barcode = normalizeBarcode(assignment.barcode);
    const hasCustomFields = Object.prototype.hasOwnProperty.call(
      assignment,
      "customFields"
    );
    const hasNotes = Object.prototype.hasOwnProperty.call(assignment, "notes");
    try {
      results.push(
        await db.sequencingRunSample.upsert({
          where: {
            sequencingRunId_sampleId: {
              sequencingRunId: input.runDbId,
              sampleId: sampleDbId,
            },
          },
          update: {
            barcode,
            ...(hasCustomFields
              ? { customFields: serializeJsonObject(assignment.customFields ?? {}) }
              : {}),
            ...(hasNotes ? { notes: assignment.notes?.trim() || null } : {}),
          },
          create: {
            sequencingRunId: input.runDbId,
            sampleId: sampleDbId,
            barcode,
            customFields: serializeJsonObject(assignment.customFields ?? {}),
            notes: assignment.notes?.trim() || null,
          },
        })
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error(`Barcode ${barcode} is already assigned in this run`);
      }
      throw error;
    }
  }
  return results;
}

export const RUN_PLAN_COLUMN_ALIASES: Record<string, string> = {
  run: "runId",
  run_id: "runId",
  runid: "runId",
  barcode: "barcode",
  patient: "sampleCode",
  patient_id: "sampleCode",
  patient_code: "sampleCode",
  sample: "sampleCode",
  sample_id: "sampleCode",
  material: "material_body_site",
  body_site: "material_body_site",
  date: "sampling_date",
  sampling_date: "sampling_date",
  dna_ng_ul: "concentration_ng_ul",
  dna_ng_l: "concentration_ng_ul",
  dna_ng: "concentration_ng_ul",
  "10ng_dna_20_l_h2o": "total_volume_ul",
  nanopore_dna_ng_l_after_pcr_and_purification: "post_pcr_concentration_ng_ul",
  nanodrop_dna_ng_l_after_pcr_and_purification: "post_pcr_concentration_ng_ul",
  depletion: "depletion",
};

export function mapRunPlanHeader(header: string): string | null {
  const normalized = normalizeFieldName(
    header.replace(/µ/g, "u").replace(/\*/g, "")
  );
  return RUN_PLAN_COLUMN_ALIASES[normalized] ?? null;
}
