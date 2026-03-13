import type { FormFieldDefinition } from "@/types/form-config";
import { mapPerSampleFieldToColumn } from "@/lib/sample-fields";
import type {
  OrderProgressCompletionStatus,
  OrderProgressStatusOrder,
  OrderProgressStatusOrderSample,
} from "@/lib/orders/progress-status";

export const FACILITY_FIELD_SUBSECTIONS = [
  {
    id: "order-fields",
    label: "Order Fields",
    description: "Internal order-level facility data",
  },
  {
    id: "sample-fields",
    label: "Sample Fields",
    description: "Internal sample-level facility data",
  },
] as const;

export type FacilityFieldSubsectionId =
  (typeof FACILITY_FIELD_SUBSECTIONS)[number]["id"];

export interface FacilityFieldSection {
  id: FacilityFieldSubsectionId;
  label: string;
  description: string;
  status: OrderProgressCompletionStatus;
}

interface BuildFacilityFieldSectionsOptions {
  fields: FormFieldDefinition[];
  order: OrderProgressStatusOrder | null;
  includeFacilityFields?: boolean;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and fall back to an empty object.
  }

  return {};
}

function hasProgressValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function toCompletionStatus(
  filled: number,
  total: number,
): OrderProgressCompletionStatus {
  if (filled <= 0) return "empty";
  if (total > 0 && filled >= total) return "complete";
  return "partial";
}

function getOrderFieldRawValue(
  order: OrderProgressStatusOrder,
  parsedOrderCustomFields: Record<string, unknown>,
  field: FormFieldDefinition,
): unknown {
  if (field.isSystem && field.systemKey) {
    const orderRecord = order as unknown as Record<string, unknown>;
    return orderRecord[field.systemKey];
  }

  return parsedOrderCustomFields[field.name];
}

function getSampleFieldRawValue(
  sample: OrderProgressStatusOrderSample,
  sampleCustomFieldsById: Record<string, Record<string, unknown>>,
  field: FormFieldDefinition,
): unknown {
  if (field.type === "organism") {
    const scientificName = sample.scientificName?.trim();
    const taxId = sample.taxId?.trim();
    return scientificName || taxId || "";
  }

  const mappedColumn = mapPerSampleFieldToColumn(field.name);
  if (mappedColumn) {
    const sampleRecord = sample as unknown as Record<string, unknown>;
    return sampleRecord[mappedColumn];
  }

  return sampleCustomFieldsById[sample.id]?.[field.name];
}

export function getFacilityFieldSubsectionAnchorId(
  subsectionId: FacilityFieldSubsectionId,
): string {
  return `facility-fields-${subsectionId}`;
}

export function isFacilityFieldSubsectionId(
  value: string | null,
): value is FacilityFieldSubsectionId {
  return FACILITY_FIELD_SUBSECTIONS.some((section) => section.id === value);
}

export function buildFacilityFieldSections({
  fields,
  order,
  includeFacilityFields = false,
}: BuildFacilityFieldSectionsOptions): FacilityFieldSection[] {
  if (!includeFacilityFields) {
    return [];
  }

  const visibleAdminFields = fields.filter((field) => field.visible && field.adminOnly);
  const orderFields = visibleAdminFields.filter(
    (field) => !field.perSample && field.type !== "mixs"
  );
  const sampleFields = visibleAdminFields
    .filter((field) => field.perSample)
    .slice()
    .sort((a, b) => a.order - b.order);

  if (!order) {
    return FACILITY_FIELD_SUBSECTIONS.filter((section) =>
      section.id === "order-fields" ? orderFields.length > 0 : sampleFields.length > 0
    ).map((section) => ({
      ...section,
      status: "empty" satisfies OrderProgressCompletionStatus,
    }));
  }

  const parsedOrderCustomFields = parseJsonObject(order.customFields);
  const sampleCustomFieldsById = Object.fromEntries(
    order.samples.map((sample) => [sample.id, parseJsonObject(sample.customFields)])
  ) as Record<string, Record<string, unknown>>;

  const sections: FacilityFieldSection[] = [];

  const filledOrderFields = orderFields.filter((field) =>
    hasProgressValue(getOrderFieldRawValue(order, parsedOrderCustomFields, field))
  ).length;
  sections.push({
    ...FACILITY_FIELD_SUBSECTIONS[0],
    status: toCompletionStatus(filledOrderFields, orderFields.length),
  });

  if (sampleFields.length > 0 || order.samples.length > 0) {
    if (order.samples.length === 0 || sampleFields.length === 0) {
      sections.push({
        ...FACILITY_FIELD_SUBSECTIONS[1],
        status: "empty",
      });
    } else {
      let filled = 0;
      let total = 0;

      for (const sample of order.samples) {
        for (const field of sampleFields) {
          total += 1;
          if (hasProgressValue(getSampleFieldRawValue(sample, sampleCustomFieldsById, field))) {
            filled += 1;
          }
        }
      }

      sections.push({
        ...FACILITY_FIELD_SUBSECTIONS[1],
        status: toCompletionStatus(filled, total),
      });
    }
  }

  return sections;
}
