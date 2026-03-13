import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import { buildOrderProgressSteps } from "@/lib/orders/progress-steps";
import { mapPerSampleFieldToColumn } from "@/lib/sample-fields";

export type OrderProgressCompletionStatus = "empty" | "partial" | "complete";

export interface OrderProgressStatusOrderSample {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  sampleDescription: string | null;
  scientificName: string | null;
  taxId: string | null;
  customFields: string | null;
}

export interface OrderProgressStatusOrder {
  customFields: string | null;
  numberOfSamples: number | null;
  samples: OrderProgressStatusOrderSample[];
  _count?: {
    samples?: number;
  };
}

interface ProgressStatusCounts {
  filled: number;
  total: number;
}

interface ComputeStepStatusesOptions {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  order: OrderProgressStatusOrder | null;
  enabledMixsChecklists?: string[];
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

function toCompletionStatus({
  filled,
  total,
}: ProgressStatusCounts): OrderProgressCompletionStatus {
  if (filled <= 0) return "empty";
  if (total > 0 && filled >= total) return "complete";
  return "partial";
}

export function computeOrderProgressStepStatuses({
  fields,
  groups,
  order,
  enabledMixsChecklists = [],
  includeFacilityFields = false,
}: ComputeStepStatusesOptions): Record<string, OrderProgressCompletionStatus> {
  const visibleFields = fields.filter((field) => field.visible);
  const steps = buildOrderProgressSteps({
    fields: visibleFields,
    groups,
    enabledMixsChecklists,
    includeFacilityFields,
  });

  if (!order) {
    return Object.fromEntries(
      steps.map((step) => [step.id, "empty" satisfies OrderProgressCompletionStatus])
    );
  }

  const orderRecord = order as unknown as Record<string, unknown>;
  const parsedOrderCustomFields = parseJsonObject(order.customFields);
  const sampleCustomFieldsById = Object.fromEntries(
    order.samples.map((sample) => [sample.id, parseJsonObject(sample.customFields)])
  ) as Record<string, Record<string, unknown>>;

  const visibleRegularOrderFields = visibleFields.filter(
    (field) => !field.perSample && field.type !== "mixs" && !field.adminOnly
  );
  const visibleAdminOrderFields = includeFacilityFields
    ? visibleFields.filter(
        (field) => !field.perSample && field.type !== "mixs" && field.adminOnly
      )
    : [];
  const visibleSampleFields = visibleFields
    .filter((field) => field.perSample && !field.adminOnly)
    .slice()
    .sort((a, b) => a.order - b.order);
  const visibleAdminSampleFields = includeFacilityFields
    ? visibleFields
        .filter((field) => field.perSample && field.adminOnly)
        .slice()
        .sort((a, b) => a.order - b.order)
    : [];

  const knownOrderFieldNames = new Set(visibleFields.map((field) => field.name));
  const adminOnlyFieldNames = new Set(
    visibleFields.filter((field) => field.adminOnly).map((field) => field.name)
  );

  const fallbackCustomRows = Object.entries(parsedOrderCustomFields).filter(
    ([key, value]) =>
      !key.startsWith("_mixs") &&
      !knownOrderFieldNames.has(key) &&
      !adminOnlyFieldNames.has(key) &&
      hasProgressValue(value)
  );
  const fallbackAdminRows = Object.entries(parsedOrderCustomFields).filter(
    ([key, value]) =>
      !key.startsWith("_mixs") &&
      !knownOrderFieldNames.has(key) &&
      adminOnlyFieldNames.has(key) &&
      hasProgressValue(value)
  );

  const getOrderFieldRawValue = (field: FormFieldDefinition): unknown => {
    if (field.isSystem && field.systemKey) {
      const systemValue = orderRecord[field.systemKey];
      if (!hasProgressValue(systemValue) && field.systemKey === "numberOfSamples") {
        return order.numberOfSamples ?? order._count?.samples ?? order.samples.length;
      }
      return systemValue;
    }

    return parsedOrderCustomFields[field.name];
  };

  const getSampleFieldRawValue = (
    sample: OrderProgressStatusOrderSample,
    field: FormFieldDefinition
  ): unknown => {
    if (field.type === "organism") {
      return sample.scientificName?.trim() || sample.taxId?.trim() || "";
    }

    const mappedColumn = mapPerSampleFieldToColumn(field.name);
    if (mappedColumn) {
      const sampleRecord = sample as unknown as Record<string, unknown>;
      return sampleRecord[mappedColumn];
    }

    return sampleCustomFieldsById[sample.id]?.[field.name];
  };

  const countsByStep = new Map<string, ProgressStatusCounts>();

  for (const step of steps) {
    if (step.kind === "group") {
      const groupFields = visibleRegularOrderFields.filter(
        (field) => field.groupId === step.id
      );
      countsByStep.set(step.id, {
        total: groupFields.length,
        filled: groupFields.filter((field) => hasProgressValue(getOrderFieldRawValue(field))).length,
      });
      continue;
    }

    if (step.kind === "ungrouped") {
      const ungroupedFields = visibleRegularOrderFields.filter((field) => !field.groupId);
      countsByStep.set(step.id, {
        total: ungroupedFields.length + fallbackCustomRows.length,
        filled:
          ungroupedFields.filter((field) => hasProgressValue(getOrderFieldRawValue(field))).length +
          fallbackCustomRows.length,
      });
      continue;
    }

    if (step.kind === "mixs") {
      const selectedMixsChecklist =
        typeof parsedOrderCustomFields._mixsChecklist === "string"
          ? parsedOrderCustomFields._mixsChecklist
          : "";
      const selectedMixsFields = Array.isArray(parsedOrderCustomFields._mixsFields)
        ? parsedOrderCustomFields._mixsFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [];

      countsByStep.set(step.id, {
        total: 2,
        filled:
          (selectedMixsChecklist ? 1 : 0) +
          (selectedMixsChecklist && selectedMixsFields.length > 0 ? 1 : 0),
      });
      continue;
    }

    if (step.kind === "samples") {
      const sampleCount = order.samples.length;
      if (sampleCount === 0) {
        countsByStep.set(step.id, { total: 1, filled: 0 });
        continue;
      }

      let filled = order.samples.filter((sample) => hasProgressValue(sample.sampleId)).length;
      let total = sampleCount;

      for (const sample of order.samples) {
        for (const field of visibleSampleFields) {
          total += 1;
          if (hasProgressValue(getSampleFieldRawValue(sample, field))) {
            filled += 1;
          }
        }
      }

      countsByStep.set(step.id, { total, filled });
      continue;
    }

    if (step.kind === "facility") {
      let total = visibleAdminOrderFields.length + fallbackAdminRows.length;
      let filled =
        visibleAdminOrderFields.filter((field) =>
          hasProgressValue(getOrderFieldRawValue(field))
        ).length + fallbackAdminRows.length;

      if (visibleAdminSampleFields.length > 0) {
        if (order.samples.length === 0) {
          total += 1;
        } else {
          for (const sample of order.samples) {
            for (const field of visibleAdminSampleFields) {
              total += 1;
              if (hasProgressValue(getSampleFieldRawValue(sample, field))) {
                filled += 1;
              }
            }
          }
        }
      }

      countsByStep.set(step.id, {
        total,
        filled,
      });
      continue;
    }
  }

  const statuses = Object.fromEntries(
    Array.from(countsByStep.entries()).map(([stepId, counts]) => [
      stepId,
      toCompletionStatus(counts),
    ])
  ) as Record<string, OrderProgressCompletionStatus>;

  const reviewStep = steps.find((step) => step.kind === "review");
  if (reviewStep) {
    const priorStatuses = steps
      .filter((step) => step.kind !== "review")
      .map((step) => statuses[step.id] ?? "empty");

    statuses[reviewStep.id] = priorStatuses.every((status) => status === "complete")
      ? "complete"
      : priorStatuses.some((status) => status !== "empty")
        ? "partial"
        : "empty";
  }

  return statuses;
}

export function getOrderProgressIndicatorClassName(
  status: OrderProgressCompletionStatus
): string {
  switch (status) {
    case "complete":
      return "bg-emerald-500";
    case "partial":
      return "bg-amber-400";
    default:
      return "bg-slate-400";
  }
}

export function getOrderProgressIndicatorLabel(
  status: OrderProgressCompletionStatus
): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "partial":
      return "Partially filled";
    default:
      return "Not filled";
  }
}
